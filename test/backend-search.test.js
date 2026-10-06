'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer } = require('./helpers/server-child');
const { API_TOKEN_HEADER } = require('../server/http-security');

test('search filters the full match set before sorting and paginating, with truthful lexicon counts', async t => {
  const server = await startServer(t);
  const database = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
  const stamp = new Date().toISOString();
  try {
    const sourceId = database.prepare("INSERT INTO sources(name,url,type,tier,domain) VALUES ('检索规模','https://example.com/search-scale','rss','T2','aerospace')").run().lastInsertRowid;
    const insert = database.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,published_at,domain,analyzed,relevant,featured)
      VALUES (?,?,?,?,?,'aerospace',1,?,?)`);
    const fts = database.prepare('INSERT INTO articles_fts(rowid,title,summary) VALUES (?,?,?)');
    database.exec('BEGIN');
    for (let i = 0; i < 560; i++) {
      const title = `蓝箭航天记录 ${i}`;
      const id = insert.run(sourceId, title, `https://example.com/scale/${i}`, stamp, stamp, i >= 510 ? 1 : 0, i >= 510 ? 1 : 0).lastInsertRowid;
      fts.run(id, title, '');
    }
    const shortId = insert.run(sourceId, '未出现在标题中的主体', 'https://example.com/scale/entity', stamp, stamp, 1, 1).lastInsertRowid;
    fts.run(shortId, '未出现在标题中的主体', '主体公司 亿航智能；比例100%');
    const pendingId = insert.run(sourceId, 'SpaceX completes rocket flight test', 'https://example.com/scale/pending-translation', stamp, stamp, 1, 1).lastInsertRowid;
    database.prepare("UPDATE articles SET translation_status='pending' WHERE id=?").run(pendingId);
    fts.run(pendingId, 'SpaceX completes rocket flight test', '相关主体 蓝箭航天');
    database.exec('COMMIT');
  } finally { database.close(); }
  const api = async route => {
    const response = await server.request({ pathname: route, headers: { [API_TOKEN_HEADER]: server.token } });
    assert.equal(response.status, 200);
    return JSON.parse(response.body);
  };
  const first = await api(`/api/feed?view=featured&q=${encodeURIComponent('蓝箭航天')}`);
  const second = await api(`/api/feed?view=featured&q=${encodeURIComponent('蓝箭航天')}&page=1`);
  assert.equal(first.items.length, 30);
  assert.equal(second.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
  assert.equal(first.items[0].title, '蓝箭航天记录 559');
  const lexicon = await api('/api/lexicon');
  const term = lexicon.groups.flatMap(group => group.terms).find(item => item.term === '蓝箭航天');
  assert.equal(term.count, 50);
  const short = await api(`/api/feed?view=all&q=${encodeURIComponent('亿航')}`);
  assert.equal(short.items.length, 1);
  assert.equal(short.items[0].title, '未出现在标题中的主体');
  const literal = await api(`/api/feed?view=all&q=${encodeURIComponent('100%')}`);
  assert.equal(literal.items.length, 1);
});
