'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-source-v13-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase, insertArticle } = require('../server/db');
const { seedSources } = require('../server/collectors');
const { sanitizeSourceInput } = require('../server/input-validation');
const seed = require('../config/sources.default.json');
test.after(() => { closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('内置信源全部可验证，语义重复检索已合并，海外与国内报道分别标记', () => {
  const seen = new Set();
  const keywords = new Set();
  for (const source of seed.sources) {
    assert.doesNotThrow(() => sanitizeSourceInput(source), source.name);
    assert.equal(seen.has(source.url), false, source.url);
    seen.add(source.url);
    if (source.url.startsWith('eastmoney://')) {
      const keyword = decodeURIComponent(source.url.split('?')[0]).toLowerCase();
      assert.equal(keywords.has(keyword), false, keyword);
      keywords.add(keyword);
      assert.equal(Boolean(source.intl), false, '国内检索中的海外公司无需外网开关');
    }
  }
  assert.equal(seed.sources.length, 201);
  assert.equal(seed.sources.filter(s => s.intl).length, 16);
  assert.equal(seed.sources.some(s => s.url === 'http://www.uav-cn.com/'), false);
});

test('v12 升级定向清退重复入口，保护星标和来源；用户停用及删除不被复活', () => {
  const insert = (name, url, enabled = 1, removed = null, intl = 0) => Number(db.prepare(`INSERT INTO sources
    (name,type,url,tier,domain,enabled,removed_at,intl) VALUES(?,'rss',?,'T2','aerospace',?,?,?)`).run(name,url,enabled,removed,intl).lastInsertRowid);
  const duplicate = insert('重复入口', 'eastmoney://低空空域');
  const survivor = insert('已有深度入口', 'eastmoney://低空空域?pages=2&mode=both');
  const custom = insert('用户停用源', 'https://example.test/custom-paused', 0);
  const deleted = insert('用户删除融资源', 'https://www.pedaily.cn/first/', 0, new Date().toISOString());
  const overseas = insert('用户海外源', 'https://example.test/user-international', 1, null, 1);
  insertArticle({ sourceId: duplicate, title: '历史低空空域消息', url: 'https://example.test/starred-old' });
  insertArticle({ sourceId: overseas, title: 'SpaceX completes rocket flight test', url: 'https://example.test/old-untranslated' });
  db.prepare('UPDATE articles SET starred=1 WHERE source_id=?').run(duplicate);
  db.prepare('UPDATE sources SET item_count=18, fetch_count=7 WHERE id=?').run(duplicate);
  db.prepare("INSERT INTO meta(key,value) VALUES('seedVersion','12')").run();
  seedSources();
  const row = id => db.prepare('SELECT * FROM sources WHERE id=?').get(id);
  assert.ok(row(duplicate).removed_at);
  assert.equal(row(duplicate).item_count, 18);
  assert.equal(row(survivor).enabled, 1);
  assert.equal(row(custom).removed_at, null);
  assert.equal(row(custom).enabled, 0);
  assert.ok(row(deleted).removed_at);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sources WHERE url=?').get('https://www.pedaily.cn/first/t76/').c, 0);
  assert.equal(db.prepare('SELECT starred FROM articles WHERE source_id=?').get(duplicate).starred, 1);
  assert.equal(db.prepare('SELECT translation_status FROM articles WHERE source_id=?').get(overseas).translation_status, 'pending');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const before = db.prepare('SELECT * FROM sources ORDER BY id').all();
  seedSources();
  assert.deepEqual(db.prepare('SELECT * FROM sources ORDER BY id').all(), before);
});

test('启停操作保留完整网页解析配置和外网标记', () => {
  const source = seed.sources.find(s => s.name === '亿航智能·公司新闻');
  const current = { ...source, enabled: 1, intl: 1, selector_json: JSON.stringify(source.selector) };
  const result = sanitizeSourceInput({ enabled: false }, current);
  assert.deepEqual(result.selector, source.selector);
  assert.equal(result.intl, true);
  assert.throws(() => sanitizeSourceInput({ intl: 'yes' }, current), /布尔值/);
});
