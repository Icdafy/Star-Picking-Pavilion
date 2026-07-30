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

// 返回 { 标题: id }，方便按标题精确断言
function seed(server, articles) {
  const database = openDatabase(server);
  const ids = {};
  try {
    const sourceId = database.prepare(`INSERT INTO sources (name, type, url, tier, domain)
      VALUES ('星标测试', 'rss', ?, 'T1', 'aerospace')`)
      .run(`https://example.com/feed-${Math.random()}`).lastInsertRowid;
    const insert = database.prepare(`INSERT INTO articles
      (source_id, title, url, summary_raw, ai_summary, fetched_at, published_at,
       relevant, analyzed, quality_score, featured, domain, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'aerospace', ?)`);
    const ftsInsert = database.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)');
    for (const article of articles) {
      const stamp = article.at || new Date(Date.now() - (article.ageHours || 0) * 3600_000).toISOString();
      const id = insert.run(
        sourceId, article.title, `https://example.com/${Math.random()}`,
        article.title, article.summary || '', stamp, stamp,
        article.relevant === undefined ? 1 : article.relevant,
        article.quality ?? 60, article.featured ? 1 : 0, article.category || '发射与任务'
      ).lastInsertRowid;
      ftsInsert.run(id, article.title, article.summary || '');
      ids[article.title] = Number(id);
    }
    return ids;
  } finally {
    database.close();
  }
}

function headers(server) {
  return { [API_TOKEN_HEADER]: server.token, 'Content-Type': 'application/json' };
}

async function getJson(server, pathname) {
  const response = await server.request({ pathname, headers: headers(server) });
  assert.equal(response.status, 200, `${pathname} -> ${response.status} ${response.body}`);
  return JSON.parse(response.body);
}

function star(server, id, starred) {
  return server.request({
    pathname: `/api/articles/${id}/star`,
    method: 'POST',
    headers: headers(server),
    body: JSON.stringify({ starred })
  });
}

test('星标可以来回切换，并在信息流条目上如实回报', async t => {
  const server = await startServer(t);
  const ids = seed(server, [{ title: '值得长期跟踪的火箭复用进展', quality: 70 }]);
  const id = ids['值得长期跟踪的火箭复用进展'];

  const before = await getJson(server, 'view=all&page=0'.replace(/^/, '/api/feed?'));
  assert.equal(before.items[0].starred, false);
  assert.equal(before.items[0].starredAt, null);

  const on = await star(server, id, true);
  assert.equal(on.status, 200);
  const onBody = JSON.parse(on.body);
  assert.equal(onBody.starred, true);
  assert.ok(onBody.starredAt, '开启星标必须记录收藏时间');

  const after = await getJson(server, '/api/feed?view=all&page=0');
  assert.equal(after.items[0].starred, true);
  assert.equal(after.items[0].starredAt, onBody.starredAt);

  const off = JSON.parse((await star(server, id, false)).body);
  assert.equal(off.starred, false);
  assert.equal(off.starredAt, null);
  const cleared = await getJson(server, '/api/feed?view=all&page=0');
  assert.equal(cleared.items[0].starred, false);
});

test('星标视图按收藏时间倒序，且不受相关性判定影响', async t => {
  const server = await startServer(t);
  const ids = seed(server, [
    { title: '先收藏的那条', quality: 90, ageHours: 1 },
    { title: '后收藏的那条', quality: 40, ageHours: 200 },
    { title: 'AI 判为无关但我想留着', quality: 10, relevant: 0, ageHours: 5 },
    { title: '从没收藏过的条目', quality: 95 }
  ]);

  // 收藏顺序刻意与发布时间、质量分都不一致，才能证明排序键真的是 starred_at
  await star(server, ids['先收藏的那条'], true);
  await star(server, ids['后收藏的那条'], true);
  await star(server, ids['AI 判为无关但我想留着'], true);

  const starred = await getJson(server, '/api/feed?view=starred&page=0');
  assert.deepEqual(starred.items.map(item => item.title), [
    'AI 判为无关但我想留着',
    '后收藏的那条',
    '先收藏的那条'
  ]);
  assert.equal(starred.items.every(item => item.starred), true);

  // relevant=0 的条目在「全部动态」里看不到，但收藏夹里必须还在
  const all = await getJson(server, '/api/feed?view=all&page=0');
  assert.equal(all.items.some(item => item.title === 'AI 判为无关但我想留着'), false);
});

test('簇内非主条被星标后仍留在收藏夹里，不会被事件簇折叠吃掉', async t => {
  const server = await startServer(t);
  const ids = seed(server, [
    { title: '同一事件的主条报道', quality: 90 },
    { title: '同一事件的次条报道', quality: 50 }
  ]);

  const database = openDatabase(server);
  try {
    const clusterId = database.prepare(
      "INSERT INTO clusters (main_article_id, size, updated_at) VALUES (?, 2, '2026-07-25T00:00:00.000Z')")
      .run(ids['同一事件的主条报道']).lastInsertRowid;
    database.prepare('UPDATE articles SET cluster_id=? WHERE id IN (?, ?)')
      .run(clusterId, ids['同一事件的主条报道'], ids['同一事件的次条报道']);
  } finally {
    database.close();
  }

  // 折叠后「全部动态」只剩主条 —— 这正是次条必须豁免折叠的原因
  const all = await getJson(server, '/api/feed?view=all&page=0');
  assert.deepEqual(all.items.map(item => item.title), ['同一事件的主条报道']);

  await star(server, ids['同一事件的次条报道'], true);
  const starred = await getJson(server, '/api/feed?view=starred&page=0');
  assert.deepEqual(starred.items.map(item => item.title), ['同一事件的次条报道']);
});

test('保留清理永不删除星标情报，「待清理」计数也不把它算进去', async t => {
  const server = await startServer(t);
  const ids = seed(server, [
    { title: '过期且被星标的情报', quality: 70, ageHours: 24 * 400 },
    { title: '过期且未被星标的情报', quality: 70, ageHours: 24 * 400 },
    { title: '过期无关且被星标的噪声', quality: 5, relevant: 0, ageHours: 24 * 60 }
  ]);
  await star(server, ids['过期且被星标的情报'], true);
  await star(server, ids['过期无关且被星标的噪声'], true);

  const before = await getJson(server, '/api/maintenance');
  assert.equal(before.articles, 3);
  assert.equal(before.starred, 2);
  // 三条都已过保留期，但两条有星标：只有一条真的会被删
  assert.equal(before.expiring, 1);

  const pruned = JSON.parse((await server.request({
    pathname: '/api/maintenance/prune', method: 'POST', headers: headers(server)
  })).body);
  assert.equal(pruned.removedArticles, 1);

  const remaining = await getJson(server, '/api/feed?view=starred&page=0');
  assert.deepEqual(remaining.items.map(item => item.title).sort(), [
    '过期且被星标的情报',
    '过期无关且被星标的噪声'
  ]);

  const after = await getJson(server, '/api/maintenance');
  assert.equal(after.articles, 2);
  assert.equal(after.expiring, 0);
});

test('星标接口拒绝非布尔状态与不存在的情报', async t => {
  const server = await startServer(t);
  const ids = seed(server, [{ title: '任意情报', quality: 60 }]);

  for (const body of ['{"starred":"yes"}', '{"starred":1}', '{}', '[]']) {
    const response = await server.request({
      pathname: `/api/articles/${ids['任意情报']}/star`,
      method: 'POST', headers: headers(server), body
    });
    assert.equal(response.status, 400, `应当拒绝 ${body}`);
  }

  const missing = await star(server, 999999, true);
  assert.equal(missing.status, 404);
});

test('/api/stats 暴露星标总数，界面才能在标签上显示计数', async t => {
  const server = await startServer(t);
  const ids = seed(server, [{ title: '甲', quality: 60 }, { title: '乙', quality: 60 }]);

  assert.equal((await getJson(server, '/api/stats')).starred, 0);
  await star(server, ids['甲'], true);
  assert.equal((await getJson(server, '/api/stats')).starred, 1);
  await star(server, ids['乙'], true);
  assert.equal((await getJson(server, '/api/stats')).starred, 2);
  await star(server, ids['甲'], false);
  assert.equal((await getJson(server, '/api/stats')).starred, 1);
});

// 日报覆盖「该日期 08:00 往前 24 小时」。跑测试的时刻可能在 08:00 前后任意一侧，
// 因此固定挑一个过去的报告日，并把文章放在它窗口正中间，结果才与运行时间无关。
function reportWindow(daysAgo = 3) {
  const end = new Date();
  end.setDate(end.getDate() - daysAgo);
  end.setHours(8, 0, 0, 0);
  const pad = value => String(value).padStart(2, '0');
  return {
    date: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    insideAt: new Date(end.getTime() - 12 * 3600_000).toISOString()
  };
}

test('日报导出返回可直接落盘的文件名与两种格式的正文', async t => {
  const server = await startServer(t);
  const { date, insideAt } = reportWindow();
  seed(server, [
    { title: '当日头条级情报', quality: 88, featured: true, category: '政策法规', at: insideAt },
    { title: '窗口外的情报', quality: 95, featured: true, category: '政策法规', ageHours: 24 * 30 }
  ]);

  const markdown = await getJson(server, `/api/export?kind=daily&date=${date}&format=markdown`);
  assert.equal(markdown.filename, `摘星阁-情报日报-${date}.md`);
  assert.equal(markdown.format, 'markdown');
  assert.equal(markdown.count, 1);
  assert.match(markdown.content, new RegExp(`^# 摘星阁 · 情报日报 ${date}\n`));
  assert.match(markdown.content, /## 政策法规/);
  assert.match(markdown.content, /\*\*\[当日头条级情报\]\(https:\/\/example\.com\//);
  assert.match(markdown.content, /由 摘星阁 v0\.0\.12 生成/);
  assert.doesNotMatch(markdown.content, /窗口外的情报/);

  const text = await getJson(server, `/api/export?kind=daily&date=${date}&format=text`);
  assert.equal(text.filename, `摘星阁-情报日报-${date}.txt`);
  assert.doesNotMatch(text.content, /\*\*/);
  assert.match(text.content, /1\. 当日头条级情报/);
});

test('列表导出跟随当前筛选，并且始终从第一条开始', async t => {
  const server = await startServer(t);
  const ids = seed(server, [
    { title: '被收藏的甲情报', quality: 70, ageHours: 3 },
    { title: '被收藏的乙情报', quality: 70, ageHours: 2 },
    { title: '没被收藏的丙情报', quality: 70, ageHours: 1 }
  ]);
  await star(server, ids['被收藏的甲情报'], true);
  await star(server, ids['被收藏的乙情报'], true);

  const starred = await getJson(server, '/api/export?kind=feed&view=starred&format=markdown');
  assert.equal(starred.count, 2);
  assert.match(starred.filename, /^摘星阁-星标情报-\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(starred.content, /# 摘星阁 · 星标情报/);
  assert.match(starred.content, /被收藏的甲情报/);
  assert.doesNotMatch(starred.content, /没被收藏的丙情报/);

  // 用户翻到了第 3 页，导出仍然要给出完整列表而不是那一页
  const deepPage = await getJson(server, '/api/export?kind=feed&view=starred&page=3&format=markdown');
  assert.equal(deepPage.count, 2);

  const searched = await getJson(
    server, `/api/export?kind=feed&view=all&q=${encodeURIComponent('被收藏的甲')}&format=text`);
  assert.equal(searched.count, 1);
  assert.match(searched.content, /检索「被收藏的甲」/);
});

test('导出接口拒绝未知的类型与格式', async t => {
  const server = await startServer(t);

  for (const query of [
    'kind=everything&format=markdown',
    'kind=daily&format=pdf',
    'kind=feed&view=nonsense&format=markdown',
    'kind=daily&date=2026-13-40&format=markdown'
  ]) {
    const response = await server.request({ pathname: `/api/export?${query}`, headers: headers(server) });
    assert.equal(response.status, 400, `应当拒绝 ${query}`);
  }
});

test('情报备忘可以写入、回看和删除，不再是只写不读的黑洞', async t => {
  const server = await startServer(t);

  assert.deepEqual(await getJson(server, '/api/feedback'), []);

  const created = JSON.parse((await server.request({
    pathname: '/api/feedback', method: 'POST', headers: headers(server),
    body: JSON.stringify({ kind: 'feedback', content: '希望能按公司维度做聚合' })
  })).body);
  assert.equal(created.ok, true);
  assert.ok(Number.isInteger(created.id));

  const notes = await getJson(server, '/api/feedback');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, '希望能按公司维度做聚合');
  assert.equal(notes[0].kind, 'feedback');
  assert.ok(notes[0].createdAt);

  const removed = await server.request({
    pathname: `/api/feedback/${created.id}`, method: 'DELETE', headers: headers(server)
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(await getJson(server, '/api/feedback'), []);

  const missing = await server.request({
    pathname: `/api/feedback/${created.id}`, method: 'DELETE', headers: headers(server)
  });
  assert.equal(missing.status, 404);
});
