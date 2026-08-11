'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { API_TOKEN_HEADER } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

function openDatabase(server) {
  return new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
}

function seed(server, articles) {
  const database = openDatabase(server);
  try {
    const sourceId = database.prepare(`INSERT INTO sources (name, type, url, tier, domain)
      VALUES ('检索测试', 'rss', ?, 'T2', 'aerospace')`)
      .run(`https://example.com/feed-${Math.random()}`).lastInsertRowid;
    const insert = database.prepare(`INSERT INTO articles
      (source_id, title, url, summary_raw, ai_summary, fetched_at, published_at,
       relevant, analyzed, quality_score, featured, domain,
       breakthrough_score, breakthrough_bonus, breakthrough_signals_json, scoring_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'aerospace', ?, ?, ?, 1)`);
    const ftsInsert = database.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)');
    for (const article of articles) {
      const stamp = new Date(Date.now() - (article.ageHours || 0) * 3600_000).toISOString();
      const id = insert.run(
        sourceId, article.title, `https://example.com/${Math.random()}`,
        article.title, article.summary || '', stamp, stamp,
        article.quality ?? 60, article.featured ? 1 : 0,
        article.breakthroughScore || 0,
        article.breakthroughBonus || 0,
        article.breakthroughSignals
          ? JSON.stringify(article.breakthroughSignals)
          : null
      ).lastInsertRowid;
      ftsInsert.run(id, article.title, article.summary || '');
    }
    return sourceId;
  } finally {
    database.close();
  }
}

async function feed(server, query) {
  const response = await server.request({
    pathname: `/api/feed?${query}`,
    headers: { [API_TOKEN_HEADER]: server.token }
  });
  assert.equal(response.status, 200);
  return JSON.parse(response.body);
}

test('the timeline view ranks by recency while displayed heat decays with age', async t => {
  const server = await startServer(t);
  seed(server, [
    { title: '一周前的高分旧闻', quality: 100, ageHours: 168 },
    { title: '刚刚发生的中分新闻', quality: 62, ageHours: 0 }
  ]);

  // 时间线视图按时间倒序，不受热度影响
  const all = await feed(server, 'view=all&page=0');
  assert.deepEqual(all.items.map(item => item.title), ['刚刚发生的中分新闻', '一周前的高分旧闻']);
  // 展示热度必须是随时间衰减后的值：旧闻的展示热度要明显低于它的质量分
  const stale = all.items.find(item => item.title === '一周前的高分旧闻');
  assert.equal(stale.quality, 100);
  assert.ok(stale.heat < 40, `旧闻热度未衰减：${stale.heat}`);
});

test('the displayed heat shares the breakthrough-adjusted formula', async t => {
  const server = await startServer(t);
  seed(server, [
    {
      title: '普通技术进展',
      quality: 75,
      ageHours: 18
    },
    {
      title: '可信技术突破',
      quality: 75,
      ageHours: 18,
      breakthroughScore: 0.8,
      breakthroughBonus: 8,
      breakthroughSignals: {
        objects: ['可重复使用火箭'],
        actions: ['回收'],
        credibilityEvidence: 'tier-t1',
        uncertainty: [],
        rejectedReason: null
      }
    }
  ]);

  const data = await feed(server, 'view=all&page=0');
  const breakthrough = data.items.find(item => item.title === '可信技术突破');
  const normal = data.items.find(item => item.title === '普通技术进展');
  assert.equal(breakthrough.breakthroughScore, 0.8);
  assert.equal(breakthrough.breakthroughBonus, 8);
  assert.deepEqual(breakthrough.breakthroughSignals.objects, ['可重复使用火箭']);
  assert.ok(breakthrough.heat > normal.heat);
});

test('articles far in the past still appear in the timeline when nothing newer exists', async t => {
  const server = await startServer(t);
  seed(server, [{ title: '半年前的唯一一条情报', quality: 90, ageHours: 24 * 200 }]);

  const data = await feed(server, 'view=all&page=0');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, '半年前的唯一一条情报');
});

test('LIKE wildcards in a short search term are matched literally', async t => {
  const server = await startServer(t);
  seed(server, [
    { title: '毛利率 100% 的火箭公司', quality: 70 },
    { title: '完全不相关的卫星制造进展', quality: 70 }
  ]);

  // 长度 <3 走 LIKE 降级分支；未转义时 "%" 是通配符，会把两条都匹配出来
  const wildcard = await feed(server, `view=all&page=0&q=${encodeURIComponent('%')}`);
  assert.deepEqual(wildcard.items.map(item => item.title), ['毛利率 100% 的火箭公司'],
    '% 应当按字面匹配，只命中标题里真的含有 % 的那条');

  // 未转义时 "_" 会匹配任意单字，从而命中全部文章
  const underscore = await feed(server, `view=all&page=0&q=${encodeURIComponent('_')}`);
  assert.equal(underscore.items.length, 0, '没有标题含下划线，_ 不应命中任何条目');

  const literal = await feed(server, `view=all&page=0&q=${encodeURIComponent('0%')}`);
  assert.deepEqual(literal.items.map(item => item.title), ['毛利率 100% 的火箭公司']);
});

test('the maintenance endpoint reports library size and prunes on demand', async t => {
  const server = await startServer(t);
  seed(server, [
    { title: '需要保留的新鲜情报', quality: 70 },
    { title: '应当被清理的过期情报', quality: 70, ageHours: 24 * 400 }
  ]);
  const headers = { [API_TOKEN_HEADER]: server.token };

  const before = JSON.parse((await server.request({ pathname: '/api/maintenance', headers })).body);
  assert.equal(before.articles, 2);
  assert.equal(before.expiring, 1);
  assert.equal(before.retentionDays, 180);
  assert.equal(before.lastPruneAt, null);
  assert.ok(before.databaseBytes > 0);
  assert.equal(before.database.fileBytes, before.databaseBytes);
  assert.ok(before.database.allocatedBytes > 0);
  assert.equal(typeof before.database.reclaimableBytes, 'number');
  assert.equal(typeof before.database.reclaimableRatio, 'number');
  assert.equal(before.lastOptimizeAt, null);
  assert.equal(before.lastCompactionAt, null);

  // prune 已改为 202 异步：立即返回，后台执行删除，轮询维护快照等待完成
  const pruneResponse = await server.request({
    pathname: '/api/maintenance/prune', method: 'POST', headers
  });
  assert.equal(pruneResponse.status, 202, '清理触发必须立即 202 返回');
  const pruned = JSON.parse(pruneResponse.body);
  assert.equal(pruned.ok, true);
  assert.equal(pruned.started, true);
  assert.equal(pruned.removedArticles, undefined, '202 响应不应再携带同步删除计数');

  let after;
  const deadline = Date.now() + 15_000;
  for (;;) {
    after = JSON.parse((await server.request({ pathname: '/api/maintenance', headers })).body);
    if (after.articles === 1 && after.lastPruneAt) break;
    if (Date.now() > deadline) {
      throw new Error(`等待后台清理超时，最后快照: ${JSON.stringify(after)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(after.expiring, 0);
  assert.ok(after.lastOptimizeAt);

  // 清理必须同时清掉 FTS 影子行，否则检索还能命中已删条目
  const remaining = await feed(server, `view=all&page=0&q=${encodeURIComponent('应当被清理')}`);
  assert.equal(remaining.items.length, 0);
});

test('manual database compaction accepts no path and returns only storage metrics', async t => {
  const server = await startServer(t);
  seed(server, [{ title: '压缩后仍然保留的情报', quality: 70 }]);
  const headers = {
    [API_TOKEN_HEADER]: server.token,
    'Content-Type': 'application/json'
  };

  const response = await server.request({
    pathname: '/api/maintenance/compact',
    method: 'POST',
    headers,
    body: JSON.stringify({ databasePath: 'C:\\不应被采用\\arbitrary.db' })
  });
  assert.equal(response.status, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(Object.hasOwn(result, 'databasePath'), false);
  assert.equal(Object.hasOwn(result.before, 'databasePath'), false);
  assert.equal(typeof result.before.fileBytes, 'number');
  assert.equal(typeof result.after.fileBytes, 'number');

  const feedAfter = await feed(server, 'view=all&page=0');
  assert.equal(feedAfter.items.some(item => item.title === '压缩后仍然保留的情报'), true);
});

test('retention days are validated and persisted through the settings endpoint', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'Content-Type': 'application/json' };
  const post = body => server.request({ pathname: '/api/settings', method: 'POST', headers, body: JSON.stringify(body) });

  const rejected = await post({ collect: { retentionDays: 3 } });
  assert.equal(rejected.status, 400);
  const notInteger = await post({ collect: { irrelevantRetentionDays: 2.5 } });
  assert.equal(notInteger.status, 400);

  const accepted = await post({ collect: { retentionDays: 45, irrelevantRetentionDays: 5 } });
  assert.equal(accepted.status, 200);
  const settings = JSON.parse((await server.request({ pathname: '/api/settings', headers })).body);
  assert.equal(settings.collect.retentionDays, 45);
  assert.equal(settings.collect.irrelevantRetentionDays, 5);

  const maintenance = JSON.parse((await server.request({ pathname: '/api/maintenance', headers })).body);
  assert.equal(maintenance.retentionDays, 45);
  assert.equal(maintenance.irrelevantRetentionDays, 5);
});

test('source health is exposed and a manual retry clears the backoff', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'Content-Type': 'application/json' };
  const sourceId = seed(server, [{ title: '任意文章', quality: 60 }]);

  const database = openDatabase(server);
  try {
    database.prepare('UPDATE sources SET consecutive_errors=6, next_fetch_at=? WHERE id=?')
      .run(new Date(Date.now() + 3600_000).toISOString(), sourceId);
  } finally {
    database.close();
  }

  const paused = JSON.parse((await server.request({ pathname: '/api/sources', headers })).body)
    .find(source => source.id === sourceId);
  assert.equal(paused.health.state, 'failing');
  assert.equal(paused.health.consecutiveErrors, 6);
  assert.ok(paused.health.pausedUntil);

  const retry = await server.request({
    pathname: `/api/sources/${sourceId}/retry`, method: 'POST', headers, body: '{}'
  });
  assert.equal(retry.status, 200);

  const recovered = JSON.parse((await server.request({ pathname: '/api/sources', headers })).body)
    .find(source => source.id === sourceId);
  assert.equal(recovered.health.state, 'ok');
  assert.equal(recovered.health.pausedUntil, null);

  const missing = await server.request({
    pathname: '/api/sources/999999/retry', method: 'POST', headers, body: '{}'
  });
  assert.equal(missing.status, 404);
});
