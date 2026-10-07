'use strict';
const { looseDateIso } = require('./loose-date');

// 只用于发布元数据 / 专门日期元素；月初是排序锚点，显示必须保留“仅确认月份”。
function parsePublicationDate(value, { nowMs = Date.now(), utcOffset = '+08:00', url = '' } = {}) {
  const text = String(value || '').trim();
  if (!text) return null;
  const month = /^(20\d{2})[-/.年](\d{1,2})月?$/.exec(text);
  if (month) {
    const publishedAt = looseDateIso(`${month[1]}-${month[2].padStart(2, '0')}-01T00:00:00${utcOffset}`);
    return publishedAt ? { publishedAt, publicationPrecision: 'month', publicationDateText: `${month[1]}年${Number(month[2])}月` } : null;
  }
  const monthDay = /^(\d{1,2})[-/.月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (monthDay) {
    let explicitYear;
    try { explicitYear = new URL(url).pathname.match(/(?:^|[/_-])(20\d{2})(?=[/_.-]|$)/)?.[1]; } catch {}
    const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(utcOffset);
    const offsetMs = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000 : 0;
    let year = explicitYear ? Number(explicitYear) : new Date(nowMs + offsetMs).getUTCFullYear();
    const clock = monthDay[3] ? `${monthDay[3].padStart(2, '0')}:${monthDay[4]}:${monthDay[5] || '00'}` : '00:00:00';
    const valueAt = y => looseDateIso(`${y}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}T${clock}${utcOffset}`);
    let publishedAt = valueAt(year);
    if (!explicitYear && publishedAt && Date.parse(publishedAt) > nowMs) publishedAt = valueAt(--year);
    const visibleClock = monthDay[3] ? `${monthDay[3].padStart(2, '0')}:${monthDay[4]}${monthDay[5] ? ':' + monthDay[5] : ''}` : '';
    const label = `${Number(monthDay[1])}月${Number(monthDay[2])}日${visibleClock ? ' ' + visibleClock : ''}`;
    return publishedAt ? { publishedAt, publicationPrecision: explicitYear ? monthDay[3] ? 'time' : 'day' : 'month-day',
      publicationDateText: explicitYear ? `${year}年${label}` : `${label}（${year}年推定）` } : null;
  }
  const publishedAt = looseDateIso(text, utcOffset);
  if (!publishedAt) return null;
  const full = /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(text);
  const hasTime = /\d{1,2}:\d{2}/.test(text);
  return { publishedAt, publicationPrecision: hasTime ? 'time' : 'day',
    publicationDateText: !hasTime && full ? `${full[1]}年${Number(full[2])}月${Number(full[3])}日` : text };
}

function publicationUpperBound(value, precision) {
  const stamp = Date.parse(value);
  if (precision !== 'month' || !Number.isFinite(stamp)) return stamp;
  const date = new Date(stamp + 8 * 3600e3);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 8 * 3600e3 - 1;
}

module.exports = { parsePublicationDate, publicationUpperBound };
