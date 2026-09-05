'use strict';
const { normalizeEvents, primaryEventKey } = require('./events');
const { timingFields } = require('./event-time');

const REPAIR_VERSION = 3;
// A separate events-only repair never resets relevance, scores, stars or summaries.
async function repairTiming(database, { hasKey, enrich, extract, limit = 5 } = {}) {
  if (!hasKey) return { attempted: 0, repaired: 0 };
  const rows = database.prepare(`SELECT * FROM articles
    WHERE analyzed > 0 AND (relevant=1 OR starred=1)
      AND timing_repair_version < 3 AND timing_repair_attempts < 2
      AND (starred=1 OR featured=1 OR julianday(fetched_at)>julianday('now','-30 days'))
      AND (timing_repair_at IS NULL OR julianday(timing_repair_at)<julianday('now','-1 hour'))
    ORDER BY starred DESC, featured DESC, id DESC LIMIT 200`).all();
  let attempted = 0, repaired = 0;
  for (const row of rows) {
    if (attempted >= limit) break;
    const timing = timingFields(row);
    if (timing.reportDelayDays != null || ['planned','postponed'].includes(timing.timingStatus)) {
      database.prepare('UPDATE articles SET timing_repair_version=? WHERE id=?').run(REPAIR_VERSION,row.id);
      continue;
    }
    const claim = database.prepare(`UPDATE articles SET timing_repair_attempts=timing_repair_attempts+1,
      timing_repair_at=?,timing_repair_error=NULL WHERE id=? AND timing_repair_version<3
      AND timing_repair_attempts<2 AND (timing_repair_at IS NULL OR julianday(timing_repair_at)<julianday('now','-1 hour'))`)
      .run(new Date().toISOString(),row.id);
    if (!claim.changes) continue;
    attempted++;
    try {
      if (!row.content_text || !row.published_at) {
        const content = await enrich(row);
        row.content_text = content.text || row.content_text || '';
        row.content_status = content.status;
        row.published_at ||= content.publishedAt || null;
        database.prepare('UPDATE articles SET content_text=?,content_status=?,published_at=? WHERE id=?')
          .run(row.content_text,row.content_status,row.published_at,row.id);
      }
      const raw = await extract(row);
      if (!Array.isArray(raw)) throw new Error('事件补提取响应无效');
      const events = normalizeEvents(raw, { article: row });
      if (!events.length) throw new Error('未取得有效主事件');
      if (!events[0].evidence) throw new Error('补提取缺少原文证据');
      // Never replace an established date with weaker evidence when repairing publication.
      if (timing.eventDate && !events[0].date) throw new Error('补提取未保留已有日期证据');
      database.prepare(`UPDATE articles SET events_json=?,event_key=?,event_date=?,event_schema_version=3,
        timing_repair_version=?,timing_repair_error=NULL WHERE id=?`)
        .run(JSON.stringify(events),primaryEventKey(events),events[0].date,REPAIR_VERSION,row.id);
      repaired++;
    } catch {
      // Do not persist remote provider payloads (which can contain credentials).
      database.prepare('UPDATE articles SET timing_repair_error=? WHERE id=?')
        .run('补提取未完成；保留原分析，最多尝试两次',row.id);
    }
  }
  return { attempted, repaired };
}
module.exports = { repairTiming, REPAIR_VERSION };
