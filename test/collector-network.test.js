'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-network-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase } = require('../server/db');
const { collectAll, seedSources } = require('../server/collectors');
const { describeHealth } = require('../server/source-health');
const { summarizeSourceResults, hasStrictAuditFailure } = require('../scripts/audit-sources');
test.after(() => { closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('离线和大陆受限网络完全跳过海外请求，手动采集也不绕过；恢复后自动继续', async () => {
  seedSources(); db.exec('UPDATE sources SET enabled=0');
  const requests = { domestic: 0, international: 0 };
  const server = http.createServer((req, res) => {
    requests[req.url.includes('intl') ? 'international' : 'domestic']++;
    res.setHeader('Content-Type', 'application/rss+xml');
    res.end(`<rss version="2.0"><channel><title>source</title><item><title>${req.url.includes('intl') ? 'SpaceX completes rocket flight test' : '低空经济试点新增无人机物流航线'}</title>
      <link>https://example.test${req.url}</link></item></channel></rss>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const insert = (name, url, intl) => Number(db.prepare(`INSERT INTO sources(name,type,url,tier,domain,intl)
    VALUES(?,'rss',?,'T2','aerospace',?)`).run(name, url, intl).lastInsertRowid);
  insert('国内', `${base}/domestic.xml`, 0);
  const id = insert('海外', `${base}/intl.xml`, 1);
  const prior = db.prepare('SELECT * FROM sources WHERE id=?').get(id);
  let available = false;
  const network = { detect: async () => network.snapshot(), snapshot: () => ({ state: available ? 'available' : 'unavailable', available, country: 'CN' }) };
  try {
    for (const force of [false, true]) {
      const result = await collectAll(null, { force, network });
      assert.equal(result.skippedNetwork, 1);
      assert.equal(result.results.filter(x => x.error).length, 0);
      const summary = summarizeSourceResults(result.results);
      assert.equal(summary.counts.skipped, 1);
      assert.equal(summary.counts.empty, 0);
      assert.equal(hasStrictAuditFailure(summary), false);
    }
    assert.deepEqual(requests, { domestic: 2, international: 0 });
    assert.deepEqual(db.prepare('SELECT * FROM sources WHERE id=?').get(id), prior);
    assert.equal(describeHealth(prior, Date.now(), network.snapshot()).state, 'network-wait');
    available = true;
    const restored = await collectAll(null, { network });
    assert.equal(restored.skippedNetwork, 0);
    assert.equal(requests.international, 1);
    assert.equal(db.prepare('SELECT error_count FROM sources WHERE id=?').get(id).error_count, 0);
    assert.equal(db.prepare('SELECT translation_status FROM articles WHERE source_id=?').get(id).translation_status, 'pending');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('历史海外新闻的正文补抓同样静默等待，国内正文不受影响', async () => {
  const { enrichArticle } = require('../server/collectors/article-content');
  const source = Number(db.prepare("INSERT INTO sources(name,url,type,intl) VALUES('海外正文','https://example.test/body-source','rss',1)").run().lastInsertRowid);
  let calls = 0;
  const fetchPageImpl = async url => { calls++; return { html: '<article><h1>火箭试飞</h1><p>完成测试。</p></article>', url }; };
  const network = { detect: async () => ({ available: false }) };
  const waiting = await enrichArticle({ source_id: source, url: 'https://example.test/news' }, { network, fetchPageImpl });
  assert.equal(waiting.status, 'network-wait');
  assert.equal(calls, 0);
  const domestic = await enrichArticle({ intl: 0, url: 'https://example.test/domestic' }, { network, fetchPageImpl });
  assert.equal(domestic.status, 'ok');
  assert.equal(calls, 1);
  const restored = await enrichArticle({ source_id: source, url: 'https://example.test/news' }, { network: { detect: async () => ({ available: true }) }, fetchPageImpl });
  assert.equal(restored.status, 'ok');
  assert.equal(calls, 2);
});

test('没有启用海外源时不进行 IP 或可达性请求', async () => {
  db.exec('UPDATE sources SET enabled=0');
  const result = await collectAll(null, { network: { snapshot: () => ({ state: 'unknown' }), detect: () => { throw new Error('unexpected network request'); } } });
  assert.equal(result.results.length, 0);
});
