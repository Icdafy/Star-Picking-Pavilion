'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { CHANNELS, deliver, PushChannelError } = require('../server/push/channels');
const { composeMessage, markdownSafe, safeLink, FEISHU_MAX_BYTES } = require('../server/push/compose');
const {
  normalizePushSettings, applyPushPatch, nextSlot, latestDueSlot, describeSchedule
} = require('../server/push/schedule');
const { createPushService } = require('../server/push/service');
const { pushPatchFromForm, formatPushMoment, describeCountdown } = require('../renderer/settings-form-controller');

const FEISHU_HOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/0a1b2c3d-4e5f-6789-abcd-ef0123456789';
const DINGTALK_HOOK = 'https://oapi.dingtalk.com/robot/send?access_token=' + 'a'.repeat(64);

function local(y, m, d, h, min) {
  return new Date(y, m - 1, d, h, min);
}

// ---------- 渠道协议 ----------
test('飞书加签按官方算法：key 为“秒级时间戳\\n密钥”，对空消息做 HmacSHA256 后 Base64', () => {
  const config = CHANNELS.feishu.normalize({ webhook: ` ${FEISHU_HOOK} `, secret: 'feishu-secret' });
  const nowMs = 1_760_000_000_123;
  const request = CHANNELS.feishu.buildRequest({ feishu: { msg_type: 'text', content: { text: '摘星阁' } } }, config, { nowMs });
  const body = JSON.parse(request.body);
  const timestamp = String(Math.floor(nowMs / 1000));
  assert.equal(body.timestamp, timestamp);
  assert.equal(body.sign, crypto.createHmac('sha256', `${timestamp}\nfeishu-secret`).update('').digest('base64'));
  assert.equal(request.url, FEISHU_HOOK);
  assert.equal(body.msg_type, 'text');
  assert.equal(CHANNELS.feishu.describe(config).target.includes('6789'), true);
  assert.equal(CHANNELS.feishu.describe(config).target.includes('0a1b2c3d'), false, '掩码不得露出完整 token');
});

test('飞书只接受官方 Webhook 主机与路径，拒绝伪造主机、查询串与非 HTTPS', () => {
  for (const webhook of [
    'http://open.feishu.cn/open-apis/bot/v2/hook/0a1b2c3d4e5f',
    'https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/0a1b2c3d4e5f',
    'https://open.feishu.cn/open-apis/bot/v2/hook/0a1b2c3d4e5f?x=1',
    'https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/0a1b2c3d4e5f',
    'https://open.feishu.cn/open-apis/im/v1/messages',
    ''
  ]) {
    assert.throws(() => CHANNELS.feishu.normalize({ webhook }), error => error.statusCode === 400, webhook);
  }
  assert.doesNotThrow(() => CHANNELS.feishu.normalize({ webhook: 'https://open.larksuite.com/open-apis/bot/v2/hook/0a1b2c3d4e5f' }));
  assert.throws(() => CHANNELS.feishu.normalize({ webhook: FEISHU_HOOK, secret: 'has space' }), /格式错误/);
});

test('钉钉加签：HmacSHA256(key=密钥, message=“毫秒时间戳\\n密钥”)，Base64 后 URL 编码拼进查询串', () => {
  const config = CHANNELS.dingtalk.normalize({ webhook: DINGTALK_HOOK, secret: 'SECabc+/=' });
  const nowMs = 1_760_000_000_123;
  const request = CHANNELS.dingtalk.buildRequest({ dingtalk: { msgtype: 'markdown', markdown: { title: 't', text: 'x' } } }, config, { nowMs });
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('timestamp'), String(nowMs));
  const expected = crypto.createHmac('sha256', 'SECabc+/=').update(`${nowMs}\nSECabc+/=`).digest('base64');
  assert.equal(url.searchParams.get('sign'), expected);
  assert.match(request.url, /&sign=[^&]*%2B|&sign=[^&]*%2F|&sign=[^&]*%3D/, '签名必须做 URL 编码');
  assert.throws(() => CHANNELS.dingtalk.normalize({ webhook: `${DINGTALK_HOOK}&redirect=https://x` }), error => error.statusCode === 400);
  assert.throws(() => CHANNELS.dingtalk.normalize({ webhook: 'https://oapi.dingtalk.com/robot/send?access_token=short' }), error => error.statusCode === 400);
});

test('QQ 走 OneBot v11：私聊 / 群聊接口、Bearer 鉴权，公网明文地址被拒绝', () => {
  const privateConfig = CHANNELS.qq.normalize({ baseUrl: 'http://127.0.0.1:3000/', targetId: '123456789', accessToken: 'tok' });
  const request = CHANNELS.qq.buildRequest({ qq: ['你好'] }, privateConfig, {});
  assert.equal(request.url, 'http://127.0.0.1:3000/send_private_msg');
  assert.equal(request.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(request.body), { user_id: 123456789, message: [{ type: 'text', data: { text: '你好' } }], auto_escape: true });
  const group = CHANNELS.qq.normalize({ baseUrl: 'http://192.168.1.8:3000', targetId: '987654321', targetType: 'group' });
  assert.equal(CHANNELS.qq.buildRequest({ qq: ['x'] }, group, {}).url, 'http://192.168.1.8:3000/send_group_msg');
  assert.equal(CHANNELS.qq.buildRequest({ qq: ['x'] }, group, {}).headers.Authorization, undefined);
  assert.throws(() => CHANNELS.qq.normalize({ baseUrl: 'http://bot.example.com:3000', targetId: '123456789' }), /HTTPS/);
  assert.throws(() => CHANNELS.qq.normalize({ baseUrl: 'http://127.0.0.1:3000', targetId: '0123' }), error => error.statusCode === 400);
  assert.match(CHANNELS.qq.describe(privateConfig).target, /^127\.0\.0\.1:3000 · 私聊 12•+89$/);
});

test('平台错误码翻译成可操作的中文提示，限流与 5xx 标记为可重试', () => {
  assert.throws(() => CHANNELS.feishu.interpret(200, { code: 19024, msg: 'Key Words Not Found' }),
    error => error instanceof PushChannelError && /关键词/.test(error.message) && /摘星阁/.test(error.message) && !error.retryable);
  assert.throws(() => CHANNELS.feishu.interpret(200, { code: 11232 }), error => error.retryable);
  assert.throws(() => CHANNELS.dingtalk.interpret(200, { errcode: 310000, errmsg: 'sign not match' }), /签名校验失败/);
  assert.throws(() => CHANNELS.dingtalk.interpret(200, { errcode: 310000, errmsg: 'keywords not in content' }), /关键词/);
  assert.throws(() => CHANNELS.dingtalk.interpret(200, { errcode: 130101, errmsg: 'send too fast' }), error => error.retryable);
  assert.throws(() => CHANNELS.qq.interpret(401, null), /Access Token/);
  assert.throws(() => CHANNELS.qq.interpret(200, { status: 'failed', retcode: 1200, wording: '不是好友' }), /不是好友/);
  assert.doesNotThrow(() => CHANNELS.feishu.interpret(200, { code: 0, msg: 'success' }));
  assert.doesNotThrow(() => CHANNELS.dingtalk.interpret(200, { errcode: 0, errmsg: 'ok' }));
  assert.doesNotThrow(() => CHANNELS.qq.interpret(200, { status: 'ok', retcode: 0, data: { message_id: 1 } }));
});

test('投递不跟随重定向，网络错误给出中文原因', async () => {
  const seen = [];
  const config = CHANNELS.feishu.normalize({ webhook: FEISHU_HOOK });
  await deliver(CHANNELS.feishu, config, { feishu: { msg_type: 'text' } }, {
    fetchImpl: async (url, options) => { seen.push(options); return new Response('{"code":0}', { status: 200 }); }
  });
  assert.equal(seen[0].redirect, 'error');
  await assert.rejects(deliver(CHANNELS.qq, CHANNELS.qq.normalize({ baseUrl: 'http://127.0.0.1:1', targetId: '12345' }), { qq: ['x'] }, {
    fetchImpl: async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ECONNREFUSED' }; throw error; }
  }), error => /NapCat/.test(error.message) && error.retryable);
});

// ---------- 排版 ----------
test('标题里的 Markdown 控制字符被中和，只放行 http(s) 链接且括号被编码', () => {
  assert.equal(markdownSafe('A](javascript:alert(1)) *粗* <b>'), 'A］（javascript:alert（1）） ＊粗＊ ＜b＞');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('https://example.com/a (1).html'), 'https://example.com/a%20%281%29.html');
  const message = composeMessage({ kind: 'digest', title: '摘星阁 · 精选情报推送', lead: '测试' }, [
    { title: '恶意](https://evil.example) 标题', url: 'https://news.example/x(1)', summary: '摘要 **强调**', source: '来源', heat: 88.6, domain: 'aerospace', category: '发射与任务' }
  ]);
  const card = JSON.stringify(message.feishu);
  assert.doesNotMatch(card, /\]\(https:\/\/evil/);
  assert.match(card, /\[恶意］（https:\/\/evil\.example） 标题\]\(https:\/\/news\.example\/x%281%29\)/);
  assert.match(message.dingtalk.markdown.text, /热度 89/);
  assert.match(message.dingtalk.markdown.title, /摘星阁/, '标题含关键词，关键词安全模式也能通过');
  assert.match(message.qq[0], /^【摘星阁 · 精选情报推送】/);
});

test('请求体超过平台上限时从末尾舍弃条目；QQ 长消息按条目边界切分', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    title: `${'很长的标题'.repeat(16)}${index}`, url: `https://news.example/${index}`,
    summary: '摘要'.repeat(200), source: '来源'.repeat(10), heat: 90 - index, domain: 'lowaltitude', category: '企业动态'
  }));
  const message = composeMessage({ kind: 'digest', title: '摘星阁 · 精选情报推送', lead: '测试' }, items);
  assert.ok(Buffer.byteLength(JSON.stringify(message.feishu)) <= FEISHU_MAX_BYTES);
  assert.ok(message.count >= 1 && message.count <= 20);
  assert.ok(message.qq.length > 1 && message.qq.length <= 4);
  assert.ok(message.qq.every(part => [...part].length <= 1600));
  assert.match(message.qq.at(-1), /由你本机的摘星阁发送/);
});

// ---------- 节奏 ----------
test('每隔 N 小时从起始时刻对齐，免打扰跨午夜跳过，推送日生效', () => {
  const hourly = normalizePushSettings({ mode: 'interval', intervalMinutes: 60, anchor: '08:00', quietEnabled: true, quietStart: '23:00', quietEnd: '07:30' });
  assert.deepEqual(nextSlot(hourly, local(2026, 10, 16, 14, 20)), local(2026, 10, 16, 15, 0));
  assert.deepEqual(nextSlot(hourly, local(2026, 10, 16, 15, 0)), local(2026, 10, 16, 16, 0), '严格晚于游标');
  assert.deepEqual(nextSlot(hourly, local(2026, 10, 16, 22, 30)), local(2026, 10, 17, 8, 0), '23:00—07:30 免打扰');
  const threeHours = normalizePushSettings({ mode: 'interval', intervalMinutes: 180, anchor: '08:00', quietEnabled: false });
  assert.deepEqual(nextSlot(threeHours, local(2026, 10, 16, 9, 0)), local(2026, 10, 16, 11, 0));
  assert.deepEqual(nextSlot(threeHours, local(2026, 10, 16, 23, 30)), local(2026, 10, 17, 2, 0));
  const weekdays = normalizePushSettings({ mode: 'times', times: ['09:00'], weekdays: [1, 2, 3, 4, 5] });
  // 2026-10-16 是周五，下一次应跳过周末到周一
  assert.deepEqual(nextSlot(weekdays, local(2026, 10, 16, 10, 0)), local(2026, 10, 19, 9, 0));
  assert.equal(describeSchedule(weekdays), '工作日 09:00 定点推送，23:00—07:30 免打扰');
  assert.equal(nextSlot(normalizePushSettings({ mode: 'times', times: ['01:00'], quietStart: '00:00', quietEnd: '06:00' }), local(2026, 10, 16, 0, 0)), null);
});

test('错过多个时刻只补推最近一次', () => {
  const hourly = normalizePushSettings({ mode: 'interval', intervalMinutes: 60, anchor: '00:00', quietEnabled: false });
  assert.deepEqual(latestDueSlot(hourly, local(2026, 10, 16, 8, 0), local(2026, 10, 16, 13, 40)), local(2026, 10, 16, 13, 0));
  assert.equal(latestDueSlot(hourly, local(2026, 10, 16, 13, 0), local(2026, 10, 16, 13, 59)), null);
});

test('推送设置补丁逐字段校验，拒绝未知字段与非法取值', () => {
  const base = normalizePushSettings({});
  assert.equal(base.enabled, false, '默认关闭');
  assert.deepEqual(applyPushPatch(base, { mode: 'times', times: '8:05, 12:30，18:30 12:30' }).times, ['08:05', '12:30', '18:30']);
  assert.throws(() => applyPushPatch(base, { times: '25:00' }), /25:00/);
  assert.throws(() => applyPushPatch(base, { intervalMinutes: 7 }), /列表/);
  assert.throws(() => applyPushPatch(base, { weekdays: [] }), /推送日/);
  assert.throws(() => applyPushPatch(base, { maxItems: 50 }), /1 到 20/);
  assert.throws(() => applyPushPatch(base, { webhook: 'x' }), /不支持/);
  assert.throws(() => applyPushPatch(base, { enabled: 'yes' }), /布尔/);
  const channels = normalizePushSettings({ channels: { feishu: { enabled: true, boundAt: 'bad' } } }).channels;
  assert.deepEqual(channels.feishu, { enabled: false, boundAt: null }, '没有绑定时间的渠道不能启用');
});

// ---------- 服务 ----------
function createHarness({ now = local(2026, 10, 16, 14, 20) } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT, tier TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY, main_article_id INTEGER, size INTEGER);
    CREATE TABLE articles (id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, fetched_at TEXT, published_at TEXT,
      domain TEXT, relevant INTEGER, analyzed INTEGER, featured INTEGER, translation_status TEXT, cluster_id INTEGER, quality_score REAL);
    CREATE TABLE push_deliveries (channel TEXT NOT NULL, article_id INTEGER NOT NULL, cluster_id INTEGER, pushed_at TEXT NOT NULL, PRIMARY KEY (channel, article_id));
    CREATE TABLE push_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, trigger TEXT NOT NULL, channel TEXT NOT NULL, ok INTEGER NOT NULL,
      skipped INTEGER NOT NULL DEFAULT 0, item_count INTEGER NOT NULL DEFAULT 0, error TEXT, duration_ms INTEGER);
    INSERT INTO sources VALUES (1, '官方源', 'T1');
  `);
  const clock = { value: now };
  let settings = { collect: { automatic: true }, push: normalizePushSettings({}) };
  const keys = {};
  const requests = [];
  let responder = () => ({ status: 200, body: { code: 0 } });
  const harness = {
    db, clock, requests, keys,
    get settings() { return settings; },
    respond(fn) { responder = fn; },
    addArticle({ id, featured = 1, minutesAgo = 30, cluster = null, quality = 80, domain = 'aerospace' }) {
      db.prepare(`INSERT INTO articles VALUES (?, 1, ?, ?, ?, ?, ?, 1, 1, ?, NULL, ?, ?)`).run(
        id, `情报 ${id}`, `https://news.example/${id}`, new Date(clock.value.getTime() - minutesAgo * 60_000).toISOString(), null,
        domain, featured, cluster, quality);
    }
  };
  harness.service = createPushService({
    db,
    loadSettings: () => structuredClone(settings),
    coordinator: {
      async transact(mutate) {
        const update = await mutate(structuredClone(settings));
        for (const [key, value] of Object.entries(update.credentials || {})) {
          if (value) keys[key] = value; else delete keys[key];
        }
        if (update.settings) settings = { ...update.settings, push: normalizePushSettings(update.settings.push) };
        return update.result;
      }
    },
    credentials: { getProviderKey: key => keys[key] || '' },
    mapRow: row => ({ id: row.id, title: row.title, url: row.url, source: 'src', domain: row.domain, heat: row.quality_score,
      publishedAt: row.published_at, fetchedAt: row.fetched_at, featured: Boolean(row.featured) }),
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      const reply = responder(requests.length);
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    },
    clock: () => clock.value,
    sleep: async () => {},
    randomCode: () => '424242',
    logger: { log() {}, warn() {}, error() {} }
  });
  return harness;
}

async function bindFeishu(harness) {
  const started = await harness.service.startBinding('feishu', { webhook: FEISHU_HOOK, secret: 'sec' });
  assert.equal(started.ok, true);
  assert.match(JSON.stringify(harness.requests.at(-1).body), /424242/, '验证码随消息送到手机');
  await harness.service.confirmBinding('feishu', '424242');
}

test('绑定：验证码送达后才加密保存连接信息；错码限次、过期失效', async () => {
  const harness = createHarness();
  assert.equal(harness.service.view().channels.find(channel => channel.id === 'feishu').bound, false);
  await harness.service.startBinding('feishu', { webhook: FEISHU_HOOK, secret: 'sec' });
  assert.equal(harness.keys['push-feishu'], undefined, '验证前不落盘');
  await assert.rejects(harness.service.confirmBinding('feishu', '000000'), /还可尝试 4 次/);
  await harness.service.confirmBinding('feishu', '424242');
  assert.deepEqual(JSON.parse(harness.keys['push-feishu']), { webhook: FEISHU_HOOK, secret: 'sec' });
  const view = harness.service.view();
  const feishu = view.channels.find(channel => channel.id === 'feishu');
  assert.equal(feishu.bound, true);
  assert.equal(feishu.enabled, true);
  assert.doesNotMatch(JSON.stringify(view), /0a1b2c3d|"sec"/, '视图不得包含 Webhook token 或密钥');

  await harness.service.startBinding('dingtalk', { webhook: DINGTALK_HOOK });
  harness.clock.value = new Date(harness.clock.value.getTime() + 11 * 60_000);
  await assert.rejects(harness.service.confirmBinding('dingtalk', '424242'), /过期/);
  for (let attempt = 0; attempt < 4; attempt++) {
    await harness.service.startBinding('qq', { baseUrl: 'http://127.0.0.1:3000', targetId: '123456' }).catch(() => {});
  }
  await assert.rejects(harness.service.startBinding('wechat', {}), error => error.statusCode === 404);

  harness.respond(() => ({ status: 200, body: { code: 19021, msg: 'sign match fail' } }));
  const failed = await harness.service.startBinding('feishu', { webhook: FEISHU_HOOK, secret: 'wrong' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /签名校验失败/);
  assert.equal(JSON.parse(harness.keys['push-feishu']).secret, 'sec', '失败的重新绑定不覆盖已有连接');
});

test('推送按热度挑选未推过的精选，同一事件只推一次，第二轮不重复', async () => {
  const harness = createHarness();
  await bindFeishu(harness);
  harness.db.exec("INSERT INTO clusters VALUES (7, 3, 2)");
  harness.addArticle({ id: 1, quality: 60 });
  harness.addArticle({ id: 2, quality: 95 });
  harness.addArticle({ id: 3, quality: 70, cluster: 7 });
  harness.addArticle({ id: 4, featured: 0, quality: 99 });
  harness.addArticle({ id: 5, quality: 99, minutesAgo: 60 * 72 });
  const first = await harness.service.runPush('manual');
  assert.deepEqual(first.results.map(result => [result.channel, result.ok, result.count]), [['feishu', true, 3]]);
  const card = JSON.stringify(harness.requests.at(-1).body.card);
  assert.ok(card.indexOf('情报 2') < card.indexOf('情报 3') && card.indexOf('情报 3') < card.indexOf('情报 1'), '按热度排序');
  assert.doesNotMatch(card, /情报 4|情报 5/, '非精选与超出回看窗口的不推');

  // 事件簇换了主条：同一事件不能再推一次
  harness.addArticle({ id: 6, quality: 90, cluster: 7 });
  harness.db.exec('UPDATE clusters SET main_article_id = 6 WHERE id = 7');
  const second = await harness.service.runPush('manual');
  assert.deepEqual(second.results.map(result => [result.ok, result.skipped]), [[true, true]]);
  assert.equal(harness.service.view().history[0].skipped, true);
});

test('限流自动退避重试；最终失败写入记录且不标记为已推送', async () => {
  const harness = createHarness();
  await bindFeishu(harness);
  harness.addArticle({ id: 1 });
  const before = harness.requests.length;
  harness.respond(index => index - before === 1 ? { status: 200, body: { code: 11232 } } : { status: 200, body: { code: 0 } });
  const retried = await harness.service.runPush('manual');
  assert.equal(retried.results[0].ok, true);
  assert.equal(harness.requests.length - before, 2);

  harness.addArticle({ id: 2 });
  harness.respond(() => ({ status: 200, body: { code: 19024 } }));
  const failed = await harness.service.runPush('manual');
  assert.equal(failed.results[0].ok, false);
  assert.match(failed.results[0].error, /关键词/);
  assert.equal(harness.db.prepare("SELECT COUNT(*) c FROM push_deliveries WHERE article_id = 2").get().c, 0);
  harness.respond(() => ({ status: 200, body: { code: 0 } }));
  assert.equal((await harness.service.runPush('manual')).results[0].count, 1, '失败的条目下次照常推送');
});

test('定时：开启后从下一个时刻起推；到点推送，关机错过的时刻只补一次', async () => {
  const harness = createHarness({ now: local(2026, 10, 16, 14, 20) });
  await bindFeishu(harness);
  await harness.service.updateSettings({ enabled: true, mode: 'interval', intervalMinutes: 60, anchor: '08:00', quietEnabled: false });
  harness.addArticle({ id: 1 });
  const start = harness.requests.length;
  // 计时器间隔设为 1 小时，由测试直接驱动 tick
  const service = createPushServiceClone(harness);
  await service.tick();
  assert.equal(harness.requests.length, start, '14:20 开启不补推 14:00');
  assert.equal(service.view().nextRunAt, local(2026, 10, 16, 15, 0).toISOString());

  harness.clock.value = local(2026, 10, 16, 15, 0);
  await service.tick();
  assert.equal(harness.requests.length, start + 1, '15:00 准点推送');

  harness.addArticle({ id: 2 });
  harness.clock.value = local(2026, 10, 16, 19, 40);
  await service.tick();
  assert.equal(harness.requests.length, start + 2, '错过 16—19 点只补推一次');
  assert.equal(service.view().history[0].trigger, 'catch-up');
  await service.tick();
  assert.equal(harness.requests.length, start + 2);
  service.stop();
});

// 与 harness 共享数据库与凭据，但计时器由测试直接驱动
function createPushServiceClone(harness) {
  const service = createPushService({
    db: harness.db,
    loadSettings: () => structuredClone(harness.settings),
    coordinator: { transact: async () => {} },
    credentials: { getProviderKey: key => harness.keys[key] || '' },
    mapRow: row => ({ id: row.id, title: row.title, url: row.url, heat: row.quality_score, fetchedAt: row.fetched_at, domain: row.domain }),
    fetchImpl: async (url, options) => {
      harness.requests.push({ url, body: JSON.parse(options.body) });
      return new Response('{"code":0}', { status: 200 });
    },
    clock: () => harness.clock.value,
    sleep: async () => {},
    tickMs: 3_600_000,
    logger: { log() {}, warn() {}, error() {} }
  });
  service.start();
  return service;
}

// ---------- 设置页纯函数 ----------
test('设置页表单在提交前拦下明显错误，定点模式才携带时刻', () => {
  const base = { mode: 'interval', interval: '120', anchor: '08:00', times: '08:30', weekdays: [1, 2, 3], quiet: true,
    quietStart: '23:00', quietEnd: '07:30', scope: 'featured', domain: 'all', maxItems: '8', minHeat: '0', skipEmpty: true };
  const { patch } = pushPatchFromForm(base);
  assert.equal(patch.intervalMinutes, 120);
  assert.equal(patch.times, undefined);
  assert.equal(pushPatchFromForm({ ...base, mode: 'times', times: '08:30, 18:30' }).patch.times, '08:30, 18:30');
  assert.match(pushPatchFromForm({ ...base, weekdays: [] }).error, /推送日/);
  assert.match(pushPatchFromForm({ ...base, maxItems: '0' }).error, /1 到 20/);
  assert.match(pushPatchFromForm({ ...base, minHeat: '120' }).error, /0 到 100/);
  assert.match(pushPatchFromForm({ ...base, mode: 'times', times: ' ' }).error, /推送时刻/);
});

test('下一次推送显示为今天 / 明天与倒计时', () => {
  const now = local(2026, 10, 16, 14, 20);
  assert.equal(formatPushMoment(local(2026, 10, 16, 15, 0), now), '今天 15:00');
  assert.equal(formatPushMoment(local(2026, 10, 17, 8, 30), now), '明天 08:30');
  assert.equal(formatPushMoment(local(2026, 10, 19, 9, 0), now), '10月19日 09:00');
  assert.equal(describeCountdown(local(2026, 10, 16, 15, 0), now), '约 40 分钟后');
  assert.equal(describeCountdown(local(2026, 10, 16, 17, 35), now), '约 3 小时 15 分后');
  assert.equal(describeCountdown(local(2026, 10, 16, 14, 21), now), '即将推送');
});
