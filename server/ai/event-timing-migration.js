'use strict';
const { normalizeEvents, primaryEventKey } = require('./events');

// Upgrade stored atomic events without another model call or any publisher voting.
function refreshEventTiming(database = require('../db').db) {
  const select = database.prepare(`SELECT id,title,summary_raw,content_text,published_at,events_json
    FROM articles WHERE event_schema_version<2
      AND (events_json IS NOT NULL OR event_date IS NOT NULL OR event_key IS NOT NULL)
    ORDER BY id LIMIT 250`);
  const update = database.prepare(`UPDATE articles SET events_json=?,event_key=?,event_date=?,event_schema_version=2 WHERE id=?`);
  let changed = 0;
  for (;;) {
    const rows = select.all();
    if (!rows.length) break;
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        let raw = [];
        try { raw = JSON.parse(row.events_json || '[]'); } catch {}
        const events = normalizeEvents(raw, { article: row });
        update.run(JSON.stringify(events), primaryEventKey(events), events[0]?.date || null, row.id);
        changed++;
      }
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  return changed;
}
module.exports = { refreshEventTiming };
