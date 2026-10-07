'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SKELETON_MIN_MS,
  DOMAIN_NAME,
  delay,
  timeAgo,
  dateLabel,
  hhmm,
  localDateString,
  parseLocalDate,
  formatBytes
} = require('../renderer/format-utils');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'format-utils.js'), 'utf8');

test('format-utils 是纯工具模块：不直读 window，也不经 UMD 泄漏全局', () => {
  // lint 式护栏：阶段 3 新模块一律依赖注入，工厂体（含 UMD 暴露层）
  // 不得出现裸 window. 直读
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/format-utils');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.FormatUtils;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.formatBytes === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'FormatUtils')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    exported: true,
    frozen: true,
    globalCreated: false
  });
});

test('timeAgo 按分钟/小时/天分档，远期回退本地化日期', () => {
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  assert.equal(timeAgo(null), '时间未知');
  assert.equal(timeAgo(iso(10 * 1000)), '刚刚');
  assert.equal(timeAgo(iso(5 * 60000)), '5 分钟前');
  assert.equal(timeAgo(iso(3 * 3600e3)), '3 小时前');
  assert.equal(timeAgo(iso(2 * 86400e3)), '2 天前');
  assert.equal(typeof timeAgo(iso(60 * 86400e3)), 'string');
});

test('dateLabel 给出今天/昨天/月日三档相对标签', () => {
  const at = (daysAgo, hour = 9) => {
    const d = new Date(Date.now() + 8 * 3600e3);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    d.setUTCHours(hour, 30, 0, 0);
    return new Date(d.getTime() - 8 * 3600e3);
  };
  assert.equal(dateLabel(null), '日期未知');
  assert.equal(dateLabel(at(0).toISOString()), '今天');
  assert.equal(dateLabel(at(1).toISOString()), '昨天');
  const older = at(9);
  const calendar = new Date(older.getTime() + 8 * 3600e3);
  assert.equal(dateLabel(older.toISOString()), `${calendar.getUTCMonth() + 1}月${calendar.getUTCDate()}日`);
});

test('去年新闻的日期分组显示年份，不能与今年同月日混淆', () => {
  const year = new Date(Date.now() + 8 * 3600e3).getUTCFullYear() - 1;
  assert.equal(dateLabel(`${year}-09-29T16:00:00Z`), `${year}年9月30日`);
});

test('hhmm 补零输出北京时间', () => {
  assert.equal(hhmm('2026-01-05T21:07:00Z'), '05:07');
  assert.equal(hhmm(null), '--:--');
});

test('新闻日期与时分在 UTC、美国和上海系统时区下保持北京时间', () => {
  const modulePath = require.resolve('../renderer/format-utils');
  for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
    const result = spawnSync(process.execPath, ['-e', `
      const { dateLabel, hhmm, timeAgo } = require(${JSON.stringify(modulePath)});
      const date = '2025-09-29T16:00:00Z';
      process.stdout.write(JSON.stringify({ label: dateLabel(date), clock: hhmm(date), published: timeAgo(date) }));
    `], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { label: '2025年9月30日', clock: '00:00', published: '2025/9/30' }, timezone);
  }
});

test('localDateString/parseLocalDate 按本地日历往返，不做 UTC 切片', () => {
  assert.equal(localDateString(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(localDateString(new Date(2026, 11, 31)), '2026-12-31');
  const parsed = parseLocalDate('2026-08-09');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 7);
  assert.equal(parsed.getDate(), 9);
  assert.equal(localDateString(parsed), '2026-08-09');
});

test('formatBytes 对空库和各量级都给出可读结果', () => {
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(-5), '0 MB');
  assert.equal(formatBytes(NaN), '0 MB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
});

test('delay 与骨架最短驻留常量保持既有语义', async () => {
  assert.equal(SKELETON_MIN_MS, 240);
  const startedAt = Date.now();
  await delay(30);
  assert.ok(Date.now() - startedAt >= 25);
  assert.equal(DOMAIN_NAME.lowaltitude, '低空经济');
  assert.equal(DOMAIN_NAME.aerospace, '商业航天');
});
