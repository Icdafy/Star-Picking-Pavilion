'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0244-analysis-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase } = require('../server/db');
const { analyzeImages } = require('../server/ai/vision');
const { reportProgress, progressTask } = require('../server/ai/progress');
const { digestStories } = require('../server/ai/stories');
const settings = { ai: { apiKey: 'fixture', model: 'fixture', activeProvider: 'fixture' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
test.after(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });
test.beforeEach(() => { db.exec('DELETE FROM articles_fts; DELETE FROM story_signals; DELETE FROM articles; DELETE FROM clusters'); });

test('progress opens before asynchronous work and closes on success/failure; observers cannot fail work', async () => {
  const seen = [];
  let resolve;
  const pending = progressTask(event => seen.push(event), { stage: 'content', taskId: 'body:7',
    current: { id: 7, title: '字'.repeat(130), url: 'private-field' } }, () => new Promise(done => { resolve = done; }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'running');
  assert.equal(seen[0].current.title.length, 100);
  assert.equal(seen[0].current.url, undefined);
  resolve(17);
  assert.equal(await pending, 17);
  assert.equal(seen[1].status, 'completed');
  await assert.rejects(progressTask(event => seen.push(event), { stage: 'vision', taskId: 'image:7' },
    async () => { throw Error('remote provider private payload'); }));
  assert.equal(seen.at(-1).status, 'failed');
  assert.doesNotMatch(JSON.stringify(seen), /remote provider private payload/);
  assert.equal(await progressTask(() => { throw Error('disconnected observer'); }, {}, async () => 19), 19);
  assert.doesNotThrow(() => reportProgress(() => { throw Error('observer'); }, {}));
});

test('four image fetches overlap only two at a time and preserve candidate/model index order', async () => {
  const gates = [], starts = [], events = [];
  let active = 0, peak = 0;
  const result = analyzeImages({ id: 7, title: '卫星部件' }, Array.from({ length: 4 }, (_, i) => ({ url: `https://fixture.invalid/${i}` })), settings, {
    onProgress: event => events.push(event),
    fetchImage: url => {
      const index = Number(url.split('/').at(-1)); starts.push(index); active++; peak = Math.max(active, peak);
      return new Promise(resolve => { gates[index] = () => { active--; resolve({ body: Buffer.from([137,80,78,71,13,10,26,10,index]) }); }; });
    },
    call: async messages => {
      assert.deepEqual(messages[0].content.slice(1).map(block => Buffer.from(block.image_url.url.split(',')[1], 'base64').at(-1)), [0, 1, 2, 3]);
      return JSON.stringify({ images: [0, 1, 2, 3].map(i => ({ i, useful: true, caption: `部件${i}` })) });
    }
  });
  assert.deepEqual(starts, [0, 1]);
  gates[1](); await tick();
  assert.deepEqual(starts, [0, 1, 2]);
  gates[0](); await tick();
  assert.deepEqual(starts, [0, 1, 2, 3]);
  gates[3](); gates[2]();
  assert.deepEqual((await result).images.map(row => row.url), [0, 1, 2, 3].map(i => `https://fixture.invalid/${i}`));
  assert.equal(peak, 2);
  for (let i = 0; i < 4; i++) assert.deepEqual(events.filter(e => e.taskId === `image-download:7:${i}`).map(e => e.status), ['running', 'completed']);
  assert.deepEqual(events.filter(e => e.taskId === 'vision:7').map(e => e.status), ['running', 'completed']);
});

function seedDigests(count) {
  const source = Number(db.prepare(`INSERT INTO sources(name,type,url,tier,domain) VALUES('综述桩','external',?,'T1','aerospace')`)
    .run(`external://digest-${Math.random()}`).lastInsertRowid);
  for (let i = 0; i < count; i++) {
    const stamp = new Date().toISOString();
    const cluster = Number(db.prepare('INSERT INTO clusters(size,latest_at,updated_at,title) VALUES(3,?,?,?)')
      .run(stamp, stamp, `商业航天事件${i}`).lastInsertRowid);
    for (let j = 0; j < 3; j++) db.prepare(`INSERT INTO articles(source_id,title,url,ai_summary,cluster_id,relevant,analyzed,published_at,fetched_at)
      VALUES(?,?,?,?,?,1,1,?,?)`).run(source, `商业航天事件${i}报道${j}`, `https://fixture.invalid/${source}/${i}/${j}`, `事实${i}/${j}`, cluster, stamp, stamp);
  }
}

test('digest concurrency stays at two, respects three-story limit and drains a sibling after budget pause', async () => {
  seedDigests(4);
  const gates = [];
  let calls = 0, active = 0, peak = 0;
  const running = digestStories({ settings, receipt: async spec => ({ value: await spec.call() }), call: () => {
    calls++; active++; peak = Math.max(active, peak);
    return new Promise(resolve => gates.push(() => { active--; resolve('{"digest":"商业航天试验完成。"}'); }));
  } });
  assert.equal(calls, 2);
  gates[0](); await tick();
  assert.equal(calls, 3);
  gates[1](); gates[2]();
  assert.equal((await running).digested, 3);
  assert.equal(peak, 2);
  db.exec('UPDATE clusters SET digest=NULL,digest_hash=NULL');
  let receipts = 0, release, settled = false;
  const paused = digestStories({ settings, receipt: async spec => {
    if (++receipts === 2) { const error = Error('budget'); error.budgetExceeded = true; throw error; }
    return { value: await spec.call() };
  }, call: () => new Promise(resolve => { release = () => resolve('{"digest":"仍在途的综述正确落库。"}'); }) });
  paused.then(() => { settled = true; });
  await tick();
  assert.equal(receipts, 2);
  assert.equal(settled, false, 'budget pause must wait for the already-started request');
  release();
  assert.deepEqual(await paused, { digested: 1, budgetPaused: true });
});

test('translation overlap retains company/deal maintenance when callers request maintenance', async () => {
  const companies = require('../server/ai/companies'), deals = require('../server/ai/deals');
  const originals = [companies.backfillSubjects, deals.backfillHistory, process.env.STAR_PICKING_PAVILION_AI_API_KEY];
  let companyCalls = 0, dealCalls = 0;
  companies.backfillSubjects = () => { companyCalls++; return 7; };
  deals.backfillHistory = () => { dealCalls++; return { scanned: 11 }; };
  process.env.STAR_PICKING_PAVILION_AI_API_KEY = 'fixture-maintenance';
  try {
    const source = Number(db.prepare(`INSERT INTO sources(name,type,url,tier,domain) VALUES('回填桩','external',?,'T1','aerospace')`)
      .run(`external://maintenance-${Math.random()}`).lastInsertRowid);
    db.prepare('INSERT INTO articles(source_id,title,url,fetched_at) VALUES(?,?,?,?)')
      .run(source, '商业航天试验完成', `https://fixture.invalid/maintenance-${source}`, new Date().toISOString());
    const result = await require('../server/ai/pipeline').analyzePending(null, 0);
    assert.equal(result.backfilled, 18);
    assert.equal(companyCalls, 1); assert.equal(dealCalls, 1);
  } finally {
    [companies.backfillSubjects, deals.backfillHistory] = originals;
    if (originals[2] == null) delete process.env.STAR_PICKING_PAVILION_AI_API_KEY;
    else process.env.STAR_PICKING_PAVILION_AI_API_KEY = originals[2];
  }
});

test('domestic analyses are persisted while overseas translation is in flight', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0244-overlap-'));
  try {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'helpers/pipeline-stub-child.js'), 'translation-overlap'], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: profile, STAR_PICKING_PAVILION_AI_API_KEY: 'fixture-local-only' }
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.analyzed, 11);
    assert.equal(result.firstWhileTranslating, true);
    assert.ok(result.peakActive <= 11);
    assert.equal(result.requests, 36);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});
