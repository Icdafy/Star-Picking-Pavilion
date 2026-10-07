'use strict';

// v0.2.25：复核旧库里的明确通用合集、词边界误判及未完成的旧版预标记。
// 不重跑有效模型结论，不删除文章、星标、原分析或用户配置。
const { db, now, withTransaction } = require('../db');
const { DOMAINS, articleProfile } = require('./relevance');

const MIGRATION_KEY = 'industryScopeV0225';

function repairIndustryScope({ force = false } = {}) {
  if (!force && db.prepare('SELECT value FROM meta WHERE key=?').get(MIGRATION_KEY)) return { skipped: true };
  const changes = [];
  for (const row of db.prepare(`SELECT a.id,a.title,a.title_zh,a.summary_raw,a.translation_json,a.analyzed,a.domain,a.cluster_id,s.tier
    FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.relevant=1`).all()) {
    const profile = articleProfile(row, { heuristic: Number(row.analyzed) === 3 });
    if (profile.blocked) changes.push({ row, blocked: true });
    else if (!DOMAINS.has(row.domain) || ![1, 3].includes(Number(row.analyzed))
      || (Number(row.analyzed) === 3 && !profile.relevant)) changes.push({ row, blocked: false });
  }
  const result = { blocked: changes.filter(change => change.blocked).length, requeued: changes.filter(change => !change.blocked).length };
  withTransaction(() => {
    const update = db.prepare(`UPDATE articles SET relevant=?,analyzed=?,featured=0,prefilter_label=?,
      cluster_id=NULL,story_relation=NULL,grouped_at=NULL WHERE id=?`);
    const removeSignal = db.prepare('DELETE FROM story_signals WHERE article_id=?');
    const clusters = new Set();
    for (const { row, blocked } of changes) {
      update.run(blocked ? 0 : null, blocked ? 1 : 0, blocked ? 'BLOCK' : null, row.id);
      removeSignal.run(row.id);
      if (row.cluster_id != null) clusters.add(row.cluster_id);
    }
    if (clusters.size) {
      const { refreshStory } = require('./stories');
      const invalidateDigest = db.prepare('UPDATE clusters SET digest=NULL,digest_hash=NULL,digest_size=0,digest_at=NULL WHERE id=?');
      for (const id of clusters) { invalidateDigest.run(id); refreshStory(id); }
    }
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(MIGRATION_KEY, JSON.stringify({ ...result, at: now() }));
  });
  if (changes.length) require('./hot').computeHotRanking();
  return result;
}

module.exports = { repairIndustryScope };
