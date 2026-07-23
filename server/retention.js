'use strict';
// 数据保留 —— 桌面端长期驻留运行，若只进不出，articles 与 trigram FTS 索引会无限膨胀。
// 分两档保留：判为无关的噪声很快清掉，相关情报按用户设置的天数保留；
// 事件簇随之收敛，日报是自包含快照因此单独按更长周期保留。
const { db, now, deleteArticles, checkpointWal } = require('./db');

const DAILY_REPORT_RETENTION_DAYS = 730;
// 单轮上限：首次在大库上清理时避免一次性锁库过久，剩余部分下一轮继续
const MAX_DELETIONS_PER_RUN = 20_000;

function isoDaysAgo(days, nowMs) {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

// 无关噪声的保留天数不允许超过整体保留天数，否则短档形同虚设
function resolveRetentionPlan({ retentionDays, irrelevantRetentionDays, nowMs = Date.now() } = {}) {
  const keep = Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 180;
  const rawNoise = Number.isInteger(irrelevantRetentionDays) && irrelevantRetentionDays > 0
    ? irrelevantRetentionDays
    : 21;
  const noise = Math.min(rawNoise, keep);
  return {
    retentionDays: keep,
    irrelevantRetentionDays: noise,
    articleCutoff: isoDaysAgo(keep, nowMs),
    irrelevantCutoff: isoDaysAgo(noise, nowMs),
    dailyReportCutoff: isoDaysAgo(Math.max(keep, DAILY_REPORT_RETENTION_DAYS), nowMs).slice(0, 10)
  };
}

function selectExpiredIds(plan, limit) {
  return db.prepare(`
    SELECT id FROM articles
    WHERE fetched_at < ?
       OR (relevant = 0 AND fetched_at < ?)
    ORDER BY fetched_at
    LIMIT ?`).all(plan.articleCutoff, plan.irrelevantCutoff, limit).map(row => row.id);
}

// 删除文章后，成员不足 2 条的簇失去意义；主条被删的簇要改推剩余最优条目
function repairClusters() {
  const TIER_RANK = { 'T1': 3, 'T1.5': 2, 'T2': 1 };
  let removed = 0;
  const clusterIds = db.prepare('SELECT id FROM clusters').all().map(row => row.id);
  for (const clusterId of clusterIds) {
    const members = db.prepare(`SELECT a.id, a.quality_score, s.tier
      FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.cluster_id = ?`).all(clusterId);
    if (members.length < 2) {
      db.prepare('UPDATE articles SET cluster_id = NULL WHERE cluster_id = ?').run(clusterId);
      db.prepare('DELETE FROM clusters WHERE id = ?').run(clusterId);
      removed++;
      continue;
    }
    members.sort((a, b) =>
      ((TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0)) || ((b.quality_score || 0) - (a.quality_score || 0)));
    db.prepare('UPDATE clusters SET main_article_id = ?, size = ?, updated_at = ? WHERE id = ?')
      .run(members[0].id, members.length, now(), clusterId);
  }
  return removed;
}

function pruneDatabase({ settings, nowMs = Date.now(), maxDeletions = MAX_DELETIONS_PER_RUN } = {}) {
  const plan = resolveRetentionPlan({
    retentionDays: settings?.collect?.retentionDays,
    irrelevantRetentionDays: settings?.collect?.irrelevantRetentionDays,
    nowMs
  });
  const expiredIds = selectExpiredIds(plan, maxDeletions + 1);
  const hasMore = expiredIds.length > maxDeletions;
  const doomed = hasMore ? expiredIds.slice(0, maxDeletions) : expiredIds;

  let removedArticles = 0;
  let removedClusters = 0;
  let removedReports = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    removedArticles = deleteArticles(doomed);
    if (removedArticles > 0) removedClusters = repairClusters();
    removedReports = db.prepare('DELETE FROM daily_reports WHERE date < ?').run(plan.dailyReportCutoff).changes;
    db.prepare(`INSERT INTO meta (key, value) VALUES ('lastPruneAt', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(new Date(nowMs).toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (removedArticles > 0 || removedReports > 0) checkpointWal();
  return { ...plan, removedArticles, removedClusters, removedReports, hasMore };
}

function getMaintenanceSnapshot() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'lastPruneAt'").get();
  return { lastPruneAt: row?.value || null };
}

module.exports = {
  DAILY_REPORT_RETENTION_DAYS,
  MAX_DELETIONS_PER_RUN,
  resolveRetentionPlan,
  pruneDatabase,
  getMaintenanceSnapshot
};
