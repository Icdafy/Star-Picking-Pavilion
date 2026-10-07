'use strict';

// v0.2.5：发布时间不得晚于采集时刻。投资界列表页曾把「申报截止 2026-11-02」当成发布日期，
// 交易所公告按次一交易日零点标注；这些“未来时间”让条目排到全部动态第一条并显示成下个月。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-future-published-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { clampPublishedAt } = require('../server/date-time');
const { db, closeDatabase, insertArticle, repairFuturePublishedAt } = require('../server/db');
const FeedCard = require('../renderer/feed-card');

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('晚于采集时刻的发布时间以采集时刻为准，其余原样保留', () => {
  const fetched = '2026-09-30T14:29:04.758Z';
  assert.equal(clampPublishedAt('2026-11-01T16:00:00.000Z', fetched), fetched);
  assert.equal(clampPublishedAt('2026-09-30T16:00:00.000Z', fetched), fetched);
  assert.equal(clampPublishedAt('2026-09-30T08:00:00.000Z', fetched), '2026-09-30T08:00:00.000Z');
  assert.equal(clampPublishedAt(fetched, fetched), fetched);
  assert.equal(clampPublishedAt(null, fetched), null);
  assert.equal(clampPublishedAt('not a date', fetched), 'not a date');
  assert.equal(clampPublishedAt('2026-11-01T16:00:00.000Z', null), '2026-11-01T16:00:00.000Z');
});

test('入库与启动修复都不会留下未来的发布时间', () => {
  const sourceId = db.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES ('投资界·融资快讯', 'html', 'https://example.com/pedaily', 'T2', 'both')`).run().lastInsertRowid;
  const before = Date.now();
  assert.equal(insertArticle({ sourceId, title: '商业航天创新基金管理机构公开比选公告',
    url: 'https://example.com/a', publishedAt: '2099-11-01T16:00:00.000Z' }), true);
  const inserted = db.prepare('SELECT published_at, fetched_at FROM articles WHERE url = ?').get('https://example.com/a');
  assert.equal(inserted.published_at, inserted.fetched_at);
  assert.ok(Date.parse(inserted.published_at) >= before && Date.parse(inserted.published_at) <= Date.now());

  // 旧版本已经写进库里的未来时间：启动修复改回采集时刻，正常行不动
  db.prepare(`INSERT INTO articles (source_id, title, url, published_at, fetched_at) VALUES (?, ?, ?, ?, ?)`)
    .run(sourceId, '旧版未来时间', 'https://example.com/b', '2026-11-01T16:00:00.000Z', '2026-09-30T14:29:04.758Z');
  db.prepare(`INSERT INTO articles (source_id, title, url, published_at, fetched_at) VALUES (?, ?, ?, ?, ?)`)
    .run(sourceId, '正常条目', 'https://example.com/c', '2026-09-30T08:00:00.000Z', '2026-09-30T14:29:04.758Z');
  assert.equal(repairFuturePublishedAt(), 1);
  assert.equal(db.prepare('SELECT published_at FROM articles WHERE url = ?').get('https://example.com/b').published_at,
    '2026-09-30T14:29:04.758Z');
  assert.equal(db.prepare('SELECT published_at FROM articles WHERE url = ?').get('https://example.com/c').published_at,
    '2026-09-30T08:00:00.000Z');
  assert.equal(repairFuturePublishedAt(), 0);
});

test('时间轴不显示晚于收录时间的日期', () => {
  const fetchedAt = '2026-09-30T14:29:04.758Z';
  assert.equal(FeedCard.publishedTime({ publishedAt: '2026-11-01T16:00:00.000Z', fetchedAt }), fetchedAt);
  assert.equal(FeedCard.publishedTime({ eventDate: '2026-11-02', publishedAt: fetchedAt, fetchedAt }), fetchedAt);
  assert.equal(FeedCard.publishedTime({ eventDate: '2026-09-28', fetchedAt }), fetchedAt, '缺失报道日期时以采集时间整理，事件日期只作辅助');
  assert.equal(FeedCard.publishedTime({ publishedAt: '2026-09-30T08:00:00.000Z', fetchedAt }), '2026-09-30T08:00:00.000Z');
});
