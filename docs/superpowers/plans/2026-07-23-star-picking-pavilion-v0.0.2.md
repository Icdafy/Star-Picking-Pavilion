# 摘星阁 v0.0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every meaningful UI selection across random-port Electron restarts, repair DeepSeek credential acknowledgement and runtime use, then publish the verified v0.0.2 release.

**Architecture:** Add a versioned, allowlisted, atomically written UI-preference store in the Electron main process and expose only a snapshot plus patch method through preload. Keep the random local API port and encrypted credential design; repair the utility-process acknowledgement adapter at the message boundary and verify both features through unit tests and two real Electron launches against a local mock model service.

**Tech Stack:** Node.js 22, Electron 42, native JavaScript, `node:test`, Playwright Electron, Electron `safeStorage`, GitHub Actions, electron-builder.

---

## File Structure

- Create `electron/ui-preferences.js`: normalize, load, snapshot, queue, and atomically persist allowlisted UI preferences.
- Create `test/ui-preferences.test.js`: unit coverage for defaults, corruption recovery, patch validation, write ordering, and atomic failure.
- Modify `electron/main.js`: initialize the preference store and register narrow read/update IPC handlers.
- Modify `electron/preload.js`: expose the initial preference snapshot and asynchronous patch method.
- Modify `test/preload.test.js`: verify the preload surface and IPC channels.
- Modify `test/main-security.test.js`: verify the main process registers only the intended preference IPC.
- Modify `renderer/bootstrap.js`: choose the desktop theme before CSS and retain browser/localStorage fallback behavior.
- Modify `renderer/app.js`: restore and persist all meaningful selection state.
- Modify `test/bootstrap.test.js`: cover desktop-theme precedence and browser fallback.
- Modify `test/renderer-integration.test.js`: cover restored state, persistence calls, and transient-state exclusions.
- Modify `server/runtime-credentials.js`: adapt Electron `MessageEvent.data` and make the credential runtime injectable for tests.
- Create `test/runtime-credentials.test.js`: reproduce the acknowledgement timeout and verify success/failure handling.
- Modify `test/e2e/electron.test.js`: save encrypted credentials, call a local mock model, restart on a different random port, and verify selections plus Key recovery.
- Modify `package.json`, `package-lock.json`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `RELEASING.md`, `README.md`, and release tests for v0.0.2.

### Task 1: Build the versioned Electron preference store

**Files:**
- Create: `test/ui-preferences.test.js`
- Create: `electron/ui-preferences.js`

- [ ] **Step 1: Write failing default and normalization tests**

Add tests that import the wished-for API:

```js
const {
  DEFAULT_UI_PREFERENCES,
  createUiPreferencesStore,
  normalizeUiPreferences
} = require('../electron/ui-preferences');

test('missing and corrupt files load safe complete defaults', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-ui-prefs-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createUiPreferencesStore({ directory });
  assert.deepEqual(await store.load(), DEFAULT_UI_PREFERENCES);
  await fs.promises.writeFile(store.file, '{bad json', 'utf8');
  assert.deepEqual(await store.load(), DEFAULT_UI_PREFERENCES);
});

test('normalization drops unknown fields and repairs invalid selections', () => {
  assert.deepEqual(normalizeUiPreferences({
    version: 99,
    theme: 'neon',
    view: 'missing',
    domain: 'secret',
    category: '政策',
    dailyDate: '2999-01-01',
    linksCategory: 'missing',
    commonLinksFavorites: ['kimi-ai', 'kimi-ai', 'missing-link', 7],
    realtime: false,
    secret: 'discard'
  }, { today: '2026-07-23' }), {
    version: 1,
    theme: 'dark',
    view: 'featured',
    domain: '',
    category: '政策',
    dailyDate: null,
    linksCategory: '全部',
    commonLinksFavorites: ['kimi-ai'],
    realtime: false
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test test/ui-preferences.test.js
```

Expected: failure because `electron/ui-preferences.js` does not exist.

- [ ] **Step 3: Implement the schema and default loader**

Create an immutable v1 schema using the existing IDs and categories from `renderer/common-links.js`. Normalize bounded strings, validate `YYYY-MM-DD` with an actual calendar round trip, reject future dates, deduplicate favorites, and return fresh clones:

```js
const VALID_VIEWS = new Set(['featured', 'hot', 'all', 'daily', 'links', 'sources', 'settings']);
const VALID_DOMAINS = new Set(['', 'lowaltitude', 'aerospace']);
const DEFAULT_UI_PREFERENCES = Object.freeze({
  version: 1,
  theme: 'dark',
  view: 'featured',
  domain: '',
  category: '',
  dailyDate: null,
  linksCategory: CommonLinks.ALL_CATEGORY,
  commonLinksFavorites: Object.freeze([...CommonLinks.getDefaultFavoriteIds()]),
  realtime: true
});
```

Expose `load()`, `getSnapshot()`, `hasStoredPreferences()`, and `update(patch)`. `load()` must never rewrite or delete a corrupt source file during startup.

- [ ] **Step 4: Add failing persistence and concurrency tests**

Cover:

```js
test('updates are allowlisted, queued, and persisted atomically', async () => {
  const first = store.update({ theme: 'light' });
  const second = store.update({ view: 'links', realtime: false });
  await Promise.all([first, second]);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(store.file, 'utf8')), {
    ...DEFAULT_UI_PREFERENCES,
    theme: 'light',
    view: 'links',
    realtime: false
  });
  assert.throws(() => store.update({ apiKey: 'must-not-exist' }), /不支持/);
});

test('failed atomic replacement preserves the previous valid file', async () => {
  const before = await fs.promises.readFile(store.file, 'utf8');
  await assert.rejects(store.update({ theme: 'dark' }, {
    rename: async () => { throw new Error('injected rename failure'); }
  }), /injected rename failure/);
  assert.equal(await fs.promises.readFile(store.file, 'utf8'), before);
  assert.equal((await fs.promises.readdir(directory)).some(name => name.endsWith('.tmp')), false);
});
```

- [ ] **Step 5: Implement queued atomic writes and run GREEN**

Apply in-memory patches synchronously in call order, serialize immutable snapshots through one promise queue, write a same-directory temporary file with mode `0o600`, then rename it into place. Clean temporary files on failure.

Run:

```powershell
node --test test/ui-preferences.test.js
```

Expected: all preference-store tests pass.

- [ ] **Step 6: Commit**

```powershell
git add electron/ui-preferences.js test/ui-preferences.test.js
git commit -m "feat: add durable desktop UI preferences"
```

### Task 2: Connect preferences through safe Electron IPC

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `test/preload.test.js`
- Modify: `test/main-security.test.js`

- [ ] **Step 1: Write failing preload and main-process tests**

Extend the preload fake so `sendSync('preferences:get')` returns:

```js
{
  preferences: {
    version: 1,
    theme: 'light',
    view: 'links',
    domain: '',
    category: '',
    dailyDate: null,
    linksCategory: 'AI',
    commonLinksFavorites: ['kimi-ai'],
    realtime: false
  },
  hasStoredPreferences: true
}
```

Assert:

```js
assert.equal(api.preferences.theme, 'light');
assert.equal(api.hasStoredPreferences, true);
await api.updatePreferences({ theme: 'dark' });
assert.deepEqual(ipcCalls.at(-1), ['invoke', 'preferences:update', { theme: 'dark' }]);
```

Add source assertions that `electron/main.js` registers `preferences:get` and `preferences:update`, creates the store under `getDataDir()`, and does not expose an arbitrary path or filesystem method.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
node --test test/preload.test.js test/main-security.test.js
```

Expected: failures for missing preference IPC and preload fields.

- [ ] **Step 3: Initialize the store and expose the minimal bridge**

In `electron/main.js`, create one store after data migration and before `createWindow()`:

```js
uiPreferencesStore = createUiPreferencesStore({ directory: dataDir });
await uiPreferencesStore.load();
```

Register:

```js
ipcMain.on('preferences:get', event => {
  event.returnValue = {
    preferences: uiPreferencesStore?.getSnapshot() || getDefaultUiPreferences(),
    hasStoredPreferences: uiPreferencesStore?.hasStoredPreferences() || false
  };
});
ipcMain.handle('preferences:update', (_event, patch) => uiPreferencesStore.update(patch));
```

In preload, read the initial snapshot once and expose frozen values:

```js
const initialPreferences = ipcRenderer.sendSync('preferences:get');
preferences: Object.freeze({ ...initialPreferences.preferences }),
hasStoredPreferences: Boolean(initialPreferences.hasStoredPreferences),
updatePreferences: patch => ipcRenderer.invoke('preferences:update', patch)
```

- [ ] **Step 4: Run focused and full unit tests**

Run:

```powershell
node --test test/preload.test.js test/main-security.test.js test/ui-preferences.test.js
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add electron/main.js electron/preload.js test/preload.test.js test/main-security.test.js
git commit -m "feat: bridge desktop preferences securely"
```

### Task 3: Restore and persist every meaningful UI selection

**Files:**
- Modify: `renderer/bootstrap.js`
- Modify: `renderer/app.js`
- Modify: `test/bootstrap.test.js`
- Modify: `test/renderer-integration.test.js`

- [ ] **Step 1: Write failing bootstrap tests**

Add:

```js
test('desktop preference theme wins before the stylesheet loads', () => {
  const document = { documentElement: { dataset: {}, style: {} } };
  assert.equal(initializeTheme(createStorage({ 'wc-theme': 'dark' }), document, {
    theme: 'light'
  }), 'light');
  assert.equal(document.documentElement.dataset.theme, 'light');
});
```

Retain existing browser tests proving legacy localStorage migration when no desktop snapshot exists.

- [ ] **Step 2: Write failing renderer integration assertions**

Require persistence calls for `theme`, `view`, `domain`, `category`, `dailyDate`, `linksCategory`, `commonLinksFavorites`, and `realtime`. Assert search input, page number, scroll position, expanded cards, and form values never appear in preference patches.

Assert startup applies restored active tab, domain pill, category chip, link category, favorites, daily date, and realtime state without writing duplicate defaults.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```powershell
node --test test/bootstrap.test.js test/renderer-integration.test.js
```

Expected: failures because desktop preferences are not read or updated.

- [ ] **Step 4: Implement pre-CSS theme restoration**

Change bootstrap initialization to accept the preload snapshot:

```js
api.initializeTheme(
  root.localStorage,
  root.document,
  root.starPickingPavilion?.preferences
);
```

Use a valid desktop `theme` first and fall back to the existing localStorage migration only when no desktop value exists.

- [ ] **Step 5: Implement state restoration and minimal preference patches**

Initialize `state` from `Desktop.preferences`, with localStorage fallback only when no desktop bridge is present. Add one helper:

```js
function persistUiPreferences(patch) {
  if (Desktop?.updatePreferences) {
    Desktop.updatePreferences(patch).catch(() => toast('界面选择保存失败，请重试', true));
    return;
  }
  persistBrowserPreferences(patch);
}
```

Persist from the existing event boundaries:

- theme button: `{ theme }`
- main tab: `{ view }`
- domain pill: `{ domain }`
- category chip: `{ category }`
- daily previous/next or returned selected date: `{ dailyDate }`
- common-link category: `{ linksCategory }`
- star toggle: `{ commonLinksFavorites: [...ids] }`
- realtime button: `{ realtime }`

On startup, set matching active/ARIA states and call `switchView(state.view, { persist: false })`. After `/api/categories` returns, keep a restored category only if it still exists; otherwise clear and persist the repair. Do the equivalent local validation for link categories and favorite IDs.

If `hasStoredPreferences` is false, merge any readable current-origin legacy theme/realtime/favorites once and submit the migrated snapshot.

- [ ] **Step 6: Run renderer tests and full unit suite**

Run:

```powershell
node --test test/bootstrap.test.js test/renderer-integration.test.js
npm test
```

Expected: all tests pass with no unhandled rejection output.

- [ ] **Step 7: Commit**

```powershell
git add renderer/bootstrap.js renderer/app.js test/bootstrap.test.js test/renderer-integration.test.js
git commit -m "feat: remember all meaningful UI selections"
```

### Task 4: Repair DeepSeek credential acknowledgement

**Files:**
- Create: `test/runtime-credentials.test.js`
- Modify: `server/runtime-credentials.js`

- [ ] **Step 1: Write the failing Electron MessageEvent regression**

Create a fake parent port with `EventEmitter` and `postMessage`. Test:

```js
test('Electron MessageEvent acknowledgement commits the runtime key', async () => {
  const port = new FakeParentPort();
  const runtime = createRuntimeCredentials({
    initialApiKey: 'old-key',
    parentPort: port,
    randomUUID: () => 'request-1',
    confirmationTimeoutMs: 100
  });
  const saving = runtime.persistApiKey('new-key');
  assert.deepEqual(port.sent[0], {
    type: 'credential:set',
    requestId: 'request-1',
    apiKey: 'new-key'
  });
  port.emit('message', { data: {
    type: 'credential:result',
    requestId: 'request-1',
    ok: true
  } });
  await saving;
  assert.equal(runtime.getApiKey(), 'new-key');
});
```

Also cover a direct message object, a mismatched request ID, and `ok: false` leaving the old runtime Key unchanged.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test test/runtime-credentials.test.js
```

Expected: failure because there is no injectable runtime and wrapped messages are ignored.

- [ ] **Step 3: Implement an injectable credential runtime**

Export `createRuntimeCredentials(options)` and retain the existing singleton exports. At the boundary:

```js
const message = messageEvent?.data ?? messageEvent;
if (message?.type !== 'credential:result') return;
```

Only mutate the runtime Key after the matching success acknowledgement. Clear timeouts and pending entries on every terminal path. Do not log or include the Key in errors.

- [ ] **Step 4: Run credential, settings, and security tests**

Run:

```powershell
node --test test/runtime-credentials.test.js test/settings-persistence.test.js test/config.test.js test/server-security.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/runtime-credentials.js test/runtime-credentials.test.js
git commit -m "fix: acknowledge encrypted AI credentials"
```

### Task 5: Prove preferences and DeepSeek across real restarts

**Files:**
- Modify: `test/e2e/electron.test.js`

- [ ] **Step 1: Add a local mock DeepSeek service**

Start an HTTP server on `127.0.0.1:0`. Record request path, parsed body model, and whether `Authorization` exactly matches the dummy test Key without printing it. Return:

```json
{
  "choices": [
    {
      "message": {
        "content": "{\"ok\":true}"
      }
    }
  ]
}
```

- [ ] **Step 2: Extend the real Electron flow and confirm it fails before the fix**

Drive the UI to:

- choose light theme;
- choose a non-default domain and category;
- choose a daily date;
- choose `AI` in common links and toggle one star;
- disable realtime updates;
- leave `links` as the last active view;
- save the dummy Key, mock base URL, and models;
- test the connection.

Assert the pre-fix save ends in `AI 配置保存失败` and use that as the real reproduction.

- [ ] **Step 3: Assert encrypted storage and successful model use**

After the implementation:

```js
assert.equal(await page.locator('#setApiKey').getAttribute('data-has-stored-key'), 'true');
assert.match(await page.locator('#aiTestResult').textContent(), /连接正常/);
assert.equal(modelRequests.at(-1).authorized, true);
assert.equal(modelRequests.at(-1).model, 'deepseek-v4-flash');
assert.doesNotMatch(await fs.promises.readFile(credentialsFile, 'utf8'), /sk-e2e-secret/);
assert.doesNotMatch(await fs.promises.readFile(settingsFile, 'utf8'), /sk-e2e-secret/);
```

- [ ] **Step 4: Close, force a new port, relaunch, and verify restoration**

Fully close Electron. Temporarily bind the first app port before the second launch so the second server cannot reuse it. Relaunch with the same test data directory and assert:

- new origin port differs;
- light theme is applied before interaction;
- `links` is the active and visible view;
- domain and category controls retain their active state;
- saved common-link category and star state are restored;
- realtime is still disabled;
- daily navigation resumes from the saved date;
- settings report a stored Key;
- a second connection test reaches the mock service with authorization.

- [ ] **Step 5: Run the real Electron test**

Run:

```powershell
npm run test:e2e
```

Expected: all Electron tests pass, including complete close/relaunch.

- [ ] **Step 6: Commit**

```powershell
git add test/e2e/electron.test.js
git commit -m "test: cover v0.0.2 desktop restart flow"
```

### Task 6: Update v0.0.2 metadata and release documentation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `RELEASE_NOTES.md`
- Modify: `RELEASING.md`
- Modify: `README.md`
- Modify: `test/release-readiness.test.js`

- [ ] **Step 1: Write failing release assertions for v0.0.2**

Update tests to require:

```js
assert.equal(require('../package.json').version, '0.0.2');
assert.match(read('CHANGELOG.md'), /\[0\.0\.2\].*2026-07-23/);
assert.match(read('RELEASE_NOTES.md'), /v0\.0\.2[\s\S]*选择[\s\S]*DeepSeek/);
assert.match(read('README.md'), /Star-Picking-Pavilion-Setup-0\.0\.2\.exe/);
```

Update the version verifier fixture and expected installer/tag to `0.0.2`, while keeping a mismatch assertion for `v0.0.1`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test test/release-readiness.test.js
```

Expected: failures because metadata still says 0.0.1.

- [ ] **Step 3: Bump package metadata and documentation**

Run:

```powershell
npm version 0.0.2 --no-git-tag-version
```

Document:

- durable theme, view, filter, daily, link category, star, and realtime choices;
- repaired encrypted DeepSeek Key save/acknowledgement;
- API Key remains outside `settings.json`;
- installation remains unsigned and may trigger SmartScreen;
- v0.0.2 verification and artifact commands.

- [ ] **Step 4: Regenerate notices and run release tests**

Run:

```powershell
npm run notices
node --test test/release-readiness.test.js
npm run verify:version -- --tag v0.0.2
```

Expected: all pass and generated notices contain no unexpected diff after regeneration.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json CHANGELOG.md RELEASE_NOTES.md RELEASING.md README.md THIRD_PARTY_NOTICES.txt test/release-readiness.test.js
git commit -m "chore: prepare v0.0.2 release"
```

### Task 7: Verify, build, audit, push, and publish

**Files:**
- Verify all modified files and generated `dist/` artifacts.

- [ ] **Step 1: Review scope and repository cleanliness**

Run:

```powershell
git status --short
git diff HEAD~6 --check
git diff HEAD~6 --stat
git log -8 --oneline --decorate
```

Expected: only v0.0.2 implementation, tests, docs, and generated notices are tracked changes; user data and secrets are absent.

- [ ] **Step 2: Run the complete fresh verification matrix**

Run:

```powershell
npm test
npm run test:e2e
npm run audit:runtime
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
npm run verify:version -- --tag v0.0.2
npm run dist
npm run verify:package
npm run verify:version -- --tag v0.0.2 --artifacts
```

Expected: every command exits 0.

- [ ] **Step 3: Verify the built installer checksum and signature state**

Run:

```powershell
$installer = 'dist\Star-Picking-Pavilion-Setup-0.0.2.exe'
Get-FileHash -Algorithm SHA256 -LiteralPath $installer
Get-AuthenticodeSignature -LiteralPath $installer
```

Expected: a SHA-256 value is produced; signature status is `NotSigned`, matching release documentation.

- [ ] **Step 4: Verify the exact GitHub destination**

Run:

```powershell
git remote -v
gh repo view Icdafy/Star-Picking-Pavilion --json nameWithOwner,url,defaultBranchRef
git ls-remote https://github.com/Icdafy/Star-Picking-Pavilion.git refs/heads/main refs/tags/v0.0.2
```

If `origin` still names the historical `Windcather` URL, preserve it as `legacy` when not already present and set `origin` to the exact `Star-Picking-Pavilion` URL before pushing.

- [ ] **Step 5: Push main and create the annotated release tag**

Run:

```powershell
git push origin main
git tag -a v0.0.2 -m "摘星阁 v0.0.2"
git push origin v0.0.2
```

Expected: both pushes succeed without force.

- [ ] **Step 6: Wait for the release workflow and verify the public release**

Use GitHub workflow/release inspection to wait until the tag workflow completes. Confirm the public Release contains:

- `Star-Picking-Pavilion-Setup-0.0.2.exe`
- `Star-Picking-Pavilion-Setup-0.0.2.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

Download `SHA256SUMS.txt` and the installer into a new temporary directory and independently verify the installer hash.

- [ ] **Step 7: Report the release**

Report commit, tag, Release URL, verification commands, test counts, installer filename, SHA-256, signature status, and any non-blocking warnings. Do not report completion until the remote workflow and assets are confirmed.
