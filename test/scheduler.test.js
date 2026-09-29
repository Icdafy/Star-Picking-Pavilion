'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'scheduler.js'), 'utf8');
const { collectionIntervalMs } = require('../server/schedule-policy');

test('collection intervals remain accurate beyond the cron minute field', () => {
  assert.equal(collectionIntervalMs(10), 10 * 60 * 1000);
  assert.equal(collectionIntervalMs(720), 720 * 60 * 1000);
  assert.equal(collectionIntervalMs('bad'), 10 * 60 * 1000);
  assert.doesNotMatch(source, /cron\.schedule\(`\*\/\$\{interval\}/);
  assert.match(source, /collectTimer = setInterval/);
  assert.match(source, /settings\.dailyReportHour \?\? 8/);
});

test('daily report runs exactly at 08:00 and every cron task is destroyed on stop', () => {
  assert.match(
    source,
    /cron\.schedule\(`0 \$\{settings\.dailyReportHour \?\? 8\} \* \* \*`/
  );
  assert.doesNotMatch(
    source,
    /cron\.schedule\(`5 \$\{settings\.dailyReportHour \?\? 8\} \* \* \*`/
  );
  assert.match(
    source,
    /cron\.schedule\(`25 \$\{settings\.dailyReportHour \?\? 8\} \* \* \*`/
  );
  assert.match(source, /for \(const task of cronTasks\)[\s\S]*task\.stop\?\.\(\)/);
  assert.match(source, /for \(const task of cronTasks\)[\s\S]*task\.destroy\?\.\(\)/);
  assert.match(source, /cronTasks\.clear\(\)/);
  assert.match(source, /每天 \$\{settings\.dailyReportHour \?\? 8\}:00 出日报/);
});

test('scheduler and pipeline compare ISO timestamps through SQLite time functions', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'pipeline.js'), 'utf8');
  // v0.2.0 的事件归组与刊期按 ISO 字符串绑定参数比较（两侧同为 toISOString 格式），同样不得混用 datetime()
  const stories = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'stories.js'), 'utf8');
  const reports = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'reports.js'), 'utf8');
  for (const source of [pipeline, stories, reports]) {
    assert.doesNotMatch(source, /fetched_at\s*[<>]=?\s*datetime/);
  }
  assert.match(pipeline, /julianday\(a\.fetched_at\)/);
  assert.match(stories, /a\.fetched_at >= \?/);
});

test('database compaction is mutually exclusive and evaluated only after retention cleanup', () => {
  assert.match(source, /let compactRunning = false/);
  assert.match(source, /if \(compactRunning\) return \{ skipped: true, reason: 'maintenance' \}/);
  assert.match(source, /function compactOnce\(trigger = 'manual'/);
  assert.match(source, /collectRunning \|\| analyzeRunning \|\| pruneRunning \|\| compactRunning/);
  assert.match(source, /pruneOnce\('cron'\)[\s\S]*compactOnce\('cron', \{ mode: 'auto' \}\)/);
  assert.match(source, /pruneOnce\('startup'\)[\s\S]*compactOnce\('startup', \{ mode: 'auto' \}\)/);
});
