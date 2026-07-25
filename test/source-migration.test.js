'use strict';

// 信源迁移必须在真库上验证：它改的是用户已经用了一段时间的那张表，
// 迁错的代价是「历史统计丢了」或「死源继续每轮空转」，纯函数测不出来。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-migration-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { db } = require('../server/db');
const { applySourceMigrations } = require('../server/collectors');

test.after(() => {
  try { require('../server/db').closeDatabase(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function insertSource(overrides = {}) {
  const source = {
    name: '旧源', type: 'html', url: 'https://example.test/old', tier: 'T2',
    domain: 'aerospace', enabled: 1, selector_json: null, note: '旧备注', ...overrides
  };
  const id = db.prepare(`INSERT INTO sources
    (name, type, url, tier, domain, enabled, selector_json, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    source.name, source.type, source.url, source.tier, source.domain,
    source.enabled, source.selector_json, source.note).lastInsertRowid;
  return Number(id);
}

const byId = id => db.prepare('SELECT * FROM sources WHERE id = ?').get(id);

test('改地址保留原有行：id、采集统计与用户的启停状态都不丢', () => {
  const id = insertSource({ url: 'https://old.test/a', name: '老名字' });
  db.prepare('UPDATE sources SET fetch_count=17, item_count=203, error_count=4, consecutive_errors=6 WHERE id=?').run(id);

  const applied = applySourceMigrations([{
    from: 'https://old.test/a', to: 'https://new.test/a', name: '新名字', tier: 'T1',
    selector: { list: 'td.list a' }, note: '新备注'
  }]);

  assert.equal(applied, 1);
  const row = byId(id);
  assert.equal(row.url, 'https://new.test/a');
  assert.equal(row.name, '新名字');
  assert.equal(row.tier, 'T1');
  assert.equal(JSON.parse(row.selector_json).list, 'td.list a');
  assert.equal(row.note, '新备注');
  // 历史统计是用户判断信源质量的依据，迁移不能顺手清掉
  assert.equal(row.fetch_count, 17);
  assert.equal(row.item_count, 203);
  assert.equal(row.error_count, 4);
  // 换了地址等于「我已处理」，退避必须清零让它下一轮立刻重试
  assert.equal(row.consecutive_errors, 0);
  assert.equal(row.next_fetch_at, null);
});

test('迁移可反复执行：跑第二遍不再改动任何行', () => {
  insertSource({ url: 'https://old.test/b' });
  const step = [{ from: 'https://old.test/b', to: 'https://new.test/b', name: 'B' }];
  assert.equal(applySourceMigrations(step), 1);
  assert.equal(applySourceMigrations(step), 0, '老地址已不存在，第二遍应当无事可做');
});

test('用户已删的源不会被迁移复活', () => {
  assert.equal(applySourceMigrations([
    { from: 'https://never-existed.test/', to: 'https://new.test/z', name: 'Z' }
  ]), 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sources WHERE url=?').get('https://new.test/z').c, 0);
});

test('目标地址已被占用时停用老源，不会撞 url 唯一约束', () => {
  const oldId = insertSource({ url: 'https://old.test/c' });
  const newId = insertSource({ url: 'https://new.test/c', name: '用户自己加的' });

  assert.doesNotThrow(() => applySourceMigrations([
    { from: 'https://old.test/c', to: 'https://new.test/c', name: 'C' }
  ]));
  assert.equal(byId(oldId).enabled, 0, '重复的老源应当被停用');
  assert.equal(byId(oldId).url, 'https://old.test/c', '不能改写成已占用的地址');
  assert.equal(byId(newId).name, '用户自己加的', '不能覆盖用户自己加的那条');
});

test('清退只停用不删除，历史文章与信源记录原样保留', () => {
  const id = insertSource({ url: 'https://dead.test/', name: '死源' });
  db.prepare('UPDATE sources SET item_count=88 WHERE id=?').run(id);

  assert.equal(applySourceMigrations([
    { from: 'https://dead.test/', retire: true, note: '实测不可达，先停用' }
  ]), 1);

  const row = byId(id);
  assert.equal(row.enabled, 0);
  assert.equal(row.note, '实测不可达，先停用');
  assert.equal(row.item_count, 88, '停用不该抹掉历史');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sources WHERE id=?').get(id).c, 1, '停用不是删除');
  // 已经停用的源再跑一遍不算改动
  assert.equal(applySourceMigrations([{ from: 'https://dead.test/', retire: true }]), 0);
});

test('用户手工重新启用后，迁移不会把它再关掉一次以外的事', () => {
  const id = insertSource({ url: 'https://revived.test/' });
  applySourceMigrations([{ from: 'https://revived.test/', retire: true, note: '停用' }]);
  db.prepare('UPDATE sources SET enabled=1 WHERE id=?').run(id);
  // 同一版本内迁移只跑一次（由 seedVersion 把关），这里断言的是幂等函数本身的行为：
  // 用户显式启用后，若迁移再次执行仍会停用它 —— 因此调用点必须靠版本号守住，只跑一次
  assert.equal(applySourceMigrations([{ from: 'https://revived.test/', retire: true, note: '停用' }]), 1);
  assert.equal(byId(id).enabled, 0);
});

test('空迁移清单与非数组输入都安全', () => {
  assert.equal(applySourceMigrations([]), 0);
  assert.equal(applySourceMigrations(undefined), 0);
  assert.equal(applySourceMigrations(null), 0);
});
