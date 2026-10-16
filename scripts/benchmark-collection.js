'use strict';

// Deterministic network fixtures, isolated temporary SQLite/config, no external requests or API keys.
// The baseline loads immutable collector/repair source with the same installed dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const baselineRef = args.find(arg => arg.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length) || 'b27daa2';
const rounds = Number(args.find(arg => arg.startsWith('--rounds='))?.slice('--rounds='.length) || 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10 || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(baselineRef)
  || args.some(arg => !arg.startsWith('--baseline-ref=') && !arg.startsWith('--rounds='))) {
  throw new Error('Usage: node scripts/benchmark-collection.js [--rounds=1..10] [--baseline-ref=b27daa2]');
}
const baselineCommit = execFileSync('git', ['rev-parse', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-collection-benchmark-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase } = require('../server/db');
const currentCollection = require('../server/collectors');
const currentRepair = require('../server/publication-time');
const rss = require('../server/collectors/rss');
const originalFetch = rss.fetch;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function baselineModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = execFileSync('git', ['show', `${baselineCommit}:${relativePath}`], { cwd: root, encoding: 'utf8' });
  const baseline = new Module(filename, module);
  baseline.filename = filename;
  baseline.paths = Module._nodeModulePaths(path.dirname(filename));
  baseline._compile(source, filename);
  return baseline.exports;
}

async function collectionRound(collectAll) {
  db.exec('DELETE FROM articles');
  let bodyRequests = 0, firstMs = null;
  const start = performance.now();
  const result = await collectAll(progress => {
    if (progress.added > 0 && firstMs === null) firstMs = performance.now() - start;
  }, {
    force: true,
    network: { detect: async () => { await wait(300); return { available: true }; }, snapshot: () => ({ available: true }) },
    enrich: async () => {
      bodyRequests++;
      await wait(30);
      return { status: 'ok', text: '商业航天发动机试验完成。', publishedAt: new Date().toISOString() };
    }
  });
  return { firstMs: Math.round(firstMs), totalMs: Math.round(performance.now() - start), bodyRequests,
    sources: result.results.length, fetched: result.results.reduce((sum, row) => sum + row.fetched, 0),
    articles: db.prepare('SELECT COUNT(*) n FROM articles').get().n };
}

function repairFixture() {
  const fixture = new DatabaseSync(':memory:');
  fixture.exec(`CREATE TABLE sources(id INTEGER PRIMARY KEY,intl INTEGER,enabled INTEGER,removed_at TEXT,type TEXT,tier TEXT);
    INSERT INTO sources VALUES(1,0,1,NULL,'rss','T1');
    CREATE TABLE articles(id INTEGER PRIMARY KEY,source_id INTEGER,published_at TEXT,
      relevant INTEGER DEFAULT 1,starred INTEGER DEFAULT 0,featured INTEGER DEFAULT 0,publication_checked_at TEXT,
      fetched_at TEXT,imported_backfill INTEGER DEFAULT 0,historical INTEGER DEFAULT 0,publication_precision TEXT,publication_date_text TEXT);
    CREATE TABLE story_signals(article_id INTEGER,observed_at TEXT);`);
  for (let id = 1; id <= 10; id++) fixture.prepare('INSERT INTO articles(id,source_id,fetched_at) VALUES(?,1,?)').run(id, new Date().toISOString());
  return fixture;
}

async function repairRound(repair) {
  const fixture = repairFixture();
  let active = 0, maxActive = 0;
  try {
    const start = performance.now();
    const result = await repair(fixture, { enrich: async row => {
      active++; maxActive = Math.max(maxActive, active);
      await wait(40);
      active--;
      return { status: 'ok', publishedAt: row.fetched_at };
    } });
    return { totalMs: Math.round(performance.now() - start), maxActive, ...result };
  } finally { fixture.close(); }
}

function comparison(baseline, optimized, keys) {
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return Object.fromEntries(keys.map(key => {
    const before = median(baseline.map(row => row[key]));
    const after = median(optimized.map(row => row[key]));
    return [key, { baseline: before, optimized: after, changePercent: Math.round((after / before - 1) * 1000) / 10 }];
  }));
}

async function main() {
  try {
    const baselineCollection = baselineModule('server/collectors/index.js');
    const baselineRepair = baselineModule('server/publication-time.js');
    // Keep stdout as one machine-readable JSON document.
    const log = console.log;
    console.log = (...values) => console.error(...values);
    try { currentCollection.seedSources(); } finally { console.log = log; }
    db.exec('UPDATE sources SET enabled=0');
    for (let i = 0; i < 201; i++) db.prepare(`INSERT INTO sources(name,type,url,tier,domain,intl)
      VALUES(?,'rss',?,'T1','aerospace',?)`).run(`benchmark-${i}`, `https://example.test/bench-${i}`, i >= 160 ? 1 : 0);
    rss.fetch = async source => {
      await wait(20);
      const index = Number(source.name.slice('benchmark-'.length));
      return [0, 1].map(article => ({ title: '商业航天火箭完成发动机地面试验',
        url: `https://example.test/bench-article-${Math.floor(index / 4)}-${article}?utm_source=${index}` }));
    };
    const collection = { baseline: [], optimized: [] };
    const publicationRepair = { baseline: [], optimized: [] };
    for (let i = 0; i < rounds; i++) {
      collection.baseline.push(await collectionRound(baselineCollection.collectAll));
      collection.optimized.push(await collectionRound(currentCollection.collectAll));
      publicationRepair.baseline.push(await repairRound(baselineRepair.repairPublicationTimes));
      publicationRepair.optimized.push(await repairRound(currentRepair.repairPublicationTimes));
    }
    for (const round of [...collection.baseline, ...collection.optimized]) {
      if (round.sources !== 201 || round.fetched !== 402 || round.articles !== 102) throw new Error('Collection benchmark lost source or article coverage');
    }
    for (const round of [...publicationRepair.baseline, ...publicationRepair.optimized]) {
      if (round.attempted !== 10 || round.repaired !== 10) throw new Error('Publication repair benchmark lost coverage');
    }
    console.log(JSON.stringify({ baselineCommit, rounds,
      methodology: 'Synthetic network delays; original collector/repair source with shared current dependencies; no external network or model calls. Timings are not production guarantees.',
      fixture: { enabledSources: 201, domesticSources: 160, internationalSources: 41, rawItems: 402, uniqueArticles: 102,
        listDelayMs: 20, bodyDelayMs: 30, networkProbeDelayMs: 300, historicalRepairRows: 10, repairDelayMs: 40 },
      collection: { ...collection, medians: comparison(collection.baseline, collection.optimized, ['firstMs', 'totalMs', 'bodyRequests']) },
      publicationRepair: { ...publicationRepair, medians: comparison(publicationRepair.baseline, publicationRepair.optimized, ['totalMs']) }
    }, null, 2));
  } finally {
    rss.fetch = originalFetch;
    closeDatabase();
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('spp-collection-benchmark-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
