'use strict';

const DAY = 86400000;
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value ? value : null;
}

// Resolve relative dates against publication, never collection. Missing year stays unknown.
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
  const resolved = resolveEventDate(raw?.w ?? raw?.time, article.published_at);
  const evidenceDates = (evidence.match(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,2}月\d{1,2}日?|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2}|今天|当日|昨日|昨天|前天/g) || [])
    .map(date => resolveEventDate(date, article.published_at));
  const past = resolved && Date.parse(resolved) <= Date.now() + DAY
    && (!article.published_at || Date.parse(resolved) <= Date.parse(article.published_at) + DAY);
  return { date: quotePresent && past && evidenceDates.includes(resolved) ? resolved : null,
    evidence: quotePresent ? evidence : '' };
}

function host(value) { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function publisher(row) {
  const h = host(row.url);
  const text = `${row.content_text || ''} ${row.summary_raw || ''}`;
  const origin = text.match(/(?:来源|转载自|转自|据)\s*[：:]?\s*(新华社|新华网|路透社|Reuters|中国新闻网|中新网|央视新闻|人民日报|财联社)/i);
  if (origin) return origin[1].replace('新华网', '新华社').replace('中国新闻网', '中新网').toLowerCase();
  if (/xinhuanet\.com$|news\.cn$/.test(h)) return '新华社';
  if (/reuters\.com$/.test(h)) return 'reuters';
  if (/chinanews\.com(?:\.cn)?$/.test(h)) return '中新网';
  if (/mp\.weixin\.qq\.com$/.test(h)) return row.publisher_id ? `wechat:${row.publisher_id}` : null;
  // Search/aggregation entry IDs and repeated syndicated copies are not independent publishers.
  if (/eastmoney\.com$|bing\.com$|sogou\.com$/.test(h)) return null;
  const parts = h.split('.');
  return h ? parts.slice(/\.(com|org|gov|net)\.cn$/.test(h) ? -3 : -2).join('.') : null;
}

function official(row) {
  return row.tier === 'T1' && host(row.url) && host(row.url) === host(row.source_url)
    && !/(?:来源|转载自|转自)\s*[：:]?/.test(row.summary_raw || '');
}

function verifyEvent(reports) {
  const dated = reports.filter(r => dateOnly(r.date) && r.evidence);
  const dates = [...new Set(dated.map(r => r.date))];
  if (dates.length > 1) return { status: 'conflict', date: null,
    sources: dated.slice(0,8).map(r => ({name:r.source_name,url:r.url,date:r.date,evidence:r.evidence})) };
  const firstParty = dated.find(official);
  const unique = new Map();
  for (const row of dated) { const p = publisher(row); if (p && !unique.has(p)) unique.set(p, row); }
  const sources = [...unique.values()].slice(0, 8).map(r => ({ name: r.source_name, url: r.url, date: r.date, evidence: r.evidence }));
  if (firstParty) return { status: 'official', date: firstParty.date, sources: [{ name: firstParty.source_name, url: firstParty.url, date: firstParty.date, evidence: firstParty.evidence }, ...sources.filter(s => s.url !== firstParty.url)].slice(0, 8) };
  return { status: unique.size >= 2 ? 'corroborated' : 'pending', date: unique.size >= 2 ? dates[0] : null, sources };
}

function timingFields(row) {
  let verification = {};
  try { verification = JSON.parse(row.verification_json || '{}'); } catch {}
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) verification = {};
  const confirmed = ['official', 'corroborated'].includes(verification.status);
  const eventDate = confirmed ? dateOnly(row.event_date) : null;
  const reportDate = row.published_at && Number.isFinite(Date.parse(row.published_at))
    ? new Date(Date.parse(row.published_at) + 8 * 3600000).toISOString().slice(0, 10) : null;
  return { eventDate, reportedAt: row.published_at || null, verification,
    reportDelayDays: eventDate && reportDate && eventDate <= reportDate
      ? Math.round((Date.parse(reportDate) - Date.parse(eventDate)) / DAY) : null };
}

module.exports = { dateOnly, resolveEventDate, eventTiming, publisher, official, verifyEvent, timingFields };
