'use strict';
// 新闻推送 · 调度与投递（v0.2.35）
// 绑定：填写机器人连接信息 → 摘星阁向该机器人发送 6 位验证码 → 在设置页输入验证码，证明消息确实到了你的手机，
//       连接信息才会加密落盘。未经验证的配置只在内存里停留 10 分钟。
// 推送：按设置的节奏到点后，为每个已启用渠道各自挑出「尚未推送过」的新情报（同一事件只推一次），
//       按热度排序、截取条数后投递；平台限流或网络抖动时有限次退避重试。
//       应用关闭期间错过的时刻，在下次启动后 24 小时内只补推一次。
const crypto = require('node:crypto');
const { CHANNELS, CHANNEL_IDS, PushChannelError, channelById, deliver } = require('./channels');
const { composeMessage, digestHeadline, formatStamp } = require('./compose');
const { applyPushPatch, describeSchedule, latestDueSlot, nextSlot, normalizePushSettings } = require('./schedule');

const CREDENTIAL_PREFIX = 'push-';
const STATE_KEY = 'push.state';
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const CATCH_UP_WINDOW_MS = 24 * 3600_000;
const RETRY_DELAYS_MS = Object.freeze([4_000, 15_000]);
const HISTORY_LIMIT = 300;
const DELIVERY_RETENTION_DAYS = 90;
const VISIBLE_SQL = "a.relevant = 1 AND a.analyzed IN (1, 3) AND a.domain IN ('lowaltitude', 'aerospace', 'both')";

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function credentialKey(id) {
  return `${CREDENTIAL_PREFIX}${id}`;
}

function createPushService({
  db,
  loadSettings,
  coordinator,
  credentials,
  mapRow,
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
  tickMs = 30_000,
  logger = console
} = {}) {
  if (!db || !loadSettings || !coordinator || !credentials || typeof mapRow !== 'function') {
    throw new TypeError('push service dependencies are required');
  }

  const pending = new Map();
  let timer = null;
  let started = false;
  let stopping = false;
  let running = null;
  let abort = null;

  const readMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const writeMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const insertLog = db.prepare(`INSERT INTO push_log (at, trigger, channel, ok, skipped, item_count, error, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const pruneLog = db.prepare('DELETE FROM push_log WHERE id <= (SELECT id FROM push_log ORDER BY id DESC LIMIT 1 OFFSET ?)');
  const insertDelivery = db.prepare(`INSERT OR IGNORE INTO push_deliveries (channel, article_id, cluster_id, pushed_at)
    VALUES (?, ?, ?, ?)`);
  const pruneDeliveries = db.prepare('DELETE FROM push_deliveries WHERE pushed_at < ?');
  const clearDeliveries = db.prepare('DELETE FROM push_deliveries WHERE channel = ?');
  const recentLog = db.prepare('SELECT * FROM push_log ORDER BY id DESC LIMIT ?');
  const totals = db.prepare('SELECT COUNT(*) AS pushes, COALESCE(SUM(item_count), 0) AS items FROM push_log WHERE ok = 1 AND skipped = 0 AND trigger <> \'test\'');

  function readState() {
    try {
      const parsed = JSON.parse(readMeta.get(STATE_KEY)?.value || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeState(patch) {
    const next = { ...readState(), ...patch };
    writeMeta.run(STATE_KEY, JSON.stringify(next));
    return next;
  }

  function pushSettings(settings = loadSettings()) {
    return normalizePushSettings(settings.push);
  }

  function storedConfig(id) {
    const channel = channelById(id);
    const raw = credentials.getProviderKey(credentialKey(id));
    if (!channel || !raw) return null;
    try {
      return channel.normalize(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function activeChannels(push = pushSettings()) {
    return CHANNEL_IDS.filter(id => push.channels[id].enabled && push.channels[id].boundAt && storedConfig(id));
  }

  // ---------- 选稿 ----------
  function lookbackHours(push) {
    return Math.max(36, push.mode === 'interval' ? (push.intervalMinutes * 2) / 60 : 36);
  }

  function selectItems(channelId, push, now = clock()) {
    const where = [VISIBLE_SQL, "COALESCE(a.translation_status, '') <> 'pending'",
      '(a.cluster_id IS NULL OR a.id = c.main_article_id)', 'a.fetched_at >= ?'];
    const params = [new Date(now.getTime() - lookbackHours(push) * 3600_000).toISOString()];
    if (push.scope === 'featured') where.push('a.featured = 1');
    if (push.domain !== 'all') { where.push("(a.domain = ? OR a.domain = 'both')"); params.push(push.domain); }
    if (channelId) {
      where.push(`NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.channel = ?
        AND (d.article_id = a.id OR (a.cluster_id IS NOT NULL AND d.cluster_id = a.cluster_id)))`);
      params.push(channelId);
    }
    const rows = db.prepare(`
      SELECT a.*, s.name AS source_name, s.tier, c.size AS cluster_size
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      LEFT JOIN clusters c ON c.id = a.cluster_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.fetched_at DESC
      LIMIT 400`).all(...params);
    return rows.map(row => ({ ...mapRow(row), clusterId: row.cluster_id ?? null, id: row.id }))
      .filter(item => push.minHeat === 0 || (Number.isFinite(item.heat) && item.heat >= push.minHeat))
      .sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1)
        || String(b.publishedAt || b.fetchedAt).localeCompare(String(a.publishedAt || a.fetchedAt)))
      .slice(0, push.maxItems);
  }

  // ---------- 投递 ----------
  async function deliverWithRetry(id, config, message, { signal } = {}) {
    const channel = CHANNELS[id];
    for (let attempt = 0; ; attempt++) {
      try {
        await deliver(channel, config, message, { fetchImpl, signal, sleep, nowMs: clock().getTime() });
        return;
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!(error instanceof PushChannelError) || !error.retryable || delay === undefined || signal?.aborted || stopping) throw error;
        await sleep(delay);
        if (signal?.aborted || stopping) throw new PushChannelError('推送已取消');
      }
    }
  }

  function record({ trigger, channel, ok, skipped = false, count = 0, error = null, started }) {
    try {
      insertLog.run(clock().toISOString(), trigger, channel, ok ? 1 : 0, skipped ? 1 : 0, count,
        error ? String(error).slice(0, 300) : null, Math.max(0, Date.now() - started));
      pruneLog.run(HISTORY_LIMIT);
    } catch (logError) {
      logger.warn?.('[push] 推送记录写入失败:', logError.message);
    }
  }

  async function pushChannel(id, push, trigger, signal) {
    const started = Date.now();
    const config = storedConfig(id);
    if (!config) {
      record({ trigger, channel: id, ok: false, error: '连接信息缺失，请重新绑定', started });
      return { channel: id, ok: false, error: '连接信息缺失，请重新绑定' };
    }
    const now = clock();
    const items = selectItems(id, push, now);
    if (!items.length && push.skipEmpty) {
      record({ trigger, channel: id, ok: true, skipped: true, started });
      return { channel: id, ok: true, skipped: true, count: 0 };
    }
    const digest = items.length ? digestHeadline({ items, scope: push.scope, now })
      : { kind: 'empty', title: '摘星阁 · 情报推送', lead: `${formatStamp(now)} · 本时段暂无符合条件的新情报` };
    const message = composeMessage(digest, items, { now });
    const sent = items.slice(0, message.count);
    try {
      await deliverWithRetry(id, config, message, { signal });
    } catch (error) {
      const text = String(error?.message || error);
      record({ trigger, channel: id, ok: false, count: sent.length, error: text, started });
      return { channel: id, ok: false, error: text, count: 0 };
    }
    const at = clock().toISOString();
    try {
      for (const item of sent) insertDelivery.run(id, item.id, item.clusterId, at);
    } catch (error) {
      logger.warn?.('[push] 投递记录写入失败:', error.message);
    }
    record({ trigger, channel: id, ok: true, count: sent.length, started });
    return { channel: id, ok: true, count: sent.length };
  }

  function runPush(trigger = 'manual', { channels = null } = {}) {
    if (stopping) return Promise.resolve({ skipped: true, reason: 'stopping', results: [] });
    if (running) return running;
    const push = pushSettings();
    const targets = (channels || activeChannels(push)).filter(id => activeChannels(push).includes(id));
    abort = new AbortController();
    const signal = abort.signal;
    running = (async () => {
      try {
        if (!targets.length) return { skipped: true, reason: 'no-channel', results: [] };
        const results = [];
        for (const id of targets) {
          if (stopping) break;
          results.push(await pushChannel(id, push, trigger, signal));
        }
        try { pruneDeliveries.run(new Date(clock().getTime() - DELIVERY_RETENTION_DAYS * 86400_000).toISOString()); } catch {}
        writeState({ lastRunAt: clock().toISOString(), lastTrigger: trigger });
        const delivered = results.filter(result => result.ok && !result.skipped);
        if (delivered.length) logger.log?.(`[push] ${trigger} 推送完成：${delivered.map(result => `${CHANNELS[result.channel].shortName} ${result.count} 条`).join('，')}`);
        return { skipped: false, results };
      } finally {
        running = null;
        abort = null;
      }
    })();
    return running;
  }

  // ---------- 定时 ----------
  function cursor(state = readState()) {
    const value = Date.parse(state.cursor || '');
    return Number.isFinite(value) ? new Date(value) : null;
  }

  async function tick() {
    if (!started || stopping || running) return;
    let push;
    try { push = pushSettings(); } catch { return; }
    const now = clock();
    const state = readState();
    const last = cursor(state);
    // 开启推送、绑定或重新启用渠道时游标都会重置为当下：之后只推新时刻，不会把过去的时刻补推一遍
    if (!push.enabled || !activeChannels(push).length) return;
    if (!last) {
      writeState({ cursor: now.toISOString() });
      return;
    }
    const due = latestDueSlot(push, last, now);
    if (!due) return;
    writeState({ cursor: due.toISOString() });
    if (now.getTime() - due.getTime() > CATCH_UP_WINDOW_MS) return;
    try {
      await runPush(now.getTime() - due.getTime() > 5 * 60_000 ? 'catch-up' : 'schedule');
    } catch (error) {
      logger.error?.('[push]', error);
    }
  }

  function schedule() {
    if (!started || stopping) return;
    timer = setTimeout(async () => {
      timer = null;
      await tick();
      schedule();
    }, tickMs);
    timer.unref?.();
  }

  function start() {
    if (started) return;
    started = true;
    stopping = false;
    tick().finally(schedule);
  }

  function stop() {
    stopping = true;
    started = false;
    if (timer) clearTimeout(timer);
    timer = null;
    abort?.abort();
    pending.clear();
  }

  async function waitForIdle() {
    while (running) await running.catch(() => {});
  }

  // ---------- 绑定 ----------
  function requireChannel(id) {
    const channel = channelById(id);
    if (!channel) throw httpError(404, '不支持的推送渠道');
    return channel;
  }

  function verificationDigest(code) {
    return {
      kind: 'verify',
      title: '摘星阁 · 绑定验证',
      lead: '你正在把这个机器人绑定到本机的摘星阁。请在摘星阁 设置 → 新闻推送 中输入下面的 6 位验证码完成绑定，10 分钟内有效；如非本人操作请忽略。',
      code
    };
  }

  async function startBinding(id, input) {
    const channel = requireChannel(id);
    if (stopping) throw httpError(503, '服务正在退出');
    const config = channel.normalize(input && typeof input === 'object' ? input : {});
    const code = randomCode();
    try {
      await deliverWithRetry(id, config, composeMessage(verificationDigest(code), [], { now: clock() }));
    } catch (error) {
      pending.delete(id);
      return { ok: false, error: String(error?.message || error) };
    }
    pending.set(id, { config, code, expiresAt: clock().getTime() + CODE_TTL_MS, attempts: 0 });
    return { ok: true, expiresInSeconds: CODE_TTL_MS / 1000, ...channel.describe(config) };
  }

  async function confirmBinding(id, code) {
    const channel = requireChannel(id);
    const entry = pending.get(id);
    if (!entry || entry.expiresAt < clock().getTime()) {
      pending.delete(id);
      throw httpError(400, '验证码已过期或尚未发送，请重新发送验证码');
    }
    const typed = String(code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(typed)) throw httpError(400, '请输入手机上收到的 6 位数字验证码');
    const expected = Buffer.from(entry.code);
    if (!crypto.timingSafeEqual(Buffer.from(typed.padEnd(6, '0').slice(0, 6)), expected)) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_CODE_ATTEMPTS) {
        pending.delete(id);
        throw httpError(400, '验证码错误次数过多，请重新发送验证码');
      }
      throw httpError(400, `验证码不正确，还可尝试 ${MAX_CODE_ATTEMPTS - entry.attempts} 次`);
    }
    pending.delete(id);
    const boundAt = clock().toISOString();
    await coordinator.transact(settings => {
      const next = structuredClone(settings);
      const push = normalizePushSettings(next.push);
      push.channels[id] = { enabled: true, boundAt };
      next.push = push;
      return { settings: next, credentials: { [credentialKey(id)]: JSON.stringify(entry.config) }, result: true };
    });
    writeState({ cursor: boundAt });
    const push = pushSettings();
    // 绑定成功回执：让手机端立刻看到推送节奏，失败不影响绑定结果
    deliverWithRetry(id, entry.config, composeMessage({
      kind: 'test',
      title: '摘星阁 · 绑定成功',
      lead: `${channel.name}已绑定。${push.enabled ? `推送节奏：${describeSchedule(push)}。` : '在设置页打开“定时推送”后即按你设定的节奏推送新情报。'}`
    }, [], { now: clock() })).catch(() => {});
    return { ok: true, boundAt };
  }

  async function unbind(id) {
    requireChannel(id);
    pending.delete(id);
    await coordinator.transact(settings => {
      const next = structuredClone(settings);
      const push = normalizePushSettings(next.push);
      push.channels[id] = { enabled: false, boundAt: null };
      next.push = push;
      return {
        settings: next,
        credentials: credentials.getProviderKey(credentialKey(id)) ? { [credentialKey(id)]: '' } : {},
        result: true
      };
    });
    try { clearDeliveries.run(id); } catch {}
    return { ok: true };
  }

  async function setChannelEnabled(id, enabled) {
    requireChannel(id);
    if (typeof enabled !== 'boolean') throw httpError(400, '启用状态必须是布尔值');
    await coordinator.transact(settings => {
      const next = structuredClone(settings);
      const push = normalizePushSettings(next.push);
      if (!push.channels[id].boundAt || !storedConfig(id)) throw httpError(400, '请先完成绑定');
      push.channels[id] = { ...push.channels[id], enabled };
      next.push = push;
      return { settings: next, result: true };
    });
    if (enabled) writeState({ cursor: clock().toISOString() });
    return { ok: true };
  }

  async function testChannel(id) {
    requireChannel(id);
    const config = storedConfig(id);
    if (!config) throw httpError(400, '请先完成绑定');
    const started = Date.now();
    const push = pushSettings();
    const now = clock();
    const items = selectItems(null, { ...push, maxItems: Math.min(3, push.maxItems) }, now);
    const message = composeMessage({
      kind: 'test',
      title: '摘星阁 · 测试推送',
      lead: `${formatStamp(now)} · 这是一条测试消息${items.length ? `，附最近 ${items.length} 条情报预览（不计入推送记录）` : ''}。推送节奏：${describeSchedule(push)}${push.enabled ? '' : '（定时推送尚未开启）'}。`
    }, items, { now });
    try {
      await deliverWithRetry(id, config, message);
    } catch (error) {
      const text = String(error?.message || error);
      record({ trigger: 'test', channel: id, ok: false, error: text, started });
      return { ok: false, error: text };
    }
    record({ trigger: 'test', channel: id, ok: true, count: message.count, started });
    return { ok: true, count: message.count };
  }

  async function updateSettings(patch) {
    const next = await coordinator.transact(settings => {
      const updated = structuredClone(settings);
      const current = normalizePushSettings(settings.push);
      updated.push = { ...applyPushPatch(current, patch), channels: current.channels };
      return { settings: updated, result: updated.push };
    });
    // 节奏改了从现在重新起算，避免刚保存就把新节奏下“已经过去”的时刻补推出去
    writeState({ cursor: clock().toISOString() });
    return next;
  }

  // ---------- 视图 ----------
  function historyView(limit = 12) {
    return recentLog.all(limit).map(row => ({
      at: row.at, trigger: row.trigger, channel: row.channel, channelName: CHANNELS[row.channel]?.shortName || row.channel,
      ok: Boolean(row.ok), skipped: Boolean(row.skipped), count: row.item_count, error: row.error || null, durationMs: row.duration_ms
    }));
  }

  function view() {
    const settings = loadSettings();
    const push = pushSettings(settings);
    const active = activeChannels(push);
    const now = clock();
    const state = readState();
    const last = cursor(state);
    const next = push.enabled && active.length ? nextSlot(push, last && last > now ? last : now) : null;
    const summary = totals.get();
    return {
      settings: { ...push, channels: undefined },
      schedule: describeSchedule(push),
      nextRunAt: next ? next.toISOString() : null,
      running: Boolean(running),
      collectAutomatic: settings.collect?.automatic === true,
      lastRunAt: state.lastRunAt || null,
      totals: { pushes: summary.pushes, items: summary.items },
      channels: CHANNEL_IDS.map(id => {
        const channel = CHANNELS[id];
        const config = storedConfig(id);
        const entry = pending.get(id);
        return {
          id, name: channel.name, shortName: channel.shortName,
          bound: Boolean(config && push.channels[id].boundAt),
          enabled: Boolean(config && push.channels[id].enabled),
          boundAt: config ? push.channels[id].boundAt : null,
          ...(config ? channel.describe(config) : {}),
          pending: Boolean(entry && entry.expiresAt > now.getTime())
        };
      }),
      history: historyView()
    };
  }

  function preview() {
    const push = pushSettings();
    const items = selectItems(activeChannels(push)[0] || null, push);
    return {
      scope: push.scope,
      items: items.map(item => ({ title: item.titleZh || item.title, url: item.url, source: item.source, heat: item.heat, domain: item.domain }))
    };
  }

  return Object.freeze({
    start, stop, waitForIdle, tick, runPush, selectItems,
    startBinding, confirmBinding, unbind, setChannelEnabled, testChannel, updateSettings,
    view, preview, storedConfig
  });
}

module.exports = { createPushService, CREDENTIAL_PREFIX, credentialKey };
