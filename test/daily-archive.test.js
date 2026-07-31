'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_DAILY_ARCHIVE_STATE,
  createDailyArchiveService,
  enumerateDueDates,
  mostRecentDueDate,
  nextRunAt
} = require('../electron/daily-archive');

async function makeDirectory(t, prefix = 'spp-daily-archive-') {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

function sampleBundle(date) {
  return {
    date,
    markdown: [
      `# 摘星阁新闻简报 · ${date}`,
      '',
      '## 今日焦点',
      '',
      '- 可重复验证的技术突破。'
    ].join('\n'),
    jsonl: `${JSON.stringify({
      schemaVersion: 1,
      date,
      title: '可重复验证的技术突破',
      url: 'https://example.com/research'
    })}\n`,
    manifest: {
      schemaVersion: 1,
      productVersion: '0.0.13',
      generatedAt: `${date}T08:00:00+08:00`,
      window: {
        start: `${date}T08:00:00+08:00`,
        end: `${date}T08:00:00+08:00`,
        basis: 'fetched_at',
        startInclusive: false,
        endInclusive: true
      },
      summary: {
        total: 1,
        relevant: 1,
        featured: 1,
        pending: 0,
        irrelevant: 0,
        breakthroughs: 1,
        byDomain: { low_altitude: 1, aerospace: 0 }
      }
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stateFile(userDataPath) {
  return path.join(userDataPath, 'daily-archive.json');
}

function archiveDirectory(rootDirectory, date, suffix = date) {
  const [year, month] = date.split('-');
  return path.join(rootDirectory, '摘星阁新闻简报', year, month, suffix);
}

test('date helpers align to the local 08:00 boundary instead of a fixed 24-hour interval', () => {
  const beforeCutoff = new Date(2026, 6, 31, 7, 59, 59);
  const atCutoff = new Date(2026, 6, 31, 8, 0, 0);
  const afterCutoff = new Date(2026, 6, 31, 18, 30, 0);

  assert.equal(mostRecentDueDate(beforeCutoff), '2026-07-30');
  assert.equal(mostRecentDueDate(atCutoff), '2026-07-31');
  assert.equal(mostRecentDueDate(afterCutoff), '2026-07-31');

  const beforeNext = nextRunAt(beforeCutoff);
  assert.deepEqual(
    [
      beforeNext.getFullYear(),
      beforeNext.getMonth(),
      beforeNext.getDate(),
      beforeNext.getHours(),
      beforeNext.getMinutes()
    ],
    [2026, 6, 31, 8, 0]
  );

  const afterNext = nextRunAt(afterCutoff);
  assert.deepEqual(
    [
      afterNext.getFullYear(),
      afterNext.getMonth(),
      afterNext.getDate(),
      afterNext.getHours(),
      afterNext.getMinutes()
    ],
    [2026, 7, 1, 8, 0]
  );
});

test('due dates begin at the first 08:00 after enabling and continue after the last success', () => {
  const now = new Date(2026, 6, 31, 10, 0, 0);

  assert.deepEqual(enumerateDueDates({
    ...DEFAULT_DAILY_ARCHIVE_STATE,
    enabled: true,
    enabledAt: new Date(2026, 6, 28, 9, 0, 0).toISOString()
  }, now), ['2026-07-29', '2026-07-30', '2026-07-31']);

  assert.deepEqual(enumerateDueDates({
    ...DEFAULT_DAILY_ARCHIVE_STATE,
    enabled: true,
    enabledAt: new Date(2026, 6, 28, 7, 0, 0).toISOString()
  }, now), ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']);

  assert.deepEqual(enumerateDueDates({
    ...DEFAULT_DAILY_ARCHIVE_STATE,
    enabled: true,
    enabledAt: new Date(2026, 6, 28, 7, 0, 0).toISOString(),
    lastSuccessfulDate: '2026-07-29'
  }, now), ['2026-07-30', '2026-07-31']);
});

test('missing and corrupt state load as disabled defaults without rewriting user data', async t => {
  const userDataPath = await makeDirectory(t);
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date)
  });

  assert.deepEqual(await service.start(), {
    ...DEFAULT_DAILY_ARCHIVE_STATE,
    runningDate: null,
    nextRunAt: null,
    pendingDates: [],
    lastResult: null
  });
  service.stop();
  await assert.rejects(fs.promises.access(stateFile(userDataPath)), { code: 'ENOENT' });

  const corrupt = '{ definitely not valid JSON';
  await fs.promises.writeFile(stateFile(userDataPath), corrupt);
  const reloaded = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date)
  });
  assert.equal((await reloaded.start()).enabled, false);
  reloaded.stop();
  assert.equal(await fs.promises.readFile(stateFile(userDataPath), 'utf8'), corrupt);
});

test('enable validates the root and persists versioned state with an atomic sibling rename', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => new Date(2026, 6, 31, 7, 30, 0)
  });

  await service.enable(rootDirectory);

  const stored = JSON.parse(await fs.promises.readFile(stateFile(userDataPath), 'utf8'));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.enabled, true);
  assert.equal(stored.rootDirectory, await fs.promises.realpath(rootDirectory));
  assert.equal(stored.enabledAt, new Date(2026, 6, 31, 7, 30, 0).toISOString());
  assert.equal(stored.lastSuccessfulDate, null);
  assert.equal(stored.lastErrorCode, null);
  assert.deepEqual(
    (await fs.promises.readdir(userDataPath)).filter(name => name.endsWith('.tmp')),
    []
  );
});

test('failed enable or disable persistence restores the last confirmed switch state', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  let failNextStateRename = true;
  const fileSystem = Object.create(fs.promises);
  fileSystem.rename = async (source, destination) => {
    if (failNextStateRename && destination === stateFile(userDataPath)) {
      failNextStateRename = false;
      throw Object.assign(new Error('state rename failed'), { code: 'EACCES' });
    }
    return fs.promises.rename(source, destination);
  };
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => new Date(2026, 6, 31, 7, 30, 0),
    fileSystem
  });

  await assert.rejects(service.enable(rootDirectory), /state rename failed/);
  assert.equal(service.getSnapshot().enabled, false);
  assert.equal(service.getSnapshot().rootDirectory, '');

  await service.enable(rootDirectory);
  assert.equal(service.getSnapshot().enabled, true);
  failNextStateRename = true;

  await assert.rejects(service.disable(), /state rename failed/);
  assert.equal(service.getSnapshot().enabled, true);
  assert.equal(service.getSnapshot().rootDirectory, await fs.promises.realpath(rootDirectory));
  assert.equal(
    JSON.parse(await fs.promises.readFile(stateFile(userDataPath), 'utf8')).enabled,
    true
  );
});

test('saveCurrent writes a complete date directory and a verifiable manifest', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const now = new Date(2026, 6, 31, 10, 0, 0);
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => now
  });
  await service.enable(rootDirectory);

  const result = await service.saveCurrent();
  const destination = archiveDirectory(await fs.promises.realpath(rootDirectory), '2026-07-31');
  const markdown = await fs.promises.readFile(path.join(destination, '新闻简报.md'), 'utf8');
  const jsonl = await fs.promises.readFile(path.join(destination, 'news.jsonl'), 'utf8');
  const manifest = JSON.parse(
    await fs.promises.readFile(path.join(destination, 'manifest.json'), 'utf8')
  );

  assert.equal(result.status, 'saved');
  assert.equal(result.date, '2026-07-31');
  assert.equal(result.directory, destination);
  assert.equal(manifest.archiveSchemaVersion, 1);
  assert.equal(manifest.date, '2026-07-31');
  assert.equal(manifest.files['新闻简报.md'].sha256, sha256(markdown));
  assert.equal(manifest.files['新闻简报.md'].bytes, Buffer.byteLength(markdown));
  assert.equal(manifest.files['news.jsonl'].sha256, sha256(jsonl));
  assert.equal(manifest.files['news.jsonl'].bytes, Buffer.byteLength(jsonl));
  assert.equal(service.getSnapshot().lastSuccessfulDate, '2026-07-31');
  assert.deepEqual(
    (await fs.promises.readdir(path.dirname(destination))).filter(name => name.includes('.partial-')),
    []
  );
});

test('archive files are flushed before the date directory is atomically committed', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const writes = [];
  const fileSystem = Object.create(fs.promises);
  fileSystem.writeFile = async (candidate, contents, options) => {
    writes.push({ name: path.basename(candidate), options });
    return fs.promises.writeFile(candidate, contents, options);
  };
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => new Date(2026, 6, 31, 10, 0, 0),
    fileSystem
  });

  await service.enable(rootDirectory);
  await service.saveCurrent();

  for (const name of ['新闻简报.md', 'news.jsonl', 'manifest.json']) {
    const write = writes.find(entry => entry.name === name);
    assert.equal(write?.options?.flush, true, name);
  }
});

test('a valid existing archive is verified and skipped without requesting the bundle again', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const now = new Date(2026, 6, 31, 10, 0, 0);
  let calls = 0;
  const first = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      calls += 1;
      return sampleBundle(date);
    },
    now: () => now
  });
  await first.enable(rootDirectory);
  await first.saveCurrent();

  const second = createDailyArchiveService({
    userDataPath: await makeDirectory(t),
    requestBundle: async () => {
      calls += 1;
      throw new Error('requestBundle must not run for a complete archive');
    },
    now: () => now
  });
  await second.enable(rootDirectory);
  const result = await second.saveCurrent();

  assert.equal(result.status, 'existing');
  assert.equal(calls, 1);
  assert.equal(second.getSnapshot().lastSuccessfulDate, '2026-07-31');
});

test('an incomplete target remains untouched and the replacement is saved to a conflict directory', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const destination = archiveDirectory(rootDirectory, '2026-07-31');
  await fs.promises.mkdir(destination, { recursive: true });
  await fs.promises.writeFile(path.join(destination, 'keep-me.txt'), 'original');

  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => new Date(2026, 6, 31, 10, 11, 12)
  });
  await service.enable(rootDirectory);
  const result = await service.saveCurrent();

  assert.equal(result.status, 'saved-conflict');
  assert.match(path.basename(result.directory), /^2026-07-31-补存-101112(?:-\d+)?$/);
  assert.equal(await fs.promises.readFile(path.join(destination, 'keep-me.txt'), 'utf8'), 'original');
  await fs.promises.access(path.join(result.directory, '新闻简报.md'));
  await fs.promises.access(path.join(result.directory, 'news.jsonl'));
  await fs.promises.access(path.join(result.directory, 'manifest.json'));
});

test('a verified conflict archive is reused instead of creating repeated recovery copies', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const destination = archiveDirectory(rootDirectory, '2026-07-31');
  await fs.promises.mkdir(destination, { recursive: true });
  await fs.promises.writeFile(path.join(destination, 'keep-me.txt'), 'original');
  let requests = 0;
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests += 1;
      return sampleBundle(date);
    },
    now: () => new Date(2026, 6, 31, 10, 11, 12)
  });
  await service.enable(rootDirectory);

  const first = await service.saveCurrent();
  const second = await service.saveCurrent();

  assert.equal(first.status, 'saved-conflict');
  assert.equal(second.status, 'existing');
  assert.equal(second.directory, first.directory);
  assert.equal(requests, 1);
});

test('startup rotates a one-day integrity audit across older successful archives', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  let current = new Date(2026, 6, 30, 7, 0, 0);
  const seed = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => current
  });
  await seed.enable(rootDirectory);
  current = new Date(2026, 6, 31, 10, 0, 0);
  await seed.retry();
  seed.stop();
  await fs.promises.writeFile(
    path.join(archiveDirectory(rootDirectory, '2026-07-30'), '新闻简报.md'),
    'tampered historical archive'
  );

  const requests = [];
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests.push(date);
      return sampleBundle(date);
    },
    now: () => current
  });

  const snapshot = await service.start();
  service.stop();

  assert.deepEqual(requests, ['2026-07-30']);
  assert.equal(snapshot.lastSuccessfulDate, '2026-07-31');
  assert.equal(snapshot.lastIntegrityCheckDate, '2026-07-30');
  await fs.promises.access(path.join(
    path.dirname(archiveDirectory(rootDirectory, '2026-07-30')),
    path.basename(archiveDirectory(rootDirectory, '2026-07-30')) + '-补存-100000',
    'manifest.json'
  ));

  requests.length = 0;
  const next = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests.push(date);
      return sampleBundle(date);
    },
    now: () => current
  });
  const nextSnapshot = await next.start();
  next.stop();

  assert.deepEqual(requests, []);
  assert.equal(nextSnapshot.lastSuccessfulDate, '2026-07-31');
  assert.equal(nextSnapshot.lastIntegrityCheckDate, '2026-07-31');
});

test('catch-up requests every missed date in order and advances success one date at a time', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const requests = [];
  await fs.promises.writeFile(stateFile(userDataPath), `${JSON.stringify({
    ...DEFAULT_DAILY_ARCHIVE_STATE,
    enabled: true,
    rootDirectory,
    enabledAt: new Date(2026, 6, 28, 9, 0, 0).toISOString()
  })}\n`);

  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests.push(date);
      return sampleBundle(date);
    },
    now: () => new Date(2026, 6, 31, 10, 0, 0)
  });

  const snapshot = await service.start();
  service.stop();

  assert.deepEqual(requests, ['2026-07-29', '2026-07-30', '2026-07-31']);
  assert.equal(snapshot.lastSuccessfulDate, '2026-07-31');
  for (const date of requests) {
    await fs.promises.access(path.join(archiveDirectory(rootDirectory, date), 'manifest.json'));
  }
});

test('background startup returns a loaded snapshot before catch-up finishes', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  await fs.promises.writeFile(stateFile(userDataPath), `${JSON.stringify({
    ...DEFAULT_DAILY_ARCHIVE_STATE,
    enabled: true,
    rootDirectory,
    enabledAt: new Date(2026, 6, 31, 7, 0, 0).toISOString()
  })}\n`);
  const gate = deferred();
  const requested = deferred();
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requested.resolve(date);
      await gate.promise;
      return sampleBundle(date);
    },
    now: () => new Date(2026, 6, 31, 10, 0, 0)
  });

  const snapshot = await service.start({ backgroundCatchUp: true });

  assert.equal(snapshot.enabled, true);
  assert.deepEqual(snapshot.pendingDates, ['2026-07-31']);
  assert.equal(await requested.promise, '2026-07-31');
  assert.equal(service.getSnapshot().lastSuccessfulDate, null);

  gate.resolve();
  await service.retry();
  assert.equal(service.getSnapshot().lastSuccessfulDate, '2026-07-31');
  service.stop();
});

test('concurrent saves for the same date share one in-flight bundle request', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  let requests = 0;
  let release;
  let markRequestStarted;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const requestStarted = new Promise(resolve => {
    markRequestStarted = resolve;
  });
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests += 1;
      markRequestStarted();
      await gate;
      return sampleBundle(date);
    },
    now: () => new Date(2026, 6, 31, 10, 0, 0)
  });
  await service.enable(rootDirectory);

  const first = service.saveCurrent();
  const second = service.saveCurrent();
  await requestStarted;
  assert.equal(requests, 1);

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, secondResult);
  assert.equal(requests, 1);
});

test('a missing root records a retryable error without advancing the successful date', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  let current = new Date(2026, 6, 31, 7, 0, 0);
  let requests = 0;
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests += 1;
      return sampleBundle(date);
    },
    now: () => current
  });
  await service.enable(rootDirectory);
  current = new Date(2026, 6, 31, 10, 0, 0);
  await fs.promises.rm(rootDirectory, { recursive: true });

  await assert.rejects(service.retry(), error => error?.code === 'directory-unavailable');
  assert.equal(service.getSnapshot().lastSuccessfulDate, null);
  assert.equal(service.getSnapshot().lastErrorCode, 'directory-unavailable');
  assert.equal(requests, 0);

  await fs.promises.mkdir(rootDirectory, { recursive: true });
  const results = await service.retry();
  assert.deepEqual(results.map(result => result.date), ['2026-07-31']);
  assert.equal(service.getSnapshot().lastSuccessfulDate, '2026-07-31');
  assert.equal(service.getSnapshot().lastErrorCode, null);
});

test('failed bundle generation cleans staging data and can be retried without a false success', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  let attempts = 0;
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      attempts += 1;
      if (attempts === 1) throw new Error('server temporarily unavailable');
      return sampleBundle(date);
    },
    now: () => new Date(2026, 6, 31, 10, 0, 0)
  });
  await service.enable(rootDirectory);

  await assert.rejects(service.saveCurrent(), /server temporarily unavailable/);
  assert.equal(service.getSnapshot().lastSuccessfulDate, null);
  assert.equal(service.getSnapshot().lastErrorCode, 'bundle-unavailable');
  const monthDirectory = path.dirname(archiveDirectory(rootDirectory, '2026-07-31'));
  const entries = await fs.promises.readdir(monthDirectory).catch(() => []);
  assert.deepEqual(entries.filter(name => name.includes('.partial-')), []);

  const result = await service.saveCurrent();
  assert.equal(result.status, 'saved');
  assert.equal(service.getSnapshot().lastSuccessfulDate, '2026-07-31');
});

test('enabled service schedules exactly the next local 08:00 and reschedules after resume', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const delays = [];
  const cleared = [];
  let timerId = 0;
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => sampleBundle(date),
    now: () => new Date(2026, 6, 31, 7, 59, 0),
    setTimer: (_callback, delay) => {
      delays.push(delay);
      timerId += 1;
      return timerId;
    },
    clearTimer: id => cleared.push(id)
  });
  await service.enable(rootDirectory);
  await service.start();

  assert.deepEqual(delays, [60_000]);
  assert.equal(service.getSnapshot().nextRunAt, new Date(2026, 6, 31, 8, 0, 0).toISOString());

  await service.handleResume();
  assert.deepEqual(cleared, [1]);
  assert.deepEqual(delays, [60_000, 60_000]);
  service.stop();
  assert.deepEqual(cleared, [1, 2]);
});

test('schedule refresh ignores normal passage and catches up after a clock jump over 08:00', async t => {
  const userDataPath = await makeDirectory(t);
  const rootDirectory = await makeDirectory(t, 'spp-daily-root-');
  const delays = [];
  const cleared = [];
  let timerId = 0;
  let current = new Date(2026, 6, 31, 7, 0, 0);
  let monotonic = 1_000;
  let timeZone = 'Asia/Shanghai';
  const requests = [];
  const service = createDailyArchiveService({
    userDataPath,
    requestBundle: async date => {
      requests.push(date);
      return sampleBundle(date);
    },
    now: () => current,
    monotonicNow: () => monotonic,
    getTimeZone: () => timeZone,
    setTimer: (_callback, delay) => {
      delays.push(delay);
      timerId += 1;
      return timerId;
    },
    clearTimer: id => cleared.push(id)
  });
  await service.enable(rootDirectory);
  await service.start();
  assert.deepEqual(delays, [3_600_000]);

  assert.equal(await service.refreshSchedule(), false);
  assert.deepEqual(delays, [3_600_000]);

  current = new Date(2026, 6, 31, 7, 30, 0);
  monotonic += 30 * 60 * 1_000;
  assert.equal(await service.refreshSchedule(), false);
  assert.deepEqual(cleared, []);
  assert.deepEqual(delays, [3_600_000]);

  current = new Date(2026, 6, 31, 9, 0, 0);
  assert.equal(await service.refreshSchedule(), true);
  assert.deepEqual(cleared, [1]);
  assert.deepEqual(delays, [3_600_000, 23 * 3_600_000]);
  assert.deepEqual(requests, ['2026-07-31']);

  timeZone = 'Asia/Tokyo';
  assert.equal(await service.refreshSchedule(), true);
  assert.deepEqual(cleared, [1, 2]);
  assert.deepEqual(delays, [3_600_000, 23 * 3_600_000, 23 * 3_600_000]);
  service.stop();
});
