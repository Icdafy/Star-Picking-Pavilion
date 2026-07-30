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
  const cluster = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'cluster.js'), 'utf8');
  assert.doesNotMatch(pipeline, /fetched_at\s*>\s*datetime/);
  assert.doesNotMatch(cluster, /fetched_at\s*>\s*datetime/);
  assert.match(pipeline, /julianday\(fetched_at\)/);
  assert.match(cluster, /julianday\(a\.fetched_at\)/);
});

test('database compaction is mutually exclusive and evaluated only after retention cleanup', () => {
  assert.match(source, /let compactRunning = false/);
  assert.match(source, /if \(compactRunning\) return \{ skipped: true, reason: 'maintenance' \}/);
  assert.match(source, /function compactOnce\(trigger = 'manual'/);
  assert.match(source, /collectRunning \|\| analyzeRunning \|\| pruneRunning \|\| compactRunning/);
  assert.match(source, /pruneOnce\('cron'\)[\s\S]*compactOnce\('cron', \{ mode: 'auto' \}\)/);
  assert.match(source, /pruneOnce\('startup'\)[\s\S]*compactOnce\('startup', \{ mode: 'auto' \}\)/);
});
