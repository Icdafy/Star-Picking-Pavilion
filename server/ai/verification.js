'use strict';
const { db } = require('../db');
const { verifyEvent } = require('./event-time');

function parse(value) { try { const x = JSON.parse(value || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } }

// Atomic evidence is reconciled across retained history, independent of the 72h display clusters.
function reconcileEvents() {
  const rows = db.prepare(`SELECT a.id, a.url, a.title, a.published_at, a.events_json, a.verification_json,
      a.event_date, a.publisher_id, a.summary_raw,
      substr(a.content_text,1,1500) || substr(a.content_text,-1000) AS content_text,
      s.name source_name, s.url source_url, s.tier
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.relevant=1 AND a.events_json IS NOT NULL ORDER BY a.id DESC LIMIT 20000`).all();
  const groups = new Map();
  const occurrences = new Map();
  for (const row of rows) {
    row.atomic = parse(row.events_json);
    for (const event of row.atomic) {
      // Date in the key prevents unrelated repeated missions from confirming one another.
      if (!event.key || !event.date || !event.evidence || !['completed', 'failed'].includes(event.status)) continue;
      if (!groups.has(event.key)) groups.set(event.key, []);
      const report = { ...row, date: event.date, evidence: event.evidence };
      groups.get(event.key).push(report);
      // An identical headline and publication day claiming a different occurrence date
      // is ambiguous, not a license to select the majority date. Keep it for review.
      const occurrence = `${event.key.replace(/\|\d{4}-\d{2}-\d{2}\|[^|]+$/, '')}|${event.status}|${row.title}|${String(row.published_at || '').slice(0,10)}`;
      if (!occurrences.has(occurrence)) occurrences.set(occurrence, []);
      occurrences.get(occurrence).push(report);
      event.occurrence = occurrence;
    }
  }
  const update = db.prepare('UPDATE articles SET events_json=?, event_date=?, verification_json=? WHERE id=?');
  let changed = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const atomic = row.atomic.map(e => {
        const reports = groups.get(e.key) || [];
        const related = occurrences.get(e.occurrence) || [];
        const conflicted = new Set(related.map(r => r.date)).size > 1;
        const { occurrence, ...event } = e;
        return { ...event, verification: verifyEvent(conflicted ? related : reports) };
      });
      const verification = atomic[0]?.verification || { status: 'pending', date: null, sources: [] };
      const json = JSON.stringify(atomic), v = JSON.stringify(verification);
      if (json === row.events_json && v === row.verification_json && verification.date === row.event_date) continue;
      update.run(json, verification.date, v, row.id);
      changed++;
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return changed;
}
module.exports = { reconcileEvents };
