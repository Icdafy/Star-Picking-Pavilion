'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function runProgram(dataDir, source) {
  return spawnSync(process.execPath, ['-e', source], {
    cwd: root,
    env: {
      ...process.env,
      STAR_PICKING_PAVILION_DATA_DIR: dataDir
    },
    encoding: 'utf8'
  });
}

test('database migration adds versioned breakthrough evidence columns', async t => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-breakthrough-db-'));
  t.after(async () => fs.promises.rm(dataDir, { recursive: true, force: true }));
  const dbPath = path.join(root, 'server', 'db.js');
  const child = runProgram(dataDir, `
    const { db, closeDatabase } = require(${JSON.stringify(dbPath)});
    const columns = db.prepare('PRAGMA table_info(articles)').all().map(row => row.name);
    process.stdout.write(JSON.stringify(columns));
    closeDatabase();
  `);

  assert.equal(child.status, 0, child.stderr);
  const columns = JSON.parse(child.stdout);
  for (const name of [
    'breakthrough_score',
    'breakthrough_bonus',
    'breakthrough_signals_json',
    'scoring_version'
  ]) {
    assert.ok(columns.includes(name), `missing ${name}`);
  }
});

test('heuristic analysis persists breakthrough evidence and cluster rescore refreshes it', async t => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-breakthrough-pipeline-'));
  t.after(async () => fs.promises.rm(dataDir, { recursive: true, force: true }));
  const dbPath = path.join(root, 'server', 'db.js');
  const pipelinePath = path.join(root, 'server', 'ai', 'pipeline.js');
  const child = runProgram(dataDir, `
    (async () => {
      const { db, closeDatabase } = require(${JSON.stringify(dbPath)});
      const { analyzePending, rescoreAfterClustering } = require(${JSON.stringify(pipelinePath)});
      const sourceId = db.prepare(\`
        INSERT INTO sources (name, type, url, tier, domain)
        VALUES ('官方试验平台', 'rss', 'https://example.com/breakthrough-feed', 'T1', 'aerospace')
      \`).run().lastInsertRowid;
      const articleId = db.prepare(\`
        INSERT INTO articles
          (source_id, title, url, summary_raw, fetched_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?)
      \`).run(
        sourceId,
        '商业航天可重复使用火箭完成回收试验',
        'https://example.com/breakthrough-article',
        '火箭发动机点火成功并完成垂直着陆回收。',
        new Date().toISOString(),
        new Date().toISOString()
      ).lastInsertRowid;
      await analyzePending(null, 10);
      const first = db.prepare(\`
        SELECT breakthrough_score, breakthrough_bonus,
               breakthrough_signals_json, scoring_version
        FROM articles WHERE id=?
      \`).get(articleId);
      const clusterId = db.prepare(\`
        INSERT INTO clusters (main_article_id, size, updated_at) VALUES (?, 3, ?)
      \`).run(articleId, new Date().toISOString()).lastInsertRowid;
      db.prepare('UPDATE articles SET cluster_id=? WHERE id=?').run(clusterId, articleId);
      const rescore = rescoreAfterClustering();
      const second = db.prepare(\`
        SELECT breakthrough_score, breakthrough_bonus,
               breakthrough_signals_json, scoring_version
        FROM articles WHERE id=?
      \`).get(articleId);
      process.stdout.write(JSON.stringify({ first, second, rescore }));
      closeDatabase();
    })().catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  `);

  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.ok(result.first.breakthrough_score > 0);
  assert.ok(result.first.breakthrough_bonus > 0);
  assert.equal(result.first.scoring_version, 1);
  assert.equal(JSON.parse(result.first.breakthrough_signals_json).rejectedReason, null);
  assert.ok(result.second.breakthrough_score >= result.first.breakthrough_score);
  assert.ok(result.second.breakthrough_bonus >= result.first.breakthrough_bonus);
  assert.equal(result.rescore.rescored, 1);
});
