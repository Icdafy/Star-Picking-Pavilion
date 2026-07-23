'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-backoff-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { db, closeDatabase } = require('../server/db');
const { collectAll, seedSources } = require('../server/collectors');

// 拒绝连接的回环端口：立刻失败，不产生真实网络流量
let deadSourceSeq = 0;
const nextDeadUrl = () => `http://127.0.0.1:1/feed-${++deadSourceSeq}.xml`;

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

// 每个用例只留一个启用中的信源，避免真的去抓种子信源列表里的线上地址
function onlyDeadSource() {
  seedSources();
  db.exec('UPDATE sources SET enabled = 0');
  return db.prepare(`INSERT INTO sources (name, type, url, tier, domain, enabled)
    VALUES ('永久失败源', 'rss', ?, 'T2', 'aerospace', 1)`).run(nextDeadUrl()).lastInsertRowid;
}

function readSource(id) {
  return db.prepare('SELECT consecutive_errors, next_fetch_at, error_count, fetch_count FROM sources WHERE id = ?')
    .get(id);
}

test('a failing source is put on a growing backoff and skipped until it comes due', async () => {
  const id = onlyDeadSource();

  const first = await collectAll();
  assert.equal(first.results.length, 1);
  assert.ok(first.results[0].error, '不可达的信源应当报错');
  assert.equal(first.skipped, 0);

  const afterFirst = readSource(id);
  assert.equal(afterFirst.consecutive_errors, 1);
  assert.equal(afterFirst.error_count, 1);
  assert.ok(afterFirst.next_fetch_at, '失败后必须排定下次尝试时间');
  assert.ok(new Date(afterFirst.next_fetch_at).getTime() > Date.now(), '下次尝试时间应当在将来');

  // 退避期内的第二轮：完全不该发起请求
  const second = await collectAll();
  assert.equal(second.results.length, 0);
  assert.equal(second.skipped, 1);
  assert.deepEqual(readSource(id), afterFirst, '被跳过的信源不应改变任何计数');

  // 到期后恢复尝试，失败次数继续累加，退避进一步拉长
  db.prepare('UPDATE sources SET next_fetch_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), id);
  const third = await collectAll();
  assert.equal(third.results.length, 1);
  const afterThird = readSource(id);
  assert.equal(afterThird.consecutive_errors, 2);
  assert.ok(
    new Date(afterThird.next_fetch_at).getTime() - Date.now()
      > new Date(afterFirst.next_fetch_at).getTime() - Date.now(),
    '第二次连续失败的等待时间应当更长'
  );
});

test('a forced run ignores the backoff so the manual button always retries everything', async () => {
  const id = onlyDeadSource();
  await collectAll();
  const paused = readSource(id);
  assert.ok(paused.next_fetch_at);

  const skippedRun = await collectAll();
  assert.equal(skippedRun.skipped, 1);

  const forced = await collectAll(null, { force: true });
  assert.equal(forced.skipped, 0);
  assert.equal(forced.results.length, 1);
  assert.equal(readSource(id).consecutive_errors, 2);
});

test('a successful fetch clears the backoff entirely', async () => {
  const id = onlyDeadSource();
  await collectAll();
  assert.equal(readSource(id).consecutive_errors, 1);

  // 用一个真正可解析的本地 RSS 文件模拟恢复
  const feedPath = path.join(dataDir, 'recovered.xml');
  fs.writeFileSync(feedPath, `<?xml version="1.0"?><rss version="2.0"><channel><title>恢复</title>
    <item><title>恢复后的第一条情报</title><link>https://example.com/recovered</link></item>
    </channel></rss>`, 'utf8');
  const server = require('node:http').createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(fs.readFileSync(feedPath));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    db.prepare('UPDATE sources SET url = ?, next_fetch_at = NULL WHERE id = ?')
      .run(`http://127.0.0.1:${server.address().port}/feed.xml`, id);

    const recovered = await collectAll();
    assert.equal(recovered.results.length, 1);
    assert.equal(recovered.results[0].error, undefined);
    const health = readSource(id);
    assert.equal(health.consecutive_errors, 0);
    assert.equal(health.next_fetch_at, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
