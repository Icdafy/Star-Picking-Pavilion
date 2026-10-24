'use strict';
// Fixed latency fixtures, isolated SQLite and no external model/network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baselineRef = process.argv[2] || 'v0.2.43';
const rounds = Number(process.argv[3] || 3);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10);
const baselineCommit = execFileSync('git', ['rev-parse', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-analysis-tail-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase } = require('../server/db');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const current = { vision: require('../server/ai/vision'), stories: require('../server/ai/stories') };
function baseline(relative) {
  const filename = path.join(root, relative), instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance._compile(execFileSync('git', ['show', `${baselineCommit}:${relative}`], { cwd: root, encoding: 'utf8' }), filename);
  return instance.exports;
}
const previous = { vision: baseline('server/ai/vision.js'), stories: baseline('server/ai/stories.js') };
const settings = { ai: { apiKey: 'fixture', activeProvider: 'fixture', model: 'fixture' } };
const stamp = new Date().toISOString();
async function imageSample(vision) {
  let active = 0, peakActive = 0;
  const started = performance.now();
  const output = await vision.analyzeImages({ id: 1, title: '卫星零部件', url: 'https://fixture.invalid/news' },
    Array.from({ length: 4 }, (_, i) => ({ url: `https://fixture.invalid/${i}.png` })), settings, {
      fetchImage: async () => {
        active++; peakActive = Math.max(active, peakActive);
        await wait(40); active--;
        return { body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) };
      },
      call: async () => JSON.stringify({ images: Array.from({ length: 4 }, (_, i) => ({ i, useful: true, caption: `部件${i}`, kind: '实物' })) })
    });
  return { elapsedMs: Math.round(performance.now() - started), peakActive, output };
}
async function digestSample(stories) {
  db.exec('DELETE FROM articles_fts; DELETE FROM story_signals; DELETE FROM articles; DELETE FROM clusters');
  const sourceId = Number(db.prepare(`INSERT INTO sources(name,type,url,tier,domain)
    VALUES('尾部性能桩','external',?,'T1','aerospace')`).run(`external://tail-${Math.random()}`).lastInsertRowid);
  for (let i = 0; i < 6; i++) {
    db.prepare('INSERT INTO clusters(id,size,latest_at,updated_at,title) VALUES(?,3,?,?,?)').run(i + 100, stamp, stamp, `事件${i}`);
    for (let j = 0; j < 3; j++) db.prepare(`INSERT INTO articles(id,source_id,title,url,ai_summary,cluster_id,relevant,analyzed,published_at,fetched_at)
      VALUES(?,?,?,?,?,?,1,1,?,?)`).run(1000 + i * 3 + j, sourceId, `商业航天事件${i}报道${j}`,
      `https://fixture.invalid/${i}/${j}`, `事件${i}第${j}个事实`, i + 100, stamp, stamp);
  }
  let active = 0, peakActive = 0, requests = 0;
  const started = performance.now();
  const result = await stories.digestStories({ settings, receipt: async spec => ({ value: await spec.call() }), call: async () => {
    requests++; active++; peakActive = Math.max(active, peakActive);
    await wait(40); active--;
    return '{"digest":"已完成新的商业航天试验。"}';
  } });
  assert.equal(result.digested, 3);
  return { elapsedMs: Math.round(performance.now() - started), peakActive, requests,
    output: db.prepare('SELECT id,digest,digest_size FROM clusters ORDER BY id').all() };
}
function translationSample(ref) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-translation-overlap-'));
  try {
    const child = spawnSync(process.execPath, [path.join(root, 'test/helpers/pipeline-stub-child.js'), 'translation-overlap', ...(ref ? [ref] : [])], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: data, STAR_PICKING_PAVILION_AI_API_KEY: 'fixture-local-only' }
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.analyzed, 11);
    return result;
  } finally { assert.equal(path.dirname(path.resolve(data)), path.resolve(os.tmpdir())); fs.rmSync(data, { recursive: true, force: true }); }
}
async function main() {
  const output = { baselineRef, baselineCommit, rounds, fixture: 'four 40ms image downloads; six digest candidates capped at three 40ms calls; 200ms overseas translation with 15ms domestic model calls',
    images: { baseline: [], current: [] }, digests: { baseline: [], current: [] }, translation: { baseline: [], current: [] } };
  for (let i = 0; i < rounds; i++) {
    for (const [key, sample] of [['images', imageSample], ['digests', digestSample]]) {
      const before = await sample(key === 'images' ? previous.vision : previous.stories);
      const after = await sample(key === 'images' ? current.vision : current.stories);
      assert.deepEqual(after.output, before.output, `${key} outcomes identical`);
      delete before.output; delete after.output;
      output[key].baseline.push(before); output[key].current.push(after);
    }
    const before = translationSample(baselineCommit), after = translationSample();
    assert.equal(after.outcomeDigest, before.outcomeDigest, 'all eleven analyses and selection outcomes identical');
    assert.equal(after.firstWhileTranslating, true);
    output.translation.baseline.push(before); output.translation.current.push(after);
  }
  output.outcomesIdentical = true;
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  closeDatabase();
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});
