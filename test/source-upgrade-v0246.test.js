'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-sources-v15-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase, insertArticle } = require('../server/db');
const { seedSources } = require('../server/collectors');
const seed = require('../config/sources.default.json');
test.after(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });

const insert = (name, type, url, { enabled = 1, removed = null, tier = 'T2', domain = 'both' } = {}) => Number(db.prepare(`INSERT INTO sources
  (name,type,url,tier,domain,enabled,removed_at,item_count,fetch_count,consecutive_errors) VALUES(?,?,?,?,?,?,?,11,150,3)`)
  .run(name, type, url, tier, domain, enabled, removed).lastInsertRowid);
const row = id => db.prepare('SELECT * FROM sources WHERE id=?').get(id);
const byUrl = url => db.prepare('SELECT * FROM sources WHERE url=?').get(url);

test('v15 升级：官方源改走 HTTP 保留原行，零贡献入口移出但保留历史，新入口补齐且可重复执行', () => {
  const caac = insert('中国民用航空局·民航要闻', 'html', 'https://www.caac.gov.cn/XWZX/MHYW/', { tier: 'T1', domain: 'lowaltitude' });
  const cnsa = insert('国家航天局·官网', 'html', 'https://www.cnsa.gov.cn/n6758823/n6758838/index.html', { tier: 'T1', domain: 'aerospace' });
  const caacnews = insert('中国民航网·行业动态', 'html', 'http://www.caacnews.com.cn/1/7/', { tier: 'T1.5', domain: 'lowaltitude' });
  const noisy = insert('巨潮资讯·深市公告', 'api', 'cninfo://?column=szse', { tier: 'T1' });
  const capital = insert('一级市场·商业航天完成融资', 'api', 'eastmoney://商业航天 完成融资?pages=2&mode=both&guard=capital', { domain: 'aerospace' });
  const paused = insert('科学网·科研与产业', 'html', 'https://news.sciencenet.cn/', { enabled: 0, tier: 'T1.5' });
  const kept = insert('东财检索·丰翼科技', 'api', 'eastmoney://丰翼?pages=2&mode=both', { domain: 'lowaltitude' });
  const custom = insert('用户自建信源', 'rss', 'https://example.test/custom.xml');
  assert.ok(insertArticle({ sourceId: noisy, title: '历史公告保留星标', url: 'https://example.test/notice.pdf' }));
  db.prepare('UPDATE articles SET starred=1 WHERE source_id=?').run(noisy);
  db.prepare("INSERT INTO meta(key,value) VALUES('seedVersion','14')").run();

  seedSources();

  assert.equal(row(caac).url, 'http://www.caac.gov.cn/XWZX/MHYW/');
  assert.equal(row(cnsa).url, 'http://www.cnsa.gov.cn/n6758823/n6758838/index.html');
  for (const id of [caac, cnsa]) {
    assert.equal(row(id).item_count, 11, '统计保留');
    assert.equal(row(id).consecutive_errors, 0, '换址后退避清零');
    assert.equal(row(id).enabled, 1);
  }
  assert.equal(row(caacnews).url, 'http://www.caacnews.com.cn/1/10/');
  assert.equal(row(caacnews).name, '中国民航网·无人机');
  for (const id of [noisy, capital, paused]) {
    assert.ok(row(id).removed_at, `${row(id).name} 应移出监控`);
    assert.equal(row(id).enabled, 0);
    assert.equal(row(id).item_count, 11);
  }
  assert.equal(db.prepare('SELECT starred,source_id FROM articles WHERE url=?').get('https://example.test/notice.pdf').starred, 1);
  assert.equal(row(kept).removed_at, null, '公司池监控线安静不等于失效，保留');
  assert.equal(row(custom).removed_at, null);
  for (const url of ['govcn://', 'https://www.ndrc.gov.cn/fzggw/jgsj/dks/', 'https://payloadspace.com/feed/',
    'eastmoney://天龙三号?pages=2&mode=both']) assert.ok(byUrl(url), url);
  assert.equal(byUrl('https://payloadspace.com/feed/').intl, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sources WHERE url LIKE ?').get('%caac.gov.cn/XWZX/MHYW/').n, 1, '新旧地址不并存');
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='seedVersion'").get().value, '15');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const before = db.prepare('SELECT * FROM sources ORDER BY id').all();
  seedSources();
  assert.deepEqual(db.prepare('SELECT * FROM sources ORDER BY id').all(), before);
});

test('v15 目录：移出地址不回到种子库，新增地址唯一且等级与领域合法', () => {
  const urls = new Set(seed.sources.map(s => s.url));
  for (const step of seed._migrations.filter(s => s.retire)) assert.equal(urls.has(step.from), false, step.from);
  assert.equal(seed._version, 15);
  assert.equal(seed.sources.filter(s => s.note?.startsWith('v0.2.46 新增')).length, 21);
  assert.equal(seed.sources.some(s => s.url.startsWith('https://www.caac.gov.cn') || s.url.startsWith('https://www.cnsa.gov.cn')), false);
});
