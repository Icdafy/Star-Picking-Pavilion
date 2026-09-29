'use strict';
// v0.2.2：热度的“独立信源”按真实出版方计。东方财富检索线里的文章大多是转载（界面新闻、财联社、证券时报……），
// 过去出版方缺失时退回“检索线”本身，同一站点的十几条检索线被当成十几个独立信源，热度被放大。
// 这里一次性从已采正文的“文章来源：XXX”补出版方，并按统一写法重算参与者键与热度信号；只改归属，不改文章内容。
// 先只读算出变更，确有变更才开写事务——启动时没有可补的资料就不碰写锁。
const { db } = require('../db');
const { participantKeyOf } = require('./pipeline');
const { reprintSource } = require('../collectors/article-content');

function backfillPublishers({ force = false } = {}) {
  if (!force && db.prepare("SELECT value FROM meta WHERE key='publisherBackfillV022'").get()) return { skipped: true };
  const publishers = [];
  for (const row of db.prepare("SELECT id, content_text FROM articles WHERE publisher_id IS NULL AND content_text LIKE '%文章来源%'").all()) {
    const name = reprintSource(row.content_text);
    if (name) publishers.push([name.slice(0, 120), row.id]);
  }
  const found = new Map(publishers.map(([name, id]) => [id, name]));
  const participants = [];
  for (const row of db.prepare('SELECT id, source_id, publisher_id, participant_key FROM articles WHERE publisher_id IS NOT NULL OR id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify([...found.keys()]))) {
    const publisher = row.publisher_id || found.get(row.id);
    const key = participantKeyOf({ ...row, publisher_id: publisher });
    if (key !== row.participant_key) participants.push([key, String(publisher).slice(0, 60), row.id]);
  }
  const stats = { publishers: publishers.length, participants: participants.length, signals: 0 };
  if (!publishers.length && !participants.length) return { ...stats, unchanged: true };
  db.exec('BEGIN IMMEDIATE');
  try {
    const setPublisher = db.prepare('UPDATE articles SET publisher_id = ? WHERE id = ? AND publisher_id IS NULL');
    for (const [name, id] of publishers) setPublisher.run(name, id);
    const setKey = db.prepare('UPDATE articles SET participant_key = ? WHERE id = ?');
    const setSignal = db.prepare('UPDATE story_signals SET participant_key = ?, participant_name = ? WHERE article_id = ?');
    for (const [key, name, id] of participants) {
      setKey.run(key, id);
      stats.signals += setSignal.run(key, name, id).changes;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('publisherBackfillV022', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(stats));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return stats;
}

module.exports = { backfillPublishers };
