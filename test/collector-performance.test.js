'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-collect-performance-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase } = require('../server/db');
const { collectAll, collectSource, seedSources, createEnrichmentCache } = require('../server/collectors');
const rss = require('../server/collectors/rss');
const originalFetch = rss.fetch;
const network = { snapshot: () => ({ available: true }), detect: async () => ({ available: true }) };

test.after(() => { rss.fetch = originalFetch; closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });
function sources(names) {
  seedSources();
  db.exec('UPDATE sources SET enabled=0');
  return names.map(([name, intl = 0]) => Number(db.prepare(`INSERT INTO sources(name,type,url,tier,domain,intl)
    VALUES(?,'rss',?,'T1','aerospace',?)`).run(name, `https://example.test/feed-${name}`, intl).lastInsertRowid));
}
const item = url => ({ title: '商业航天火箭完成发动机地面试验', url, publishedAt: new Date().toISOString() });

test('国内入库和进度通知不等待海外探测，海外请求仍等探测成功', async () => {
  sources([['domestic'], ['international', 1]]);
  let releaseProbe;
  const probe = new Promise(resolve => { releaseProbe = resolve; });
  let completeDomestic;
  const domestic = new Promise(resolve => { completeDomestic = resolve; });
  let internationalRequests = 0;
  rss.fetch = async source => {
    if (source.intl) internationalRequests++;
    return [item(`https://example.test/probe-${source.name}`)];
  };
  const progress = [];
  const operation = collectAll(p => {
    progress.push(p);
    if (p.source === 'domestic') completeDomestic();
  }, { network: { detect: () => probe }, enrich: async () => ({ status: 'unavailable' }) });
  let timer;
  try {
    await Promise.race([domestic, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('国内采集被海外探测阻塞')), 2000); })]);
    assert.equal(internationalRequests, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM articles WHERE url='https://example.test/probe-domestic'").get().n, 1);
    assert.equal(progress[0].completed, 1);
    assert.equal(progress[0].total, 2);
  } finally {
    clearTimeout(timer);
    releaseProbe({ available: true });
    await operation;
  }
  assert.equal(internationalRequests, 1);
  assert.equal(progress.at(-1).completed, 2);
});

test('并发信源的同篇正文只补抓一次，保留全部入口与日期且不跨轮缓存', async () => {
  sources([['duplicate-a'], ['duplicate-b']]);
  rss.fetch = async source => [{ title: '商业航天火箭完成发动机地面试验', url: `https://example.test/shared?utm_source=${source.name}` }];
  let calls = 0;
  const enrich = async () => {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    return { status: 'ok', text: '商业航天火箭完成发动机地面试验。', publishedAt: new Date().toISOString() };
  };
  const result = await collectAll(undefined, { force: true, network, enrich });
  assert.equal(calls, 1);
  assert.equal(result.results.length, 2);
  assert.equal(result.results.reduce((n, row) => n + row.added, 0), 1);
  const article = db.prepare("SELECT * FROM articles WHERE canonical_url='https://example.test/shared'").get();
  assert.ok(article.published_at);
  assert.match(article.content_text, /发动机/);
  db.prepare('DELETE FROM articles WHERE id=?').run(article.id);
  await collectAll(undefined, { force: true, network, enrich });
  assert.equal(calls, 2);
});

test('正文共享不缓存失败，按海外状态及历史日期推定时间隔离，容量有界', async () => {
  let calls = 0;
  const enrich = createEnrichmentCache(async () => {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    return calls === 1 ? { status: 'network-wait' } : { status: 'ok', text: '正文' };
  }, 2);
  const row = { url: 'https://example.test/memo?utm_source=a', intl: 0 };
  await Promise.all([enrich(row), enrich({ ...row, url: 'https://example.test/memo?utm_source=b' })]);
  assert.equal(calls, 1);
  await enrich(row);
  assert.equal(calls, 2);
  await enrich(row);
  assert.equal(calls, 2);
  await enrich({ ...row, intl: 1 });
  await enrich({ ...row, fetched_at: '2025-01-01' });
  await enrich(row);
  assert.equal(calls, 5);
});

test('进度回调故障不改变成功采集计数，全量进度包含退避和网络等待', async () => {
  const [active, backoff] = sources([['progress-active'], ['progress-backoff'], ['progress-intl', 1]]);
  db.prepare('UPDATE sources SET next_fetch_at=? WHERE id=?').run(new Date(Date.now() + 3600000).toISOString(), backoff);
  rss.fetch = async source => [item(`https://example.test/${source.name}`)];
  const updates = [];
  const warn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await collectAll(p => { updates.push(p); throw new Error('observer unavailable'); }, {
      network: { detect: async () => ({ available: false }) }, enrich: async () => ({ status: 'unavailable' })
    });
  } finally { console.warn = warn; }
  assert.equal(result.skippedBackoff, 1);
  assert.equal(result.skippedNetwork, 1);
  assert.equal(result.results.find(row => row.source === 'progress-active').added, 1);
  assert.equal(db.prepare('SELECT error_count FROM sources WHERE id=?').get(active).error_count, 0);
  assert.equal(updates.at(-1).completed, 3);
  assert.ok(updates.every(p => p.total === 3));
  assert.deepEqual(updates.map(p => p.completed), [...updates.map(p => p.completed)].sort((a, b) => a - b));
});

test('公众号已核验全文复用给分析，未知日期不触发第二次下载且保留日期精度', async () => {
  const [id] = sources([['wechat-content']]);
  db.prepare("UPDATE sources SET type='wechat' WHERE id=?").run(id);
  const source = db.prepare('SELECT * FROM sources WHERE id=?').get(id);
  const wechat = require('../server/collectors/wechat');
  const original = wechat.fetch;
  let requests = 0;
  wechat.fetch = async () => [
    { ...item('https://mp.weixin.qq.com/s/undated'), publishedAt: null, contentText: '商业航天火箭完成发动机地面试验。' },
    { ...item('https://mp.weixin.qq.com/s/dated'), contentText: '商业航天火箭完成发动机地面试验。', publicationPrecision: 'day', publicationDateText: '正式发布日期' }
  ];
  try {
    const result = await collectSource(source, { collect: { keepDays: 30 } }, { network, enrich: async () => { requests++; return { status: 'unavailable' }; } });
    assert.equal(result.added, 2);
    assert.equal(requests, 0);
    const undated = db.prepare("SELECT * FROM articles WHERE url='https://mp.weixin.qq.com/s/undated'").get();
    assert.equal(undated.content_status, 'ok');
    assert.ok(undated.publication_checked_at);
    assert.equal(undated.published_at, null);
    const dated = db.prepare("SELECT * FROM articles WHERE url='https://mp.weixin.qq.com/s/dated'").get();
    assert.equal(dated.content_status, 'ok');
    assert.equal(dated.publication_precision, 'day');
    assert.equal(dated.publication_date_text, '正式发布日期');
  } finally { wechat.fetch = original; }
});
