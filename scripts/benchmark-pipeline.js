'use strict';

// node scripts/benchmark-pipeline.js [b27daa2] [samples=5]
// 固定本地桩延迟；对照 Git 标签与当前代码，不访问真实信源或花费模型额度。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baselineRef = process.argv[2] || 'b27daa2';
const samples = Number(process.argv[3] || 5);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 20);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function schedulerSample(source) {
  let pending = 0, firstResultMs = null, analyzedReady = false;
  const started = performance.now();
  const settings = { collect: { automatic: false, intervalMinutes: 10 }, ai: {} };
  const dependencies = {
    'node-cron': { schedule() {} },
    './collectors': { collectAll: async progress => {
      await delay(30);
      pending = 6;
      progress({ source: 'fast', added: 6, completed: 1, total: 2 });
      await delay(270);
      progress({ source: 'slow', added: 0, completed: 2, total: 2 });
      return { results: [{ added: 6 }], skippedBackoff: 0, skippedNetwork: 0 };
    } },
    './ai/pipeline': {
      pendingAnalysisCount: () => pending,
      analyzePending: async (_progress, limit) => {
        if (!limit || !pending) return { analyzed: 0 };
        const count = pending; pending = 0;
        await delay(180);
        analyzedReady = true;
        return { analyzed: count, featured: count, mode: 'fixture' };
      },
      rescoreAfterClustering: () => ({ changed: 0, rescored: 0 })
    },
    './ai/stories': {
      groupPending: async () => {
        if (analyzedReady && firstResultMs == null) firstResultMs = Math.round(performance.now() - started);
        return { processed: 0 };
      },
      digestStories: async () => {}, consolidateStories: async () => ({ merged: 0 })
    },
    './ai/hot': { computeHotRanking() {}, snapshotHeat() {} },
    './ai/daily': { generateDaily() {} },
    './ai/reports': { generatePeriod() {}, previousPeriodKey() {}, enhanceLeads: async () => {} },
    './ai/receipts': { pruneReceipts() {} },
    './retention': { pruneDatabase() {} },
    './config': { loadSettings: () => settings },
    './schedule-policy': require('../server/schedule-policy'),
    './db': { db: {}, DATABASE_PATH: 'benchmark-fixture' },
    './database-maintenance': { compactDatabase() {} }
  };
  const fixture = { exports: {} };
  vm.runInNewContext(source, { module: fixture, require: name => {
    assert.ok(dependencies[name], name); return dependencies[name];
  }, console: { log() {}, warn() {}, error() {} }, setImmediate, setTimeout, clearTimeout, Date });
  const result = await fixture.exports.runPipeline('manual');
  assert.equal(result.analyzed, 6);
  return { firstResultMs, totalMs: Math.round(performance.now() - started), analyzed: result.analyzed };
}

function modelSample(ref) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'spp-throughput-'));
  try {
    const child = spawnSync(process.execPath,
      [path.join(root, 'test/helpers/pipeline-stub-child.js'), 'prefilter-scoring-overlap', ...(ref ? [ref] : [])], {
        cwd: root, encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: directory, STAR_PICKING_PAVILION_AI_API_KEY: 'sk-benchmark-local-only' }
      });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.result.analyzed, 24);
    assert.equal(result.requests, 74);
    assert.equal(result.requestsAfterRetry, 74);
    return { firstResultMs: result.firstResultMs, totalMs: result.elapsedMs,
      requests: result.requests, peakActive: result.peakActive, firstWhilePrefilterRunning: result.firstWhilePrefilterRunning,
      outcomeDigest: result.outcomeDigest };
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('spp-throughput-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function main() {
  const baselineSource = execFileSync('git', ['show', `${baselineRef}:server/scheduler.js`], { cwd: root, encoding: 'utf8' });
  const currentSource = fs.readFileSync(path.join(root, 'server/scheduler.js'), 'utf8');
  const scheduler = { baseline: [], current: [] }, models = { baseline: [], current: [] };
  for (let index = 0; index < samples; index++) {
    scheduler.baseline.push(await schedulerSample(baselineSource));
    scheduler.current.push(await schedulerSample(currentSource));
    const baseline = modelSample(baselineRef), current = modelSample();
    assert.equal(current.outcomeDigest, baseline.outcomeDigest, '相同24条输入的行业、双评分、入选、摘要、实体、事件与融资产出一致');
    assert.equal(current.firstWhilePrefilterRunning, true, '第一条产出发生在后续预筛完成之前');
    models.baseline.push(baseline);
    models.current.push(current);
  }
  const summarize = runs => ({ firstResultMs: median(runs.map(run => run.firstResultMs)),
    totalMs: median(runs.map(run => run.totalMs)) });
  process.stdout.write(JSON.stringify({ baselineRef, samples, outcomesIdentical: true,
    fixture: { scheduler: 'fast source 30ms; slow source 300ms; six articles analyzed in 180ms',
      models: '24 articles; 15ms scoring/understanding; second prefilter waits up to 250ms for first persisted result' },
    scheduler: { baseline: summarize(scheduler.baseline), current: summarize(scheduler.current), runs: scheduler },
    models: { baseline: summarize(models.baseline), current: summarize(models.current), runs: models } }, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
