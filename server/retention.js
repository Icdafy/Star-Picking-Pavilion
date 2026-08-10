'use strict';
// 数据保留 —— 桌面端长期驻留运行，若只进不出，articles 与 trigram FTS 索引会无限膨胀。
// 分两档保留：判为无关的噪声很快清掉，相关情报按用户设置的天数保留；
// 事件簇随之收敛，日报是自包含快照因此单独按更长周期保留。
const { db, now, deleteArticles, checkpointWal, withTransaction, DELETE_BATCH_SIZE } = require('./db');
const { optimizeDatabase, readMeta } = require('./database-maintenance');

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

// 星标是用户「我要留着」的显式意思表示，保留期对它不适用。
// 少了这个条件，收藏的情报会在保留天数到期后被自动清理，星标就不可信了。
const EXPIRED_ARTICLES_WHERE = `starred = 0
  AND (fetched_at < ? OR (relevant = 0 AND fetched_at < ?))`;

function selectExpiredIds(plan, limit) {
  return db.prepare(`
    SELECT id FROM articles
    WHERE ${EXPIRED_ARTICLES_WHERE}
    ORDER BY fetched_at
    LIMIT ?`).all(plan.articleCutoff, plan.irrelevantCutoff, limit).map(row => row.id);
}

// 设置页「待清理」的口径必须与真正会被删除的集合完全一致，否则星标会被算进去
function countExpiring(plan) {
  return db.prepare(`SELECT COUNT(*) c FROM articles WHERE ${EXPIRED_ARTICLES_WHERE}`)
    .get(plan.articleCutoff, plan.irrelevantCutoff).c;
}

// 删除文章后，成员不足 2 条的簇失去意义；主条被删的簇要改推剩余最优条目。
// 全部用集合式 SQL 完成：不再逐簇查成员（N+1），而是一条聚合重算、一条批量修正
const SURVIVING_CLUSTERS = `
  SELECT cluster_id FROM articles
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id HAVING COUNT(*) >= 2`;

function repairClusters() {
  // 小簇（含孤儿簇）：释放成员后删除簇行
  db.prepare(`UPDATE articles SET cluster_id = NULL
    WHERE cluster_id IN (SELECT id FROM clusters)
      AND cluster_id NOT IN (${SURVIVING_CLUSTERS})`).run();
  const removed = db.prepare(`DELETE FROM clusters WHERE id NOT IN (${SURVIVING_CLUSTERS})`).run().changes;
  // 存活簇：一条 UPDATE 重算计数与主条（源等级降序 → 质量分降序 → id 升序，与原逐簇排序一致）
  // 注：size 统计不带 sources JOIN，依赖 foreign_keys=ON 保证 articles.source_id 无悬空行，
  // 否则重算出的 size/main_article_id 会与带 JOIN 的查询口径不一致
  db.prepare(`UPDATE clusters SET
      size = (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = clusters.id),
      main_article_id = (
        SELECT a2.id FROM articles a2 JOIN sources s2 ON s2.id = a2.source_id
        WHERE a2.cluster_id = clusters.id
        ORDER BY CASE s2.tier WHEN 'T1' THEN 3 WHEN 'T1.5' THEN 2 WHEN 'T2' THEN 1 ELSE 0 END DESC,
                 COALESCE(a2.quality_score, 0) DESC, a2.id ASC
        LIMIT 1),
      updated_at = ?
    WHERE id IN (${SURVIVING_CLUSTERS})`).run(now());
  return removed;
}

function pruneDatabase({ settings, nowMs = Date.now(), maxDeletions = MAX_DELETIONS_PER_RUN } = {}) {
  const plan = resolveRetentionPlan({
    retentionDays: settings?.collect?.retentionDays,
    irrelevantRetentionDays: settings?.collect?.irrelevantRetentionDays,
    nowMs
  });

  // 分批删除，每批一个独立事务（deleteArticles 内部管理）：
  // 大清理不再一次性长锁整个库，单轮总量仍由 maxDeletions 封顶
  let removedArticles = 0;
  let remaining = maxDeletions;
  while (remaining > 0) {
    const batch = selectExpiredIds(plan, Math.min(DELETE_BATCH_SIZE, remaining));
    if (!batch.length) break;
    removedArticles += deleteArticles(batch);
    remaining -= batch.length;
  }
  const hasMore = remaining === 0 && countExpiring(plan) > 0;

  let removedClusters = 0;
  let removedReports = 0;
  withTransaction(() => {
    if (removedArticles > 0) removedClusters = repairClusters();
    removedReports = db.prepare('DELETE FROM daily_reports WHERE date < ?').run(plan.dailyReportCutoff).changes;
    db.prepare(`INSERT INTO meta (key, value) VALUES ('lastPruneAt', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(new Date(nowMs).toISOString());
  });

  if (removedArticles > 0 || removedReports > 0) checkpointWal();
  let optimized = false;
  try {
    optimized = optimizeDatabase({ database: db, nowMs }).optimized;
  } catch {}
  return { ...plan, removedArticles, removedClusters, removedReports, hasMore, optimized };
}

function getMaintenanceSnapshot() {
  return {
    lastPruneAt: readMeta(db, 'lastPruneAt'),
    lastOptimizeAt: readMeta(db, 'lastOptimizeAt'),
    lastCompactionAt: readMeta(db, 'lastCompactionAt')
  };
}

module.exports = {
  DAILY_REPORT_RETENTION_DAYS,
  MAX_DELETIONS_PER_RUN,
  resolveRetentionPlan,
  countExpiring,
  pruneDatabase,
  getMaintenanceSnapshot
};
