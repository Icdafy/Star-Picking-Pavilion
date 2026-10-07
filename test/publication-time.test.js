'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-publication-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase, insertArticle } = require('../server/db');
const { extractContent } = require('../server/collectors/article-content');
const { parsePublicationDate, publicationUpperBound } = require('../server/collectors/publication-date');
const { repairPublicationTimes, savePublicationTime } = require('../server/publication-time');
const { collectSource } = require('../server/collectors');
const rss = require('../server/collectors/rss');
const originalFetch = rss.fetch;
test.after(() => { rss.fetch = originalFetch; closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });
const url = 'https://www.galactic-energy.cn/index.php/Show/cid/11/aid/269';
const article = '<div class="news_content"><h1>星河动力航天完成24亿元D轮融资</h1><h3>2025/09/30</h3><div>近日，北京星河动力航天科技股份有限公司顺利完成D轮融资。</div></div>';
const network = { detect: async () => ({ available: false }) };
const sourceId = Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('官网日期核验','rss','https://example.test/feed.xml','T1','aerospace')").run().lastInsertRowid);
const source = () => db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId);
const settings = { collect: { keepDays: 30 } };

test('星河动力真实标题与日期结构读出 2025/09/30，不需要时分', () => {
  const content = extractContent('<header><h1>Latest</h1></header>' + article, url);
  assert.equal(content.publishedAt, '2025-09-29T16:00:00.000Z');
  assert.equal(content.publicationPrecision, 'day');
  assert.equal(content.publicationDateText, '2025年9月30日');
  assert.equal(content.title, '星河动力航天完成24亿元D轮融资');
});

test('发布元数据支持 JSON-LD、带时区时间和日期，不拿修改日与正文计划充数', () => {
  assert.equal(extractContent('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-09-30T10:15:00+08:00","dateModified":"2026-10-07"}</script><article>新闻</article>', url).publishedAt, '2025-09-30T02:15:00.000Z');
  assert.equal(extractContent('<meta name="publishdate" content="2025/09/30"><article>新闻</article>', url).publicationPrecision, 'day');
  for (const html of ['<article>计划于2027年1月8日发射。</article>', '<article><div class="info">计划于2027年1月8日发射。</div></article>', '<script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2026-10-07"}</script>', '<article><time itemprop="dateModified" datetime="2026-10-07">2026/10/07</time></article>', '<article><time class="last-updated" datetime="2026-10-07">2026/10/07</time></article>', '<article><time datetime="2026-10-07">更新时间：2026/10/07</time></article>', '<aside><time>2026-10-07</time></aside>', '<article><h1>火箭新闻</h1><h3>2025/02/30</h3></article>']) {
    assert.equal(extractContent(html, url).publishedAt, null, html);
  }
});

test('年月保留月份精度，月日显式标出年份推定，跨年回溯与无效日历受控', () => {
  const nowMs = Date.parse('2026-01-02T01:00:00Z');
  const month = extractContent('<article><h1>融资新闻</h1><h3>2025年9月</h3></article>', url);
  assert.equal(month.publicationPrecision, 'month');
  assert.equal(month.publicationDateText, '2025年9月');
  assert.equal(month.publishedAt, '2025-08-31T16:00:00.000Z');
  const day = extractContent('<article><h1>融资新闻</h1><h3>12月31日</h3></article>', url, { nowMs });
  assert.equal(day.publishedAt, '2025-12-30T16:00:00.000Z');
  assert.equal(day.publicationDateText, '12月31日（2025年推定）');
  assert.equal(day.publicationPrecision, 'month-day');
  const timed = parsePublicationDate('12月31日 18:30', { nowMs });
  assert.equal(timed.publishedAt, '2025-12-31T10:30:00.000Z');
  assert.equal(timed.publicationDateText, '12月31日 18:30（2025年推定）');
  assert.equal(parsePublicationDate('9/30', { nowMs, url: 'https://example.test/2024/news/10' }).publicationDateText, '2024年9月30日');
  for (const value of ['2025年13月', '2025/00', '13月1日', '2月30日']) assert.equal(parsePublicationDate(value, { nowMs }), null);
  assert.equal(publicationUpperBound(month.publishedAt, 'month'), Date.parse('2025-09-30T15:59:59.999Z'));
});

test('升级补查正文已处理且事件修复为 v3 的旧记录，保留原分析与星标并撤销旧文热度', async () => {
  insertArticle({ sourceId, title: '星河动力航天完成24亿元D轮融资', url });
  const id = db.prepare('SELECT id FROM articles WHERE url=?').get(url).id;
  db.prepare("UPDATE articles SET fetched_at='2026-10-06T17:14:27.183Z',analyzed=1,relevant=1,content_status='ok',timing_repair_version=3,starred=1,quality_score=88,ai_summary='保留原分析' WHERE id=?").run(id);
  db.prepare("INSERT INTO story_signals(article_id,story_id,participant_key,observed_at) VALUES(?,1,'source:1','2026-10-06T17:14:27.183Z')").run(id);
  let requests = 0;
  const enrich = async () => { requests++; return { ...extractContent(article, url), status: 'ok' }; };
  assert.deepEqual(await repairPublicationTimes(db, { enrich, network }), { attempted: 1, repaired: 1 });
  const row = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
  assert.equal(row.published_at, '2025-09-29T16:00:00.000Z');
  assert.equal(row.historical, 1); assert.equal(row.publication_precision, 'day');
  assert.equal(row.starred, 1); assert.equal(row.analyzed, 1); assert.equal(row.quality_score, 88);
  assert.equal(row.ai_summary, '保留原分析'); assert.equal(row.fetched_at, '2026-10-06T17:14:27.183Z');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM story_signals WHERE article_id=?').get(id).c, 0);
  await repairPublicationTimes(db, { enrich, network }); assert.equal(requests, 1);
  assert.equal(savePublicationTime(db, row, '2026-10-07'), false);
});

test('入库前补日期：有原文日期的过期新闻受保留期控制，无日期仍按采集时刻入库', async () => {
  const oldUrl = url + '?test=old';
  rss.fetch = async () => [{ title: '星河动力航天完成24亿元D轮融资', url: oldUrl }, { title: '商业航天发动机完成新一轮试车', url: 'https://example.test/undated' }];
  const result = await collectSource(source(), settings, { network, enrich: async item => item.url === oldUrl ? { ...extractContent(article, url), status: 'ok' } : { status: 'ok', text: '暂无发布元数据' } });
  assert.equal(result.added, 1);
  assert.equal(db.prepare('SELECT id FROM articles WHERE url=?').get(oldUrl), undefined);
  const row = db.prepare("SELECT * FROM articles WHERE url='https://example.test/undated'").get();
  assert.equal(row.published_at, null); assert.ok(row.fetched_at); assert.ok(row.publication_checked_at);
  let requests = 0;
  await collectSource(source(), settings, { network, enrich: async () => { requests++; return {}; } });
  assert.equal(requests, 1, '未入库的过期条目可复查，已收录未知日期须遵守退避');
});

test('月份粒度不会把本月新闻误删为月初旧文，HTTP 补查期间停用信源不写入', async () => {
  const at = new Date(Date.now() + 8 * 3600e3);
  const date = parsePublicationDate(`${at.getUTCFullYear()}年${at.getUTCMonth() + 1}月`);
  rss.fetch = async () => [{ title: '商业航天火箭完成发动机试验', url: 'https://example.test/month', ...date }];
  const result = await collectSource(source(), { collect: { keepDays: 1 } });
  assert.equal(result.added, 1);
  const row = db.prepare("SELECT * FROM articles WHERE url='https://example.test/month'").get();
  assert.equal(row.publication_precision, 'month');
  rss.fetch = async () => [{ title: '商业航天无人机发动机试车取得进展', url: 'https://example.test/stopped' }];
  const stopped = await collectSource(source(), settings, { enrich: async () => {
    db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(sourceId);
    return { status: 'ok', text: '正文' };
  } });
  assert.equal(stopped.skipped, true);
  assert.equal(db.prepare("SELECT id FROM articles WHERE url='https://example.test/stopped'").get(), undefined);
});
