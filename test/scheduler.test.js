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

test('scheduler and pipeline compare ISO timestamps through SQLite time functions', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'pipeline.js'), 'utf8');
  const cluster = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'cluster.js'), 'utf8');
  assert.doesNotMatch(pipeline, /fetched_at\s*>\s*datetime/);
  assert.doesNotMatch(cluster, /fetched_at\s*>\s*datetime/);
  assert.match(pipeline, /julianday\(fetched_at\)/);
  assert.match(cluster, /julianday\(a\.fetched_at\)/);
});
