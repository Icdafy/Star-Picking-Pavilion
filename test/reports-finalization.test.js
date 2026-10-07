'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-finalization-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, insertArticle, closeDatabase } = require('../server/db');
const reports = require('../server/ai/reports');
const daily = require('../server/ai/daily');
const { resolveDailyWindow } = require('../server/archive/daily-bundle');
const source = db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES ('定稿测试','rss','https://example.com/finalization','T1','aerospace')").run().lastInsertRowid;
let sequence = 0;

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(directory, { recursive: true, force: true });
});

function add(title, timestamp) {
  const url = `https://example.com/finalization-${++sequence}`;
  insertArticle({ sourceId: source, title, url, domain: 'aerospace' });
  const id = db.prepare('SELECT id FROM articles WHERE url=?').get(url).id;
  db.prepare(`UPDATE articles SET fetched_at=?,published_at=?,grouped_at=?,relevant=1,analyzed=1,
    featured=1,quality_score=80,category='发射与任务',ai_summary=? WHERE id=?`)
    .run(timestamp, timestamp, timestamp, title, id);
  return id;
}

for (const [kind, key] of [['weekly', '2026-W32'], ['monthly', '2026-08']]) {
  test(`${kind} draft includes the last reports when the period closes, then remains frozen`, t => {
    db.exec('DELETE FROM period_reports; DELETE FROM articles; DELETE FROM articles_fts');
    const end = Date.parse(reports.resolvePeriod(kind, key).end);
    t.mock.timers.enable({ apis: ['Date'], now: end - 3_600_000 });
    add('火箭完成首飞', new Date(Date.now() - 1000).toISOString());
    const draft = reports.generatePeriod(kind, key);
    assert.equal(draft.finished, false);
    assert.equal(draft.totals.featured, 1);
    t.mock.timers.setTime(end - 1000);
    add('卫星成功入轨', new Date(Date.now()).toISOString());
    t.mock.timers.setTime(end + 1000);
    const final = reports.generatePeriod(kind, key);
    assert.equal(final.finished, true);
    assert.equal(final.totals.featured, 2);
    assert.ok(final.sections.some(section => section.items.some(item => item.title === '卫星成功入轨')));
    add('下期新资料', new Date(Date.now()).toISOString());
    t.mock.timers.setTime(end + 3_600_000);
    assert.deepEqual(reports.generatePeriod(kind, key), final);
  });
}

test('a daily report opened before 08:00 is finalized at its cutoff', t => {
  db.exec('DELETE FROM daily_reports; DELETE FROM articles; DELETE FROM articles_fts');
  const date = '2026-08-15';
  const end = Date.parse(resolveDailyWindow(date).end);
  t.mock.timers.enable({ apis: ['Date'], now: end - 3_600_000 });
  add('火箭完成首飞', new Date(Date.now()).toISOString());
  assert.equal(daily.getDaily(date).total, 1);
  t.mock.timers.setTime(end - 1000);
  add('卫星成功入轨', new Date(Date.now()).toISOString());
  t.mock.timers.setTime(end + 1000);
  const final = daily.getDaily(date);
  assert.equal(final.total, 2);
  t.mock.timers.setTime(end + 3_600_000);
  // Stored snapshots round-trip through JSON (UTC's -0 offset becomes 0).
  assert.deepEqual(daily.getDaily(date), JSON.parse(JSON.stringify(final)));
});

test('rebuilding an unfinished daily report still preserves a corrupt stored row', t => {
  const date = '2026-08-16';
  const raw = '{broken';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(resolveDailyWindow(date).end) + 1000 });
  db.prepare('INSERT INTO daily_reports(date,content_json,created_at) VALUES(?,?,?)').run(date, raw, new Date().toISOString());
  assert.equal(daily.getDaily(date).warning, 'daily-report-corrupt');
  assert.equal(db.prepare('SELECT content_json FROM daily_reports WHERE date=?').get(date).content_json, raw);
});

test('nonexistent ISO week numbers cannot alias the first week of another year', () => {
  assert.throws(() => reports.resolvePeriod('weekly', '2021-W53'), error => error.status === 400);
  assert.equal(reports.resolvePeriod('weekly', '2020-W53').key, '2020-W53');
});

test('a changed report discards its old model lead even when headline counts are unchanged', t => {
  db.exec('DELETE FROM period_reports; DELETE FROM articles; DELETE FROM articles_fts');
  const key = '2026-08';
  const end = Date.parse(reports.resolvePeriod('monthly', key).end);
  t.mock.timers.enable({ apis: ['Date'], now: end + 1000 });
  const id = add('甲型火箭完成首飞', new Date(end - 1000).toISOString());
  const original = reports.generatePeriod('monthly', key);
  original.lead = '甲型火箭完成首飞，模型基于该条资料生成此导语。';
  original.leadSource = 'model';
  db.prepare('UPDATE period_reports SET content_json=? WHERE kind=? AND period_key=?').run(JSON.stringify(original), 'monthly', key);
  assert.equal(reports.generatePeriod('monthly', key, { overwrite: true }).leadSource, 'model');
  db.prepare('UPDATE articles SET title=?,ai_summary=? WHERE id=?').run('乙型卫星完成交付', '乙型卫星完成交付', id);
  const changed = reports.generatePeriod('monthly', key, { overwrite: true });
  assert.equal(changed.totals.featured, original.totals.featured);
  assert.equal(changed.leadSource, 'factual');
  assert.notEqual(changed.lead, original.lead);
});
