'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..', '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');
const DUMMY_API_KEY = 'sk-e2e-dummy-secret';
const PREFILTER_MODEL = 'deepseek-v4-flash';
const SCORING_MODEL = 'deepseek-v4-pro';
const TEST_ARTICLE_TITLE = 'E2E 政策法规持久化测试文章';
const MAX_GRACEFUL_CLOSE_MS = 4_000;
const EXPECTED_UI_PREFERENCE_KEYS = [
  'category',
  'commonLinksFavorites',
  'dailyDate',
  'domain',
  'linksCategory',
  'realtime',
  'theme',
  'version',
  'view'
];

async function waitForExit(child, timeoutMs = 10_000, description = 'Electron process') {
  if (child.exitCode !== null || child.signalCode !== null) {
    return [child.exitCode, child.signalCode];
  }
  let timer;
  try {
    return await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} did not exit`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeElectronGracefully(app, child, description) {
  const startedAt = Date.now();
  await app.close();
  await waitForExit(child, MAX_GRACEFUL_CLOSE_MS, description);
  const elapsedMs = Date.now() - startedAt;
  assert.ok(
    elapsedMs < MAX_GRACEFUL_CLOSE_MS,
    `${description} took ${elapsedMs} ms; graceful shutdown must beat the 5 s force-kill fallback`
  );
  return elapsedMs;
}

function listen(server, options) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options);
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('mock request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function waitForJson(file, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (predicate(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for persisted JSON${lastError ? ` (${lastError.code || lastError.name})` : ''}`
  );
}

function isNonEmptyBase64(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === value;
}

function assertDoesNotContainSecret(serialized) {
  assert.equal(serialized.includes(DUMMY_API_KEY), false);
}

async function assertPersistedFiles(dataDir, expected) {
  const settingsFile = path.join(dataDir, 'settings.json');
  const credentialsFile = path.join(dataDir, 'credentials.v1.json');
  const preferencesFile = path.join(dataDir, 'ui-preferences.json');
  const [settingsRaw, credentialsRaw, preferencesRaw] = await Promise.all([
    fs.promises.readFile(settingsFile, 'utf8'),
    fs.promises.readFile(credentialsFile, 'utf8'),
    fs.promises.readFile(preferencesFile, 'utf8')
  ]);

  for (const serialized of [settingsRaw, credentialsRaw, preferencesRaw]) {
    assertDoesNotContainSecret(serialized);
  }

  const settings = JSON.parse(settingsRaw);
  assert.equal(settings.ai.baseUrl, expected.baseUrl);
  assert.equal(settings.ai.prefilterModel, PREFILTER_MODEL);
  assert.equal(settings.ai.scoringModel, SCORING_MODEL);
  assert.equal(Object.hasOwn(settings.ai, 'apiKey'), false);

  const credentials = JSON.parse(credentialsRaw);
  assert.deepEqual(Object.keys(credentials).sort(), ['ciphertext', 'version']);
  assert.equal(credentials.version, 1);
  assert.equal(isNonEmptyBase64(credentials.ciphertext), true);

  const preferences = JSON.parse(preferencesRaw);
  assert.deepEqual(Object.keys(preferences).sort(), EXPECTED_UI_PREFERENCE_KEYS);
  assert.equal(preferences.version, 1);
  if (expected.preferences) {
    for (const [key, value] of Object.entries(expected.preferences)) {
      assert.deepEqual(preferences[key], value);
    }
  }
  return preferences;
}

function insertTestArticle(dataDir) {
  const database = new DatabaseSync(path.join(dataDir, 'star-picking-pavilion.db'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    const source = database.prepare('SELECT id FROM sources ORDER BY id LIMIT 1').get();
    assert.ok(source);
    const unique = `${process.pid}-${Date.now()}`;
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO articles
        (source_id, title, url, summary_raw, published_at, fetched_at, domain,
         category, relevant, analyzed, quality_score, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 92, 1)
    `).run(
      source.id,
      TEST_ARTICLE_TITLE,
      `https://example.invalid/e2e-policy-${unique}`,
      '仅用于真实 Electron E2E 的临时文章',
      timestamp,
      timestamp,
      'lowaltitude',
      '政策法规'
    );
  } finally {
    database.close();
  }
}

async function waitForTwoAnimationFrames(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

test('real Electron desktop flow is secure, persistent across restart and single-instance', { timeout: 120_000 }, async t => {
  assert.match(mainSource, /STAR_PICKING_PAVILION_TEST_DATA_DIR/);

  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-electron-e2e-'));
  const mockCalls = [];
  let firstApp;
  let secondApp;
  let singleInstanceProcess;
  let mockServer;
  let portBlocker;
  let firstCloseMs;
  let secondCloseMs;

  t.after(async () => {
    if (singleInstanceProcess && singleInstanceProcess.exitCode === null) {
      singleInstanceProcess.kill();
      await waitForExit(singleInstanceProcess, 5_000, 'single-instance probe').catch(() => {});
    }
    if (secondApp) await secondApp.close().catch(() => {});
    if (firstApp) await firstApp.close().catch(() => {});
    await closeServer(portBlocker);
    await closeServer(mockServer);
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  await fs.promises.copyFile(
    path.join(__dirname, 'fixtures', 'empty-settings.json'),
    path.join(dataDir, 'settings.json')
  );

  mockServer = http.createServer(async (request, response) => {
    let body;
    try {
      body = await readRequestJson(request);
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid request' }));
      return;
    }
    mockCalls.push({
      path: request.url,
      model: typeof body?.model === 'string' ? body.model : null,
      authorized: request.headers.authorization === `Bearer ${DUMMY_API_KEY}`
    });
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }]
    }));
  });
  const mockAddress = await listen(mockServer, { host: '127.0.0.1', port: 0 });
  const mockBaseUrl = `http://127.0.0.1:${mockAddress.port}`;
  const env = {
    ...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR: dataDir,
    STAR_PICKING_PAVILION_NO_SCHEDULER: '1',
    STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1'
  };

  firstApp = await electron.launch({ args: ['.'], cwd: projectRoot, env });
  const firstProcess = firstApp.process();
  const firstPage = await firstApp.firstWindow();
  await firstPage.waitForSelector('#feedList');

  assert.equal(await firstPage.title(), '摘星阁 · 低空经济与商业航天情报站');
  const firstOrigin = await firstPage.evaluate(() => location.origin);
  const firstUrl = new URL(firstOrigin);
  const firstPort = Number(firstUrl.port);
  assert.equal(firstUrl.hostname, '127.0.0.1');
  assert.notEqual(firstPort, 7644);
  assert.ok(firstPort > 0);
  assert.equal(await firstApp.evaluate(({ app }) => app.getPath('userData')), dataDir);

  const unauthenticated = await fetch(`${firstOrigin}/api/stats`);
  assert.equal(unauthenticated.status, 403);

  insertTestArticle(dataDir);
  await firstPage.reload();
  await firstPage.locator('.card-title', { hasText: TEST_ARTICLE_TITLE }).waitFor();

  await firstPage.locator('#btnTheme').click();
  await firstPage.waitForFunction(() => document.documentElement.dataset.theme === 'light');

  const lowAltitudePill = firstPage.locator('.pill[data-domain="lowaltitude"]');
  await lowAltitudePill.click();
  await firstPage.waitForFunction(() => (
    document.querySelector('.pill[data-domain="lowaltitude"]')?.getAttribute('aria-pressed') === 'true'
  ));

  const policyChip = firstPage.locator('.chip[data-cat="政策法规"]');
  await policyChip.click();
  await firstPage.waitForFunction(() => (
    document.querySelector('.chip[data-cat="政策法规"]')?.getAttribute('aria-pressed') === 'true'
  ));
  await firstPage.locator('.card-title', { hasText: TEST_ARTICLE_TITLE }).waitFor();

  await firstPage.locator('.tab[data-view="daily"]').click();
  await firstPage.waitForFunction(() => /^\d{4} \/ \d{2} \/ \d{2}$/.test(
    document.querySelector('#dailyDate')?.textContent || ''
  ));
  const initialDailyDate = await firstPage.locator('#dailyDate').textContent();
  await firstPage.locator('#dailyPrev').click();
  await firstPage.waitForFunction(previous => {
    const current = document.querySelector('#dailyDate')?.textContent || '';
    return /^\d{4} \/ \d{2} \/ \d{2}$/.test(current) && current !== previous;
  }, initialDailyDate);
  const savedDailyDate = (await firstPage.locator('#dailyDate').textContent())
    .replaceAll(' ', '')
    .replaceAll('/', '-');
  assert.match(savedDailyDate, /^\d{4}-\d{2}-\d{2}$/);

  await firstPage.locator('.tab[data-view="links"]').click();
  assert.equal(await firstPage.locator('.common-links-card').count(), 14);

  const aiCategory = firstPage.locator('.common-links-category[data-links-category="AI"]');
  const expectedFocusKey = await aiCategory.getAttribute('data-focus-key');
  await aiCategory.focus();
  await aiCategory.click();
  assert.equal(
    await firstPage.evaluate(() => document.activeElement?.dataset.focusKey),
    expectedFocusKey
  );

  const favorite = firstPage.locator('button[data-link-favorite="kimi-ai"]');
  const priorFavoriteState = await favorite.getAttribute('aria-pressed');
  await favorite.click();
  const expectedFavoriteState = priorFavoriteState === 'true' ? 'false' : 'true';
  assert.equal(await favorite.getAttribute('aria-pressed'), expectedFavoriteState);

  await firstPage.locator('#btnRealtime').click();
  assert.equal(await firstPage.locator('#btnRealtime').getAttribute('aria-pressed'), 'false');

  await firstPage.locator('.tab[data-view="settings"]').click();
  await firstPage.locator('#setBaseUrl').fill(mockBaseUrl);
  await firstPage.locator('#setApiKey').fill(DUMMY_API_KEY);
  await firstPage.locator('#setPrefilterModel').fill(PREFILTER_MODEL);
  await firstPage.locator('#setScoringModel').fill(SCORING_MODEL);

  const saveStartedAt = Date.now();
  await firstPage.locator('#btnSaveAi').click();
  await firstPage.waitForFunction(() => {
    const input = document.querySelector('#setApiKey');
    const toast = document.querySelector('#toast');
    return input?.dataset.hasStoredKey === 'true'
      && toast?.classList.contains('show')
      && toast.textContent.includes('AI 配置已保存');
  }, undefined, { timeout: 4_800 });
  assert.ok(Date.now() - saveStartedAt < 5_000);

  await firstPage.locator('#btnTestAi').click();
  await firstPage.waitForFunction(() => {
    const result = document.querySelector('#aiTestResult');
    return result?.classList.contains('ok') && result.textContent.includes('连接正常');
  }, undefined, { timeout: 5_000 });
  assert.deepEqual(mockCalls[0], {
    path: '/chat/completions',
    model: PREFILTER_MODEL,
    authorized: true
  });

  await waitForJson(path.join(dataDir, 'ui-preferences.json'), preferences => (
    preferences.theme === 'light'
      && preferences.view === 'settings'
      && preferences.domain === 'lowaltitude'
      && preferences.category === '政策法规'
      && preferences.dailyDate === savedDailyDate
      && preferences.linksCategory === 'AI'
      && preferences.commonLinksFavorites.includes('kimi-ai') === (expectedFavoriteState === 'true')
      && preferences.realtime === false
  ));
  await assertPersistedFiles(dataDir, {
    baseUrl: mockBaseUrl,
    preferences: {
      theme: 'light',
      domain: 'lowaltitude',
      category: '政策法规',
      dailyDate: savedDailyDate,
      linksCategory: 'AI',
      realtime: false
    }
  });

  await firstPage.locator('.tab[data-view="links"]').click();
  await waitForJson(
    path.join(dataDir, 'ui-preferences.json'),
    preferences => preferences.view === 'links'
  );

  await firstPage.evaluate(() => {
    window.__sppJavascriptExecuted = false;
    const link = document.createElement('a');
    link.id = 'unsafe-e2e-link';
    link.href = 'javascript:window.__sppJavascriptExecuted=true';
    link.target = '_blank';
    link.textContent = 'unsafe';
    document.body.append(link);
  });
  await firstPage.locator('#unsafe-e2e-link').click();
  await waitForTwoAnimationFrames(firstPage);
  assert.equal(await firstPage.evaluate(() => window.__sppJavascriptExecuted), false);
  assert.equal(firstApp.windows().length, 1);

  singleInstanceProcess = spawn(require('electron'), ['.'], {
    cwd: projectRoot,
    env,
    stdio: 'ignore',
    windowsHide: true
  });
  const [singleInstanceExitCode] = await waitForExit(
    singleInstanceProcess,
    10_000,
    'second Electron instance'
  );
  assert.equal(singleInstanceExitCode, 0);
  assert.equal(firstApp.windows().length, 1);
  singleInstanceProcess = null;

  firstCloseMs = await closeElectronGracefully(firstApp, firstProcess, 'first Electron app');
  firstApp = null;

  portBlocker = http.createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await listen(portBlocker, { host: '127.0.0.1', port: firstPort, exclusive: true });

  secondApp = await electron.launch({ args: ['.'], cwd: projectRoot, env });
  const secondProcess = secondApp.process();
  const secondPage = await secondApp.firstWindow();
  await secondPage.waitForSelector('.tab[data-view="links"][aria-selected="true"]');

  const secondOrigin = await secondPage.evaluate(() => location.origin);
  const secondPort = Number(new URL(secondOrigin).port);
  assert.notEqual(secondPort, firstPort);
  assert.equal(await secondPage.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(
    await secondPage.locator('.tab[data-view="links"]').getAttribute('aria-selected'),
    'true'
  );
  assert.equal(await secondPage.locator('#viewLinks').isVisible(), true);
  assert.equal(
    await secondPage.locator('.pill[data-domain="lowaltitude"]').getAttribute('aria-pressed'),
    'true'
  );
  await secondPage.locator('.chip[data-cat="政策法规"]').waitFor({ state: 'attached' });
  assert.equal(
    await secondPage.locator('.chip[data-cat="政策法规"]').getAttribute('aria-pressed'),
    'true'
  );
  assert.equal(
    await secondPage.locator('.common-links-category[data-links-category="AI"]').getAttribute('aria-pressed'),
    'true'
  );
  assert.equal(
    await secondPage.locator('button[data-link-favorite="kimi-ai"]').getAttribute('aria-pressed'),
    expectedFavoriteState
  );
  assert.equal(await secondPage.locator('#btnRealtime').getAttribute('aria-pressed'), 'false');

  const restoredPreferences = await assertPersistedFiles(dataDir, {
    baseUrl: mockBaseUrl,
    preferences: {
      theme: 'light',
      view: 'links',
      domain: 'lowaltitude',
      category: '政策法规',
      dailyDate: savedDailyDate,
      linksCategory: 'AI',
      realtime: false
    }
  });
  assert.equal(
    restoredPreferences.commonLinksFavorites.includes('kimi-ai'),
    expectedFavoriteState === 'true'
  );

  await secondPage.locator('.tab[data-view="daily"]').click();
  await secondPage.waitForFunction(expected => (
    document.querySelector('#dailyDate')?.textContent.replaceAll(' ', '').replaceAll('/', '-') === expected
  ), savedDailyDate);

  await secondPage.locator('.tab[data-view="settings"]').click();
  await secondPage.waitForFunction(expected => {
    const key = document.querySelector('#setApiKey');
    const baseUrl = document.querySelector('#setBaseUrl');
    const prefilter = document.querySelector('#setPrefilterModel');
    const scoring = document.querySelector('#setScoringModel');
    return key?.dataset.hasStoredKey === 'true'
      && baseUrl?.value === expected.baseUrl
      && prefilter?.value === expected.prefilter
      && scoring?.value === expected.scoring;
  }, {
    baseUrl: mockBaseUrl,
    prefilter: PREFILTER_MODEL,
    scoring: SCORING_MODEL
  });
  const maskedSettings = await secondPage.evaluate(async () => (
    fetch('/api/settings').then(response => response.json())
  ));
  assert.equal(maskedSettings.ai._hasKey, true);
  assert.equal(Object.hasOwn(maskedSettings.ai, 'apiKey'), false);

  await secondPage.locator('#btnTestAi').click();
  await secondPage.waitForFunction(() => {
    const result = document.querySelector('#aiTestResult');
    return result?.classList.contains('ok') && result.textContent.includes('连接正常');
  }, undefined, { timeout: 5_000 });
  assert.deepEqual(mockCalls[1], {
    path: '/chat/completions',
    model: PREFILTER_MODEL,
    authorized: true
  });
  assert.equal(mockCalls.length, 2);

  secondCloseMs = await closeElectronGracefully(secondApp, secondProcess, 'second Electron app');
  secondApp = null;
  t.diagnostic(
    `restart ports ${firstPort} -> ${secondPort}; mock calls ${mockCalls.length}; `
      + `graceful closes ${firstCloseMs} ms / ${secondCloseMs} ms`
  );
});
