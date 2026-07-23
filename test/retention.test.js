'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-retention-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { db, closeDatabase, insertArticle, now } = require('../server/db');
const { resolveRetentionPlan, pruneDatabase, getMaintenanceSnapshot } = require('../server/retention');

const DAY_MS = 86_400_000;
const NOW_MS = Date.parse('2026-07-24T12:00:00.000Z');

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

function resetDatabase() {
  db.exec('DELETE FROM articles');
  db.exec('DELETE FROM articles_fts');
  db.exec('DELETE FROM clusters');
  db.exec('DELETE FROM daily_reports');
  db.exec('DELETE FROM sources');
  return db.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES ('保留测试', 'rss', ?, 'T2', 'aerospace')`).run(`https://example.com/${Math.random()}`).lastInsertRowid;
}

function addArticle(sourceId, { title, ageDays, relevant = 1 }) {
  const url = `https://example.com/${title}-${Math.random()}`;
  insertArticle({ sourceId, title, url, summaryRaw: title, domain: 'aerospace' });
  const id = db.prepare('SELECT id FROM articles WHERE url = ?').get(url).id;
  db.prepare('UPDATE articles SET fetched_at = ?, relevant = ?, analyzed = 1 WHERE id = ?')
    .run(new Date(NOW_MS - ageDays * DAY_MS).toISOString(), relevant, id);
  return id;
}

test('the noise window is clamped so it can never outlive the overall retention window', () => {
  const plan = resolveRetentionPlan({ retentionDays: 30, irrelevantRetentionDays: 90, nowMs: NOW_MS });
  assert.equal(plan.retentionDays, 30);
  assert.equal(plan.irrelevantRetentionDays, 30);
  assert.equal(plan.articleCutoff, plan.irrelevantCutoff);
});

test('missing or invalid settings fall back to the documented defaults', () => {
  const plan = resolveRetentionPlan({ retentionDays: 'forever', irrelevantRetentionDays: -1, nowMs: NOW_MS });
  assert.equal(plan.retentionDays, 180);
  assert.equal(plan.irrelevantRetentionDays, 21);
  assert.equal(plan.articleCutoff, new Date(NOW_MS - 180 * DAY_MS).toISOString());
});

test('expired articles and their full-text rows are removed together, fresh ones survive', () => {
  const sourceId = resetDatabase();
  const keptRelevant = addArticle(sourceId, { title: '近期相关情报', ageDays: 5 });
  const keptNoise = addArticle(sourceId, { title: '近期无关噪声', ageDays: 3, relevant: 0 });
  const expiredNoise = addArticle(sourceId, { title: '过期无关噪声', ageDays: 40, relevant: 0 });
  const expiredRelevant = addArticle(sourceId, { title: '过期相关情报', ageDays: 200 });

  const result = pruneDatabase({
    settings: { collect: { retentionDays: 180, irrelevantRetentionDays: 21 } },
    nowMs: NOW_MS
  });

  assert.equal(result.removedArticles, 2);
  const surviving = db.prepare('SELECT id FROM articles ORDER BY id').all().map(row => row.id);
  assert.deepEqual(surviving, [keptRelevant, keptNoise].sort((a, b) => a - b));
  for (const removed of [expiredNoise, expiredRelevant]) {
    assert.equal(db.prepare('SELECT COUNT(*) c FROM articles WHERE id = ?').get(removed).c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM articles_fts WHERE rowid = ?').get(removed).c, 0);
  }
  // FTS 影子表与主表必须严格同行，否则 trigram 索引会越积越大并检索到已删条目
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles_fts').get().c, 2);
});

test('clusters shrink, re-elect a main article, or disappear when members expire', () => {
  const sourceId = resetDatabase();
  const fresh = addArticle(sourceId, { title: '同一事件的近期报道', ageDays: 1 });
  const alsoFresh = addArticle(sourceId, { title: '同一事件的另一篇近期报道', ageDays: 1 });
  const stale = addArticle(sourceId, { title: '同一事件的过期报道', ageDays: 400 });
  const lonelyFresh = addArticle(sourceId, { title: '孤立的近期报道', ageDays: 1 });
  const lonelyStale = addArticle(sourceId, { title: '孤立的过期报道', ageDays: 400 });

  const shrinking = db.prepare('INSERT INTO clusters (main_article_id, size, updated_at) VALUES (?, 3, ?)')
    .run(stale, now()).lastInsertRowid;
  db.prepare('UPDATE articles SET cluster_id = ? WHERE id IN (?, ?, ?)').run(shrinking, fresh, alsoFresh, stale);
  db.prepare('UPDATE articles SET quality_score = 90 WHERE id = ?').run(alsoFresh);
  db.prepare('UPDATE articles SET quality_score = 50 WHERE id = ?').run(fresh);

  const dissolving = db.prepare('INSERT INTO clusters (main_article_id, size, updated_at) VALUES (?, 2, ?)')
    .run(lonelyStale, now()).lastInsertRowid;
  db.prepare('UPDATE articles SET cluster_id = ? WHERE id IN (?, ?)').run(dissolving, lonelyFresh, lonelyStale);

  const result = pruneDatabase({
    settings: { collect: { retentionDays: 180, irrelevantRetentionDays: 21 } },
    nowMs: NOW_MS
  });

  assert.equal(result.removedArticles, 2);
  const survivingCluster = db.prepare('SELECT main_article_id, size FROM clusters WHERE id = ?').get(shrinking);
  assert.equal(survivingCluster.size, 2);
  assert.equal(survivingCluster.main_article_id, alsoFresh);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clusters WHERE id = ?').get(dissolving).c, 0);
  assert.equal(db.prepare('SELECT cluster_id FROM articles WHERE id = ?').get(lonelyFresh).cluster_id, null);
  assert.equal(result.removedClusters, 1);
});

test('daily reports outlive articles but are still capped', () => {
  const sourceId = resetDatabase();
  addArticle(sourceId, { title: '任意近期文章', ageDays: 1 });
  const write = db.prepare('INSERT INTO daily_reports (date, content_json, created_at) VALUES (?, ?, ?)');
  write.run('2026-07-20', '{}', now());
  write.run('2025-01-01', '{}', now());   // 约 570 天前：文章早已到期，但日报仍应保留
  write.run('2019-01-01', '{}', now());   // 超过 730 天：清掉

  const result = pruneDatabase({
    settings: { collect: { retentionDays: 30, irrelevantRetentionDays: 7 } },
    nowMs: NOW_MS
  });

  assert.equal(result.removedReports, 1);
  const remaining = db.prepare('SELECT date FROM daily_reports ORDER BY date').all().map(row => row.date);
  assert.deepEqual(remaining, ['2025-01-01', '2026-07-20']);
});

test('a single run is capped and reports that more work remains', () => {
  const sourceId = resetDatabase();
  for (let index = 0; index < 5; index++) {
    addArticle(sourceId, { title: `批量过期文章-${index}`, ageDays: 400 });
  }

  const first = pruneDatabase({
    settings: { collect: { retentionDays: 180, irrelevantRetentionDays: 21 } },
    nowMs: NOW_MS,
    maxDeletions: 2
  });
  assert.equal(first.removedArticles, 2);
  assert.equal(first.hasMore, true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 3);

  let guard = 0;
  let result = first;
  while (result.hasMore && guard++ < 10) {
    result = pruneDatabase({
      settings: { collect: { retentionDays: 180, irrelevantRetentionDays: 21 } },
      nowMs: NOW_MS,
      maxDeletions: 2
    });
  }
  assert.equal(result.hasMore, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 0);
});

test('a prune with nothing to delete is harmless and still records the run', () => {
  const sourceId = resetDatabase();
  const kept = addArticle(sourceId, { title: '完全新鲜的文章', ageDays: 0 });

  const result = pruneDatabase({
    settings: { collect: { retentionDays: 180, irrelevantRetentionDays: 21 } },
    nowMs: NOW_MS
  });

  assert.equal(result.removedArticles, 0);
  assert.equal(result.removedClusters, 0);
  assert.equal(result.hasMore, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles WHERE id = ?').get(kept).c, 1);
  assert.equal(getMaintenanceSnapshot().lastPruneAt, new Date(NOW_MS).toISOString());
});
