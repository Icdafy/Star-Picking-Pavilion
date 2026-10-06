'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-sources-v14-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase, insertArticle } = require('../server/db');
const { seedSources, applySourceMigrations } = require('../server/collectors');
const { sanitizeSourceInput } = require('../server/input-validation');
const seed = require('../config/sources.default.json');
test.after(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });

function addArticle(value) {
  assert.ok(insertArticle(value));
  return db.prepare('SELECT id FROM articles WHERE url=?').get(value.url).id;
}

test('v13 升级修复停更入口和旧文日期，保留 ID、统计、启停、星标与自定义源', () => {
  const insert = (name, url, enabled = 1, removed = null) => Number(db.prepare(`INSERT INTO sources
    (name,type,url,tier,domain,enabled,removed_at,item_count,fetch_count) VALUES(?,'rss',?,'T1.5','both',?,?,55,9)`)
    .run(name, url, enabled, removed).lastInsertRowid);
  const xinhua = insert('新华网·科技', 'http://www.xinhuanet.com/tech/news_tech.xml', 0);
  const removed = insert('已删除人民网', 'http://www.people.com.cn/rss/scitech.xml', 0, new Date().toISOString());
  const custom = insert('用户自定义停用源', 'https://example.test/custom', 0);
  const old = addArticle({ sourceId: xinhua, title: '历史星标火箭发射消息', url: 'http://www.news.cn/tech/2022-10/07/old.htm' });
  const dated = addArticle({ sourceId: xinhua, title: '保留明确发布时间的消息', url: 'https://example.test/20261001/known.htm', publishedAt: '2026-10-02T08:00:00Z' });
  db.prepare('UPDATE articles SET starred=1 WHERE id=?').run(old);
  db.prepare("INSERT INTO meta(key,value) VALUES('seedVersion','13')").run();
  seedSources();
  const source = db.prepare('SELECT * FROM sources WHERE id=?').get(xinhua);
  assert.equal(source.url, 'https://www.news.cn/tech/');
  assert.equal(source.type, 'html');
  assert.equal(source.enabled, 0);
  assert.equal(source.item_count, 55);
  assert.equal(source.fetch_count, 9);
  assert.equal(db.prepare('SELECT published_at FROM articles WHERE id=?').get(old).published_at, '2022-10-07T00:00:00.000Z');
  assert.equal(db.prepare('SELECT starred,source_id FROM articles WHERE id=?').get(old).starred, 1);
  assert.equal(db.prepare('SELECT source_id FROM articles WHERE id=?').get(old).source_id, xinhua);
  assert.equal(db.prepare('SELECT published_at FROM articles WHERE id=?').get(dated).published_at, '2026-10-02T08:00:00Z');
  assert.ok(db.prepare('SELECT removed_at FROM sources WHERE id=?').get(removed).removed_at);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sources WHERE url=?').get('http://scitech.people.com.cn/').n, 0);
  assert.equal(db.prepare('SELECT enabled,removed_at FROM sources WHERE id=?').get(custom).removed_at, null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const before = db.prepare('SELECT * FROM sources ORDER BY id').all();
  seedSources();
  assert.deepEqual(db.prepare('SELECT * FROM sources ORDER BY id').all(), before);
});

test('已手工添加目标地址时也修复旧来源文章日期，保留两边历史归属', () => {
  const create = url => Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('日期迁移','rss',?,'T2','both')").run(url).lastInsertRowid);
  const old = create('https://example.test/old-feed');
  const target = create('https://example.test/new-feed');
  const article = addArticle({ sourceId: old, title: '历史航天文章缺少发布日期', url: 'https://example.test/2022/10/19/old.html' });
  applySourceMigrations([{ from: 'https://example.test/old-feed', to: 'https://example.test/new-feed', repairUrlDates: true }]);
  assert.equal(db.prepare('SELECT enabled FROM sources WHERE id=?').get(old).enabled, 0);
  assert.equal(db.prepare('SELECT enabled FROM sources WHERE id=?').get(target).enabled, 1);
  assert.equal(db.prepare('SELECT published_at FROM articles WHERE id=?').get(article).published_at, '2022-10-19T00:00:00.000Z');
  assert.equal(db.prepare('SELECT source_id FROM articles WHERE id=?').get(article).source_id, old);
});

test('网页日期配置通过公开接口校验，拒绝缺项、未知字段和非选择器值', () => {
  const source = seed.sources.find(s => s.name === '蓝箭航天·新闻中心');
  assert.deepEqual(sanitizeSourceInput(source).selector, source.selector);
  assert.throws(() => sanitizeSourceInput({ ...source, selector: { dateParts: { year: '.y', month: '.m' } } }), /年、月、日/);
  assert.throws(() => sanitizeSourceInput({ ...source, selector: { dateParts: { year: '.y', month: '.m', day: 1 } } }), /必须是文本/);
  assert.throws(() => sanitizeSourceInput({ ...source, selector: { dateParts: { year: '.y', month: '.m', day: '.d', extra: '.x' } } }), /年、月、日/);
});
