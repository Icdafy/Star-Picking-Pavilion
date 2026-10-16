'use strict';
// 新闻推送 · 推送节奏（纯函数，不读时钟、不碰磁盘，便于逐分钟断言）
//   interval：从「起始时刻」开始每隔 N 分钟一次（N 只取能整除 24 小时的档位，每天的时刻表稳定可预期）
//   times：每天固定的若干个时刻（最多 12 个）
// 两种模式都受「推送日」与「免打扰时段」约束；落在免打扰里的时刻直接跳过，新闻顺延到下一次一起推。
const { CHANNEL_IDS } = require('./channels');

const INTERVAL_CHOICES = Object.freeze([15, 30, 60, 120, 180, 240, 360, 480, 720, 1440]);
const MAX_TIMES = 12;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULT_PUSH = Object.freeze({
  enabled: false,
  mode: 'interval',
  intervalMinutes: 60,
  anchor: '08:00',
  times: Object.freeze(['08:30', '12:30', '18:30']),
  weekdays: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
  quietEnabled: true,
  quietStart: '23:00',
  quietEnd: '07:30',
  scope: 'featured',
  domain: 'all',
  maxItems: 8,
  minHeat: 0,
  skipEmpty: true,
  channels: Object.freeze(Object.fromEntries(CHANNEL_IDS.map(id => [id, Object.freeze({ enabled: false, boundAt: null })])))
});

function minutesOf(text) {
  const match = TIME_PATTERN.exec(String(text || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function timeText(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function normalizeTimes(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,，、;；]+/) : [];
  const minutes = [...new Set(list.map(entry => minutesOf(String(entry).trim().replace(/^(\d):/, '0$1:'))).filter(entry => entry !== null))];
  return minutes.sort((a, b) => a - b).slice(0, MAX_TIMES).map(timeText);
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value)) return [...DEFAULT_PUSH.weekdays];
  return [...new Set(value.map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function normalizeBoundAt(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

// settings.json 里的 push 段：只存节奏、内容口径与每个渠道的启用 / 绑定时间，连接信息另存加密凭据。
function normalizePushSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const times = normalizeTimes(source.times);
  const channels = {};
  for (const id of CHANNEL_IDS) {
    const entry = source.channels?.[id];
    const boundAt = normalizeBoundAt(entry?.boundAt);
    channels[id] = { enabled: Boolean(boundAt) && entry?.enabled !== false, boundAt };
  }
  return {
    enabled: source.enabled === true,
    mode: source.mode === 'times' ? 'times' : 'interval',
    intervalMinutes: INTERVAL_CHOICES.includes(Number(source.intervalMinutes)) ? Number(source.intervalMinutes) : DEFAULT_PUSH.intervalMinutes,
    anchor: minutesOf(source.anchor) === null ? DEFAULT_PUSH.anchor : source.anchor,
    times: times.length ? times : [...DEFAULT_PUSH.times],
    weekdays: normalizeWeekdays(source.weekdays),
    quietEnabled: source.quietEnabled === undefined ? DEFAULT_PUSH.quietEnabled : source.quietEnabled === true,
    quietStart: minutesOf(source.quietStart) === null ? DEFAULT_PUSH.quietStart : source.quietStart,
    quietEnd: minutesOf(source.quietEnd) === null ? DEFAULT_PUSH.quietEnd : source.quietEnd,
    scope: source.scope === 'relevant' ? 'relevant' : 'featured',
    domain: ['lowaltitude', 'aerospace'].includes(source.domain) ? source.domain : 'all',
    maxItems: boundedInteger(source.maxItems, 1, 20, DEFAULT_PUSH.maxItems),
    minHeat: boundedInteger(source.minHeat, 0, 100, DEFAULT_PUSH.minHeat),
    skipEmpty: source.skipEmpty !== false,
    channels
  };
}

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

// 设置页提交的节奏 / 内容补丁：逐字段严格校验，错误点名字段，不静默改写用户的输入。
function applyPushPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('推送设置必须是对象');
  const allowed = ['enabled', 'mode', 'intervalMinutes', 'anchor', 'times', 'weekdays', 'quietEnabled', 'quietStart', 'quietEnd',
    'scope', 'domain', 'maxItems', 'minHeat', 'skipEmpty'];
  const unknown = Object.keys(patch).filter(key => !allowed.includes(key));
  if (unknown.length) throw invalid(`包含不支持的推送设置字段：${unknown.join('、')}`);
  const next = { ...normalizePushSettings(current) };
  for (const key of ['enabled', 'quietEnabled', 'skipEmpty']) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'boolean') throw invalid('开关字段必须是布尔值');
    next[key] = patch[key];
  }
  if (patch.mode !== undefined) {
    if (!['interval', 'times'].includes(patch.mode)) throw invalid('推送方式只能是“每隔一段时间”或“每天定点”');
    next.mode = patch.mode;
  }
  if (patch.intervalMinutes !== undefined) {
    if (!INTERVAL_CHOICES.includes(Number(patch.intervalMinutes))) throw invalid('推送间隔只能从列表中选择');
    next.intervalMinutes = Number(patch.intervalMinutes);
  }
  for (const key of ['anchor', 'quietStart', 'quietEnd']) {
    if (patch[key] === undefined) continue;
    if (minutesOf(patch[key]) === null) throw invalid('时刻请使用 24 小时制 HH:MM，例如 08:30');
    next[key] = patch[key];
  }
  if (patch.times !== undefined) {
    const raw = (Array.isArray(patch.times) ? patch.times : String(patch.times).split(/[\s,，、;；]+/))
      .map(entry => String(entry).trim()).filter(Boolean);
    if (!raw.length) throw invalid('请至少填写一个推送时刻，例如 08:30、12:30、18:30');
    const wrong = raw.find(entry => minutesOf(entry.replace(/^(\d):/, '0$1:')) === null);
    if (wrong) throw invalid(`推送时刻“${wrong.slice(0, 12)}”格式错误：请使用 24 小时制 HH:MM，多个时刻用逗号分隔`);
    const times = normalizeTimes(raw);
    if (times.length > MAX_TIMES || new Set(raw).size > MAX_TIMES) throw invalid(`每天最多 ${MAX_TIMES} 个推送时刻`);
    next.times = times;
  }
  if (patch.weekdays !== undefined) {
    const weekdays = normalizeWeekdays(patch.weekdays);
    if (!weekdays.length) throw invalid('请至少选择一个推送日');
    next.weekdays = weekdays;
  }
  if (patch.scope !== undefined) {
    if (!['featured', 'relevant'].includes(patch.scope)) throw invalid('推送范围无效');
    next.scope = patch.scope;
  }
  if (patch.domain !== undefined) {
    if (!['all', 'lowaltitude', 'aerospace'].includes(patch.domain)) throw invalid('推送领域无效');
    next.domain = patch.domain;
  }
  if (patch.maxItems !== undefined) {
    const value = Number(patch.maxItems);
    if (!Number.isInteger(value) || value < 1 || value > 20) throw invalid('每次推送条数必须是 1 到 20 的整数');
    next.maxItems = value;
  }
  if (patch.minHeat !== undefined) {
    const value = Number(patch.minHeat);
    if (!Number.isInteger(value) || value < 0 || value > 100) throw invalid('最低热度必须是 0 到 100 的整数');
    next.minHeat = value;
  }
  return next;
}

function slotMinutes(push) {
  if (push.mode === 'times') return push.times.map(minutesOf).filter(value => value !== null);
  const step = push.intervalMinutes;
  const start = minutesOf(push.anchor) % step;
  const list = [];
  for (let minute = start; minute < 1440; minute += step) list.push(minute);
  return list;
}

function isoWeekday(date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function inQuietHours(push, minute) {
  if (!push.quietEnabled) return false;
  const start = minutesOf(push.quietStart);
  const end = minutesOf(push.quietEnd);
  if (start === null || end === null || start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

// 返回严格晚于 after 的下一个推送时刻（本地时区）；没有可用时刻时返回 null。
function nextSlot(pushSettings, after) {
  const push = normalizePushSettings(pushSettings);
  const base = new Date(after);
  if (!Number.isFinite(base.getTime())) return null;
  const minutes = slotMinutes(push);
  if (!minutes.length || !push.weekdays.length) return null;
  for (let day = 0; day <= 8; day++) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + day);
    if (!push.weekdays.includes(isoWeekday(date))) continue;
    for (const minute of minutes) {
      if (inQuietHours(push, minute)) continue;
      const slot = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60);
      if (slot.getTime() > base.getTime()) return slot;
    }
  }
  return null;
}

// 最近一个已到期（≤ now）且晚于 after 的时刻：错过多个时刻（休眠、关机）只补推一次。
function latestDueSlot(pushSettings, after, now) {
  let due = null;
  let cursor = new Date(after);
  for (let guard = 0; guard < 2000; guard++) {
    const slot = nextSlot(pushSettings, cursor);
    if (!slot || slot.getTime() > new Date(now).getTime()) break;
    due = slot;
    cursor = slot;
  }
  return due;
}

function describeSchedule(pushSettings) {
  const push = normalizePushSettings(pushSettings);
  const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
  const days = push.weekdays.length === 7 ? '每天'
    : push.weekdays.join(',') === '1,2,3,4,5' ? '工作日'
      : push.weekdays.join(',') === '6,7' ? '周末'
        : `每周${push.weekdays.map(day => weekdayNames[day - 1]).join('、')}`;
  const rhythm = push.mode === 'times'
    ? `${push.times.join('、')} 定点推送`
    : push.intervalMinutes < 60 ? `${push.anchor} 起每 ${push.intervalMinutes} 分钟推送一次`
      : push.intervalMinutes === 1440 ? `${push.anchor} 推送一次`
        : `${push.anchor} 起每 ${push.intervalMinutes / 60} 小时推送一次`;
  const quiet = push.quietEnabled ? `，${push.quietStart}—${push.quietEnd} 免打扰` : '';
  return `${days} ${rhythm}${quiet}`;
}

module.exports = {
  DEFAULT_PUSH, INTERVAL_CHOICES, MAX_TIMES,
  normalizePushSettings, applyPushPatch, nextSlot, latestDueSlot, describeSchedule,
  inQuietHours, slotMinutes, minutesOf
};
