'use strict';

const DAY = 86400000;
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value ? value : null;
}

// Resolve relative dates against publication, never collection.
function resolveEventDate(value, publishedAt) {
  const text = String(value || '').trim();
  const full = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (full) return dateOnly(`${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`);
  const english = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/)
    || (() => { const m = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/); return m && [m[0],m[2],m[1],m[3]]; })();
  if (english) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(english[1].slice(0,3).toLowerCase())+1;
    if (month) return dateOnly(`${english[3]}-${String(month).padStart(2,'0')}-${english[2].padStart(2,'0')}`);
  }
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;
  const anchor = new Date(Date.parse(publishedAt) + 8 * 3600000);
  const relative = { '今天': 0, '当日': 0, '昨日': 1, '昨天': 1, '前天': 2 }[text];
  if (relative !== undefined) return new Date(+anchor - relative * DAY).toISOString().slice(0, 10);
  const daysAgo = text.match(/^(\d{1,3})天前$/);
  if (daysAgo) return new Date(+anchor - Number(daysAgo[1]) * DAY).toISOString().slice(0, 10);
  const enRelative = { today: 0, yesterday: 1 }[text.toLowerCase()];
  if (enRelative !== undefined) return new Date(+anchor - enRelative * DAY).toISOString().slice(0, 10);
  const md = text.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (!md) return null;
  let year = anchor.getUTCFullYear();
  let date = dateOnly(`${year}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`);
  if (date && Date.parse(date) > +anchor + DAY) date = dateOnly(`${year - 1}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`);
  return date;
}

function eventTiming(raw, article) {
  const evidence = typeof raw?.evidence === 'string' ? raw.evidence.trim().slice(0, 300) : '';
  const text = `${article.title || ''} ${article.summary_raw || ''} ${article.content_text || ''}`;
  const quotePresent = evidence.length >= 6 && text.includes(evidence);
  const resolved = resolveEventDate(raw?.w || raw?.time || raw?.date, article.published_at);
  const evidenceDates = (evidence.match(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,2}月\d{1,2}日?|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2}|\d{1,3}天前|today|yesterday|今天|当日|昨日|昨天|前天/gi) || [])
    .map(date => resolveEventDate(date, article.published_at));
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const reportDay = article.published_at && Number.isFinite(Date.parse(article.published_at))
    ? new Date(Date.parse(article.published_at) + 8 * 3600000).toISOString().slice(0, 10) : null;
  const past = resolved && resolved <= today && (!reportDay || resolved <= reportDay);
  // A quote spanning multiple event dates cannot bind a date to one action safely.
  const uniqueDates = new Set(evidenceDates.filter(Boolean));
  return { date: quotePresent && past && uniqueDates.size === 1 && uniqueDates.has(resolved) ? resolved : null,
    evidence: quotePresent ? evidence : '' };
}

function timingFields(row) {
  let events = [];
  try { events = JSON.parse(row.events_json || '[]'); } catch {}
  const primary = Array.isArray(events) ? events[0] : null;
  const dated = primary && ['completed', 'failed'].includes(primary.status) && primary.evidence;
  const eventDate = dated ? dateOnly(primary.date) : null;
  const reportDate = row.published_at && Number.isFinite(Date.parse(row.published_at))
    ? new Date(Date.parse(row.published_at) + 8 * 3600000).toISOString().slice(0, 10) : null;
  const validDate = eventDate && (!reportDate || eventDate <= reportDate) ? eventDate : null;
  return { eventDate: validDate, reportedAt: row.published_at || null,
    timingStatus: primary?.status === 'planned' ? 'planned' : validDate ? 'dated' : 'unknown',
    reportDelayDays: validDate && reportDate
      ? Math.round((Date.parse(reportDate) - Date.parse(validDate)) / DAY) : null };
}
module.exports = { dateOnly, resolveEventDate, eventTiming, timingFields };
