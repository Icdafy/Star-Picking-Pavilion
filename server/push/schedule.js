'use strict';
// 新闻推送 · 推送时间规则（纯函数，不读时钟、不碰磁盘，便于逐分钟断言）
//   times：每天固定的若干个时刻（最多 12 个）。用户点名的时刻一定会推，不受任何时段限制。
//   interval：在「推送时段」内从时段开始起每隔 N 分钟一次，例如 08:00—22:00 每 2 小时 = 08:00、10:00 … 22:00。
// 两种方式都只在选中的「推送日」生效。v0.2.36 起不再有独立的起始时刻与免打扰：
// 旧版的“起始时刻 + 免打扰”会悄悄吞掉用户亲手设定的时刻，改为一个看得见的推送时段。
const { CHANNEL_IDS } = require('./channels');

const INTERVAL_CHOICES = Object.freeze([15, 30, 60, 120, 180, 240, 360, 480, 720]);
const MAX_TIMES = 12;
const DAY_MINUTES = 1440;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULT_PUSH = Object.freeze({
  enabled: false,
  mode: 'times',
  times: Object.freeze(['08:30', '12:30', '18:30']),
  intervalMinutes: 120,
  windowStart: '08:00',
  windowEnd: '22:00',
  weekdays: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
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

// 时段结束允许 24:00（= 当天结束）
function endMinutesOf(text) {
  return String(text) === '24:00' ? DAY_MINUTES : minutesOf(text);
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

// 推送时段：优先读新字段；v0.2.35 的设置把“免打扰的结束—开始”换算成推送时段，关闭免打扰即全天。
function normalizeWindow(source) {
  let start = minutesOf(source.windowStart);
  let end = endMinutesOf(source.windowEnd);
  if (start === null && end === null && (source.quietStart !== undefined || source.quietEnabled !== undefined)) {
    const quietStart = minutesOf(source.quietStart);
    const quietEnd = minutesOf(source.quietEnd);
    const quietOn = source.quietEnabled !== false && quietStart !== null && quietEnd !== null;
    [start, end] = quietOn && quietEnd < quietStart ? [quietEnd, quietStart] : [0, DAY_MINUTES];
  }
  if (start === null) start = minutesOf(DEFAULT_PUSH.windowStart);
  if (end === null) end = endMinutesOf(DEFAULT_PUSH.windowEnd);
  if (end <= start) [start, end] = [0, DAY_MINUTES];
  return { windowStart: timeText(start), windowEnd: end === DAY_MINUTES ? '24:00' : timeText(end) };
}

// settings.json 里的 push 段：只存时间规则、内容口径与每个渠道的启用 / 绑定时间，连接信息另存加密凭据。
function normalizePushSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const channels = {};
  for (const id of CHANNEL_IDS) {
    const entry = source.channels?.[id];
    const boundAt = normalizeBoundAt(entry?.boundAt);
    channels[id] = { enabled: Boolean(boundAt) && entry?.enabled !== false, boundAt };
  }
  let mode = source.mode === 'interval' ? 'interval' : source.mode === 'times' ? 'times' : DEFAULT_PUSH.mode;
  let times = normalizeTimes(source.times);
  // v0.2.35 的「每天一次」间隔等同于一个固定时刻
  if (mode === 'interval' && Number(source.intervalMinutes) === DAY_MINUTES) {
    mode = 'times';
    times = normalizeTimes([source.anchor || DEFAULT_PUSH.windowStart]);
  }
  return {
    enabled: source.enabled === true,
    mode,
    times: times.length ? times : [...DEFAULT_PUSH.times],
    intervalMinutes: INTERVAL_CHOICES.includes(Number(source.intervalMinutes)) ? Number(source.intervalMinutes) : DEFAULT_PUSH.intervalMinutes,
    ...normalizeWindow(source),
    weekdays: normalizeWeekdays(source.weekdays),
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

// 设置页提交的时间 / 内容补丁：逐字段严格校验，错误点名字段，不静默改写用户的输入。
function applyPushPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('推送设置必须是对象');
  const allowed = ['enabled', 'mode', 'times', 'intervalMinutes', 'windowStart', 'windowEnd', 'weekdays',
    'scope', 'domain', 'maxItems', 'minHeat', 'skipEmpty'];
  const unknown = Object.keys(patch).filter(key => !allowed.includes(key));
  if (unknown.length) throw invalid(`包含不支持的推送设置字段：${unknown.join('、')}`);
  const next = { ...normalizePushSettings(current) };
  for (const key of ['enabled', 'skipEmpty']) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'boolean') throw invalid('开关字段必须是布尔值');
    next[key] = patch[key];
  }
  if (patch.mode !== undefined) {
    if (!['interval', 'times'].includes(patch.mode)) throw invalid('推送方式只能是“每天固定时刻”或“按间隔推送”');
    next.mode = patch.mode;
  }
  if (patch.intervalMinutes !== undefined) {
    if (!INTERVAL_CHOICES.includes(Number(patch.intervalMinutes))) throw invalid('推送间隔只能从列表中选择');
    next.intervalMinutes = Number(patch.intervalMinutes);
  }
  if (patch.windowStart !== undefined || patch.windowEnd !== undefined) {
    const start = minutesOf(patch.windowStart ?? next.windowStart);
    const end = endMinutesOf(patch.windowEnd ?? next.windowEnd);
    if (start === null || end === null) throw invalid('推送时段请使用 24 小时制 HH:MM，例如 08:00');
    if (end <= start) throw invalid('推送时段的结束时间必须晚于开始时间');
    next.windowStart = timeText(start);
    next.windowEnd = end === DAY_MINUTES ? '24:00' : timeText(end);
  }
  if (patch.times !== undefined) {
    const raw = (Array.isArray(patch.times) ? patch.times : String(patch.times).split(/[\s,，、;；]+/))
      .map(entry => String(entry).trim()).filter(Boolean);
    if (!raw.length) throw invalid('请至少保留一个推送时刻');
    const wrong = raw.find(entry => minutesOf(entry.replace(/^(\d):/, '0$1:')) === null);
    if (wrong) throw invalid(`推送时刻“${wrong.slice(0, 12)}”格式错误：请使用 24 小时制 HH:MM`);
    if (new Set(normalizeTimesUnbounded(raw)).size > MAX_TIMES) throw invalid(`每天最多 ${MAX_TIMES} 个推送时刻`);
    next.times = normalizeTimes(raw);
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

function normalizeTimesUnbounded(list) {
  return list.map(entry => minutesOf(entry.replace(/^(\d):/, '0$1:'))).filter(entry => entry !== null);
}

// 一天之内的全部推送时刻（分钟数，升序）
function slotMinutes(pushSettings) {
  const push = normalizePushSettings(pushSettings);
  if (push.mode === 'times') return push.times.map(minutesOf);
  const start = minutesOf(push.windowStart);
  const end = endMinutesOf(push.windowEnd);
  const list = [];
  for (let minute = start; minute <= end && minute < DAY_MINUTES; minute += push.intervalMinutes) list.push(minute);
  return list;
}

function isoWeekday(date) {
  return date.getDay() === 0 ? 7 : date.getDay();
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

// 当天的推送时刻表：不是推送日时为空
function todaySlots(pushSettings, now) {
  const push = normalizePushSettings(pushSettings);
  const date = new Date(now);
  if (!push.weekdays.includes(isoWeekday(date))) return [];
  return slotMinutes(push).map(timeText);
}

function describeDays(weekdays) {
  const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
  return weekdays.length === 7 ? '每天'
    : weekdays.join(',') === '1,2,3,4,5' ? '工作日'
      : weekdays.join(',') === '6,7' ? '周末'
        : `每周${weekdays.map(day => weekdayNames[day - 1]).join('、')}`;
}

function describeInterval(minutes) {
  return minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`;
}

function describeSchedule(pushSettings) {
  const push = normalizePushSettings(pushSettings);
  const days = describeDays(push.weekdays);
  if (push.mode === 'times') return `${days} ${push.times.join('、')}`;
  const window = push.windowStart === '00:00' && push.windowEnd === '24:00' ? '全天' : `${push.windowStart}—${push.windowEnd}`;
  return `${days} ${window} 每 ${describeInterval(push.intervalMinutes)}`;
}

module.exports = {
  DEFAULT_PUSH, INTERVAL_CHOICES, MAX_TIMES,
  normalizePushSettings, applyPushPatch, nextSlot, latestDueSlot, todaySlots, describeSchedule,
  slotMinutes, minutesOf
};
