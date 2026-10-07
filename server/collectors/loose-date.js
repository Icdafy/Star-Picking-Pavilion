'use strict';
// 列表页 / 正文里印出来的发布日期。对应 AIHOT de4be99：Date.parse 读不带时区的
// “2026-09-26 10:00”“2026/9/6”时用的是本机时区，换一台 UTC 机器就差 8 小时；信源自己的
// 时区（国内站默认 +08:00）才是正确读法。Date.parse 只留给在任何机器上读法一致的两种写法：
// 带时区的时间，以及单独的 ISO 日期（UTC 零点，与旧版行为一致）。

// 时间后面跟着时区：“10:00Z”“10:00:00+08:00”“10:00:00 +0000”“10:00:00 GMT”
const EXPLICIT_ZONE = /\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AP]M\s*)?(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC?|[EMP][SD]T|CDT)\b/i;

function atOffset(y, mo, d, h, mi, s, utcOffset) {
  const p = n => String(n).padStart(2, '0');
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const t = Date.parse(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}${utcOffset}`);
  if (!Number.isFinite(t)) return null;
  // 拒绝 2 月 30 日这类被 Date 自动顺延的日期
  const check = new Date(t + offsetMs(utcOffset));
  if (check.getUTCDate() !== Number(d)) return null;
  return new Date(t);
}

function offsetMs(utcOffset) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(utcOffset);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60e3 : 0;
}

function parseLooseDate(value, utcOffset = '+08:00') {
  if (value == null) return null;
  let v;
  try { v = String(value).trim(); } catch { return null; }
  if (!v) return null;
  // 带时区的 ISO 同样先校验日历；Date.parse 会把 2 月 30 日静默顺延。
  const calendar = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(v);
  if (calendar) {
    const check = new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3])));
    if (check.getUTCFullYear() !== Number(calendar[1]) || check.getUTCMonth() + 1 !== Number(calendar[2]) || check.getUTCDate() !== Number(calendar[3])) return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, mo, d] = v.split('-');
    return atOffset(y, mo, d, '00', '00', '00', '+00:00');
  }
  const english = /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i.exec(v)
    || /\b(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})\b/i.exec(v)?.map((part, i, match) => i === 1 ? match[2] : i === 2 ? match[1] : part);
  if (english) {
    const month = Date.parse(`${english[1]} 1, ${english[3]} 00:00:00 GMT`);
    if (!Number.isFinite(month) || !atOffset(english[3], new Date(month).getUTCMonth() + 1, english[2], 0, 0, 0, '+00:00')) return null;
  }
  const text = v.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  if (EXPLICIT_ZONE.test(v)) {
    const direct = Date.parse(text);
    if (Number.isFinite(direct) && /\d{4}/.test(v)) return new Date(direct);
  }
  // 2026-09-26 / 2026/09/26 / 2026.9.26 / 2026-09-26T10:00 / 2026年9月26日 10:00，按信源时区读
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:(?:T|\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
    return atOffset(y, mo, d, h, mi, s, utcOffset);
  }
  // 用 UTC 读取英文墙钟，避免夏令时缺口把 02:30 自动推进到 03:30。
  // CST 在中文新闻中通常指北京时间，按信源偏移读取，不能采用 Date.parse 的美国中部时区。
  if (!english) return null;
  const en = Date.parse(`${text.replace(/\bCST\b/gi, '').trim()} GMT`);
  if (!Number.isFinite(en)) return null;
  const utc = new Date(en);
  return atOffset(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(), utcOffset);
}

function looseDateIso(value, utcOffset = '+08:00') {
  const date = parseLooseDate(value, utcOffset);
  return date ? date.toISOString() : null;
}

// 仅使用 URL 路径中明确的完整年月日，不从查询参数或只有年月的目录猜日期。
function dateFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/(?:^|[/_t-])(20\d{2})[-/]?(\d{2})[-/]?(\d{2})(?=[/_.-]|$)/);
    return match ? looseDateIso(`${match[1]}-${match[2]}-${match[3]}`) : null;
  } catch { return null; }
}

// 专门的日期元素可以省略年份，或写“昨天16:33”；正文中的日期不会走这条路径。
function listDateIso(value, utcOffset = '+08:00', nowMs = Date.now()) {
  const text = String(value || '').trim().replace(/^[·•]\s*/, '');
  const direct = looseDateIso(text, utcOffset);
  if (direct) return direct;
  const today = new Date(nowMs + offsetMs(utcOffset));
  const relative = /^(今天|昨天|前天)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (relative) {
    today.setUTCDate(today.getUTCDate() - { 今天: 0, 昨天: 1, 前天: 2 }[relative[1]]);
    const date = atOffset(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate(), relative[2], relative[3], relative[4] || '00', utcOffset);
    return date?.toISOString() || null;
  }
  const partial = /^(\d{1,2})[-/月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!partial) return null;
  let year = today.getUTCFullYear();
  const date = atOffset(year, partial[1], partial[2], partial[3] || '00', partial[4] || '00', partial[5] || '00', utcOffset);
  if (date && date.getTime() > nowMs + 86400000) year--;
  // 无时间的 ISO 日期保持既有 UTC 零点口径。
  return looseDateIso(`${year}-${String(partial[1]).padStart(2, '0')}-${String(partial[2]).padStart(2, '0')}`
    + (partial[3] ? ` ${partial[3]}:${partial[4]}:${partial[5] || '00'}` : ''), utcOffset);
}

module.exports = { parseLooseDate, looseDateIso, dateFromUrl, listDateIso, EXPLICIT_ZONE };
