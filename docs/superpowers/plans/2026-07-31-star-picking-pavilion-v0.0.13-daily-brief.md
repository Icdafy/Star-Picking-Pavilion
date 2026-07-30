# Star Picking Pavilion v0.0.13 Daily Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reliable 08:00 local daily archive with a native folder opt-in, Markdown plus JSONL research data, missed-day catch-up, and evidence-gated technology-breakthrough heat boosting for v0.0.13.

**Architecture:** The backend owns deterministic news-window queries, breakthrough classification, and bundle rendering; Electron owns folder authorization, scheduling, catch-up, atomic filesystem writes, and persisted archive state; the renderer only invokes fixed preload methods and renders status. Breakthrough evidence is persisted with each article so JavaScript display calculations, SQL hot ordering, the daily brief, and the JSONL archive all consume one result.

**Tech Stack:** Node.js 22, Electron 42, built-in `node:sqlite`, `node:test`, local authenticated HTTP API, HTML/CSS/vanilla JavaScript, electron-builder, GitHub Actions.

---

## File Map

**Create**

- `config/breakthroughs.json` — configurable technical objects, completion verbs, uncertainty markers, credibility gates, and scoring version.
- `server/ai/breakthrough.js` — pure evidence extraction and breakthrough strength calculation.
- `server/archive/daily-bundle.js` — fixed 08:00 window query, Markdown model, JSONL rows, and bundle metadata.
- `electron/daily-archive.js` — settings persistence, folder validation, scheduling, catch-up, and atomic date-directory writes.
- `electron/daily-archive-ipc.js` — fixed IPC handlers and native directory selection.
- `renderer/daily-archive-controller.js` — switch, path, status, manual save, and retry state machine.
- `test/breakthrough.test.js`
- `test/breakthrough-pipeline.test.js`
- `test/daily-bundle.test.js`
- `test/daily-archive.test.js`
- `test/daily-archive-ipc.test.js`
- `test/daily-archive-controller.test.js`

**Modify**

- `server/db.js` — idempotent breakthrough columns and indexes.
- `server/config.js` — breakthrough configuration loading.
- `server/ai/pipeline.js` — calculate and persist breakthrough evidence on initial analysis and cluster rescore.
- `server/ai/scoring.js` — backward-compatible heat formula with bonus and half-life extension.
- `server/ai/daily.js` — v3 daily report based on the shared fixed-window bundle data.
- `server/export/markdown.js` — archive-oriented Markdown renderer and v0.0.13 footer.
- `server/index.js` — SQL heat parity and authenticated daily bundle endpoint.
- `server/scheduler.js` — generate the database daily report at 08:00.
- `electron/main.js` — lifecycle wiring, backend bundle request, archive service startup/shutdown, and IPC registration.
- `electron/preload.js` — fixed daily archive bridge methods.
- `renderer/index.html` — settings card and controller script.
- `renderer/app.js` — controller wiring and settings load.
- `renderer/styles.css` — responsive archive status layout and breakthrough badge.
- `test/scoring-v7.test.js`
- `test/scheduler.test.js`
- `test/export-markdown.test.js`
- `test/preload.test.js`
- `test/renderer-integration.test.js`
- `test/responsive-layout.test.js`
- `test/e2e/electron.test.js`
- `test/static-files.test.js`
- `test/release-readiness.test.js`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `RELEASE_NOTES.md`
- `RELEASING.md`

## Task 1: Technology-breakthrough evidence model

**Files:**

- Create: `config/breakthroughs.json`
- Create: `server/ai/breakthrough.js`
- Create: `test/breakthrough.test.js`

- [x] **Step 1: Write failing positive and negative classifier tests**

Create table-driven tests that call:

```js
const { analyzeBreakthrough } = require('../server/ai/breakthrough');

const result = analyzeBreakthrough({
  domain: 'aerospace',
  category: '技术研发',
  title: '可重复使用火箭完成十公里垂直起降回收试验',
  summary: '官方宣布点火、着陆和回收验证成功',
  tier: 'T1',
  clusterSize: 1,
  scores: { novelty: 88, importance: 82, credibility: 92 }
}, config);

assert.ok(result.score >= 0.6);
assert.ok(result.bonus > 0);
assert.ok(result.signals.actions.includes('回收'));
```

Cover both industries and reject planned, rumored, noisy, wrong-category, low-credibility T2 single-source, and object-only examples.

- [x] **Step 2: Run classifier tests and verify the missing-module failure**

Run:

```powershell
node --test test/breakthrough.test.js
```

Expected: fail because `server/ai/breakthrough.js` does not exist.

- [x] **Step 3: Add the versioned configuration**

Define:

```json
{
  "version": 1,
  "maxBonus": 10,
  "maxHalfLifeExtensionHours": 18,
  "minimumScores": {
    "tier15Credibility": 70,
    "corroboratedCredibility": 60
  },
  "eligibleCategories": ["技术研发", "发射与任务"],
  "completionActions": ["首飞", "试飞", "点火成功", "入轨", "回收", "复用", "适航取证", "测试通过", "性能验证"],
  "uncertaintyMarkers": ["拟", "计划", "有望", "或将", "传闻", "网传", "预计", "意向", "宣布将"],
  "objects": {
    "lowaltitude": ["eVTOL", "飞行汽车", "飞控", "航电", "电推进", "航空电池", "垂直起降", "适航", "低空智联网"],
    "aerospace": ["可重复使用火箭", "火箭发动机", "推进系统", "卫星平台", "有效载荷", "星座组网", "热防护", "轨道转移"]
  }
}
```

Expand aliases enough to cover the accepted design cases without generic words such as “航空” or “卫星” acting alone.

- [x] **Step 4: Implement a pure, explainable classifier**

Export:

```js
function analyzeBreakthrough(article, config) {
  return {
    version: config.version,
    score,
    bonus: Math.round(config.maxBonus * score * 10) / 10,
    signals: {
      objects,
      actions,
      credibilityEvidence,
      uncertainty,
      rejectedReason
    }
  };
}
```

Require domain, eligible category, one object, one completion action, zero noise, and the configured credibility gate. Calculate strength from normalized novelty, importance, credibility, object specificity, completion evidence, tier, and corroboration. Clamp to `[0, 1]`.

- [x] **Step 5: Run classifier tests**

Run:

```powershell
node --test test/breakthrough.test.js
```

Expected: all cases pass.

- [x] **Step 6: Commit the classifier**

```powershell
git add config/breakthroughs.json server/ai/breakthrough.js test/breakthrough.test.js
git commit -m "feat: classify credible technology breakthroughs"
```

## Task 2: Persist breakthrough evidence and keep heat calculations equivalent

**Files:**

- Modify: `server/db.js`
- Modify: `server/config.js`
- Modify: `server/ai/pipeline.js`
- Modify: `server/ai/scoring.js`
- Modify: `server/index.js`
- Modify: `test/scoring-v7.test.js`
- Create: `test/breakthrough-pipeline.test.js`

- [x] **Step 1: Write failing database, pipeline, and heat tests**

Assert migrations add:

```text
breakthrough_score
breakthrough_bonus
breakthrough_signals_json
scoring_version
```

Assert zero-strength calls preserve the old formula exactly:

```js
assert.equal(
  heatScore(80, publishedAt, scoring, nowMs, { score: 0, bonus: 0 }),
  80 * Math.pow(0.5, 12 / 36)
);
```

Assert positive strength uses:

```text
min(100, quality + bonus) *
0.5 ** (hours / (baseHalfLife + maxExtension * score))
```

Add fixture rows proving SQL hot ordering matches `heatScore()` ordering and that pipeline rescore updates multi-source evidence.

- [x] **Step 2: Run focused tests to confirm red state**

Run:

```powershell
node --test test/scoring-v7.test.js test/breakthrough-pipeline.test.js
```

Expected: fail on missing fields and old heat signature.

- [x] **Step 3: Add idempotent database columns**

Extend `migrate()`:

```js
addCol('breakthrough_score', 'REAL NOT NULL DEFAULT 0');
addCol('breakthrough_bonus', 'REAL NOT NULL DEFAULT 0');
addCol('breakthrough_signals_json', 'TEXT');
addCol('scoring_version', 'INTEGER NOT NULL DEFAULT 1');
```

- [x] **Step 4: Load breakthrough configuration from one path**

Add `BREAKTHROUGH_PATH`, `loadBreakthroughs()`, validation, and export in `server/config.js`. Fail startup for malformed bundled configuration rather than silently accepting an unsafe rule set.

- [x] **Step 5: Persist evidence during scoring and cluster rescore**

Build classifier input from title, raw/AI summary, domain, category, tier, cluster size, model scores, and noise count. Extend update statements to persist score, bonus, signals JSON, and version. Ensure `rescoreAfterClustering()` selects enough fields and recalculates after cluster size changes.

- [x] **Step 6: Update JavaScript and SQL heat formulas**

Keep old callers valid:

```js
function heatScore(quality, publishedAt, scoring, nowMs = Date.now(), breakthrough = {}) {
  const score = clamp01(breakthrough.score);
  const bonus = Math.max(0, finite(breakthrough.bonus));
  const effectiveQuality = Math.min(100, Math.max(0, quality + bonus));
  const halfLife = baseHalfLife + maxExtension * score;
  return effectiveQuality * Math.pow(0.5, hours / halfLife);
}
```

Mirror the same expression in `HEAT_EXPRESSION`, parameter order, fallback query, and `articleRow()`.

- [x] **Step 7: Run focused tests**

Run:

```powershell
node --test test/scoring-v7.test.js test/breakthrough-pipeline.test.js test/feed-query.test.js
```

Expected: all pass.

- [x] **Step 8: Commit persistence and heat changes**

```powershell
git add server/db.js server/config.js server/ai/pipeline.js server/ai/scoring.js server/index.js test/scoring-v7.test.js test/breakthrough-pipeline.test.js test/feed-query.test.js
git commit -m "feat: boost heat for verified breakthroughs"
```

## Task 3: Build deterministic daily research bundles

**Files:**

- Create: `server/archive/daily-bundle.js`
- Create: `test/daily-bundle.test.js`
- Modify: `server/ai/daily.js`
- Modify: `server/export/markdown.js`
- Modify: `server/index.js`
- Modify: `test/export-markdown.test.js`

- [x] **Step 1: Write failing fixed-window and full-record tests**

Use a temporary SQLite fixture with records at `07:59:59.999`, exactly `08:00:00.000`, within the window, and a late-fetched older publication. Assert:

```js
const bundle = buildDailyBundle({ database, date: '2026-07-31', scoring, nowMs });
assert.equal(bundle.window.start, '2026-07-30T00:00:00.000Z');
assert.equal(bundle.window.end, '2026-07-31T00:00:00.000Z');
assert.equal(bundle.records.length, expectedAllFetchedRecords);
assert.equal(bundle.records.filter(row => row.clusterId === 7).length, 2);
```

In Asia/Shanghai, the UTC values above represent local 08:00. Also assert Markdown folds cluster summaries, JSONL retains both reports, empty windows are valid, and every accepted schema field exists.

- [x] **Step 2: Run bundle tests and verify failure**

Run:

```powershell
node --test test/daily-bundle.test.js test/export-markdown.test.js
```

Expected: fail because the bundle module and archive renderer are missing.

- [x] **Step 3: Implement the shared query and stable schema**

Export:

```js
function resolveDailyWindow(date, timeZoneOffsetProvider) {}
function queryDailyRecords(database, window, scoring) {}
function buildDailyBundle({ database, date, scoring, branding, now }) {}
function serializeJsonl(records) {
  return records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
}
```

Query by `a.fetched_at > start AND a.fetched_at <= end`, join source and cluster metadata, order by `fetched_at, id`, parse JSON defensively, and calculate `heatAtCutoff` at the fixed window end.

- [x] **Step 4: Render the human brief**

Add `renderDailyArchive(bundle, options)` with overview, domain counts, hot ranking, breakthrough section, category sections, complete relevant index, and unreviewed/irrelevant counts. Use existing Markdown escaping and safe URL rules.

- [x] **Step 5: Upgrade the database daily report**

Make `generateDaily()` consume the same window/query semantics, set `windowVersion: 3`, and include new totals and breakthrough summaries. Keep `getDaily()` able to regenerate v2 cached rows.

- [x] **Step 6: Add an authenticated backend bundle endpoint**

Add:

```text
GET /api/daily/archive?date=YYYY-MM-DD
```

Return:

```json
{
  "date": "2026-07-31",
  "summary": {},
  "markdown": "...",
  "jsonl": "...",
  "manifest": {
    "schemaVersion": 1,
    "window": {}
  }
}
```

Use the existing strict date sanitizer, local token authentication, response security headers, and body size behavior.

- [x] **Step 7: Run bundle and export tests**

Run:

```powershell
node --test test/daily-bundle.test.js test/export-markdown.test.js test/date-time.test.js
```

Expected: all pass.

- [x] **Step 8: Commit the backend bundle**

```powershell
git add server/archive/daily-bundle.js server/ai/daily.js server/export/markdown.js server/index.js test/daily-bundle.test.js test/export-markdown.test.js
git commit -m "feat: generate daily research bundles"
```

## Task 4: Implement desktop archive state, atomic writes, scheduling, and catch-up

**Files:**

- Create: `electron/daily-archive.js`
- Create: `test/daily-archive.test.js`

- [x] **Step 1: Write failing state and filesystem tests**

Inject filesystem, clock, timer, hashing, and bundle request dependencies. Cover:

```js
const service = createDailyArchiveService({
  userDataPath,
  requestBundle,
  now: () => new Date('2026-07-31T02:00:00.000Z'),
  setTimer,
  clearTimer
});
```

Assert default disabled state, atomic settings save, current due date before/after 08:00, multi-day catch-up, same-date single flight, valid existing manifest skip, incomplete target conflict directory, missing drive retry, temporary directory cleanup rules, and no advancement after failure.

- [x] **Step 2: Run archive service tests and verify missing-module failure**

Run:

```powershell
node --test test/daily-archive.test.js
```

Expected: fail because `electron/daily-archive.js` is missing.

- [x] **Step 3: Implement validated versioned state**

Persist `daily-archive.json` with:

```js
{
  schemaVersion: 1,
  enabled: false,
  rootDirectory: '',
  enabledAt: null,
  lastSuccessfulDate: null,
  lastAttemptAt: null,
  lastErrorCode: null,
  lastErrorAt: null
}
```

Use a temporary sibling and rename. Invalid or corrupt state returns disabled defaults.

- [x] **Step 4: Implement exact date and catch-up helpers**

Export pure helpers for:

```js
mostRecentDueDate(now)
nextRunAt(now)
enumerateDueDates(state, now)
```

Use local calendar construction for 08:00, not a fixed 24-hour interval.

- [x] **Step 5: Implement root validation and atomic date directory writes**

Validate absolute directories with a create/write/remove probe. Build fixed child segments only. Write Markdown and JSONL, calculate SHA-256, write manifest last, then rename the temporary directory. Never accept paths from renderer input and never recursively overwrite an existing date directory.

- [x] **Step 6: Implement scheduler lifecycle**

Provide:

```js
start()
stop()
getSnapshot()
enable(rootDirectory)
disable()
saveCurrent()
retry()
handleResume()
```

Schedule one timer to the next local 08:00, reschedule after firing, and serialize catch-up dates.

- [x] **Step 7: Run archive service tests**

Run:

```powershell
node --test test/daily-archive.test.js
```

Expected: all pass.

- [x] **Step 8: Commit the desktop service**

```powershell
git add electron/daily-archive.js test/daily-archive.test.js
git commit -m "feat: archive daily briefs atomically"
```

## Task 5: Add native folder selection and restricted IPC

**Files:**

- Create: `electron/daily-archive-ipc.js`
- Create: `test/daily-archive-ipc.test.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `test/preload.test.js`
- Modify: `test/main-security.test.js`

- [x] **Step 1: Write failing IPC and preload tests**

Assert fixed channels:

```text
daily-archive:get
daily-archive:choose-directory
daily-archive:set-enabled
daily-archive:save-current
daily-archive:retry
```

Assert directory choice uses `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })`, cancellation does not enable, `set-enabled` accepts only a boolean, and no IPC handler accepts a path argument.

- [x] **Step 2: Run IPC tests and verify failure**

Run:

```powershell
node --test test/daily-archive-ipc.test.js test/preload.test.js test/main-security.test.js
```

Expected: fail on missing handlers and bridge methods.

- [x] **Step 3: Implement IPC handlers**

Register handlers with injected `getService`, `dialog`, and `getWindow`. Choose directory in main, call `service.enable(selectedPath)`, return frozen-safe snapshots, and translate validation failures to stable Chinese messages.

- [x] **Step 4: Wire the archive service to Electron lifecycle**

After the authenticated backend is ready, create `requestBundle(date)` using the server controller’s exact origin and bearer token, start the service, register power-monitor resume/time-change handling, and stop timers before shutdown. Do not expose the token to renderer code beyond the existing page bootstrap mechanism.

- [x] **Step 5: Expose fixed preload methods**

Add:

```js
getDailyArchiveSettings: () => ipcRenderer.invoke('daily-archive:get').then(cloneAndFreeze),
chooseDailyArchiveDirectory: () => ipcRenderer.invoke('daily-archive:choose-directory').then(cloneAndFreeze),
setDailyArchiveEnabled: enabled => ipcRenderer.invoke('daily-archive:set-enabled', { enabled }).then(cloneAndFreeze),
saveCurrentDailyArchive: () => ipcRenderer.invoke('daily-archive:save-current').then(cloneAndFreeze),
retryDailyArchives: () => ipcRenderer.invoke('daily-archive:retry').then(cloneAndFreeze)
```

- [x] **Step 6: Run IPC and security tests**

Run:

```powershell
node --test test/daily-archive-ipc.test.js test/preload.test.js test/main-security.test.js test/server-security.test.js
```

Expected: all pass.

- [x] **Step 7: Commit desktop integration**

```powershell
git add electron/daily-archive-ipc.js electron/main.js electron/preload.js test/daily-archive-ipc.test.js test/preload.test.js test/main-security.test.js
git commit -m "feat: add native daily archive controls"
```

## Task 6: Build the settings UI and breakthrough explanation

**Files:**

- Create: `renderer/daily-archive-controller.js`
- Create: `test/daily-archive-controller.test.js`
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`
- Modify: `test/renderer-integration.test.js`
- Modify: `test/responsive-layout.test.js`
- Modify: `test/static-files.test.js`

- [x] **Step 1: Write failing controller and integration tests**

Assert:

- cancelled choice restores the off switch;
- enabled snapshot renders selected path, next run, last success/failure, and pending count;
- disabled Electron bridge shows desktop-only guidance;
- manual save and retry disable only related controls while pending;
- card data with `breakthroughBonus > 0` renders a “技术突破 +N” badge and accessible explanation;
- required IDs and script tags exist.

- [x] **Step 2: Run UI tests and verify red state**

Run:

```powershell
node --test test/daily-archive-controller.test.js test/renderer-integration.test.js test/responsive-layout.test.js test/static-files.test.js
```

Expected: fail because the controller and markup are missing.

- [x] **Step 3: Implement the controller state machine**

Export `createDailyArchiveController({ elements, bridge, formatDateTime })` with:

```js
load()
toggle(enabled)
chooseDirectory()
saveCurrent()
retry()
```

Queue mutations, restore confirmed state after errors, set `aria-busy`, and keep status messages in one `aria-live` region.

- [x] **Step 4: Add the settings card**

Add the switch, selected path, change-directory button, immediate-save button, retry button, next run, last success, and status. Mark path output with `dir="auto"` and allow wrapping without a horizontal table.

- [x] **Step 5: Wire renderer startup**

Create the controller only when every preload method exists. Load it with other settings. Browser-only mode disables the switch and keeps existing daily Markdown download.

- [x] **Step 6: Render breakthrough badges**

Use persisted `breakthroughBonus`, `breakthroughScore`, and sanitized signals from `articleRow()`. Put the short badge beside heat/quality metadata and the human explanation inside the existing expanded dimensions panel.

- [x] **Step 7: Style for all supported sizes**

Use existing glass-card, switch, button, spacing, and theme variables. At narrow widths stack status rows and allow long paths to wrap with `overflow-wrap:anywhere`. Do not introduce a new color system.

- [x] **Step 8: Run UI tests**

Run:

```powershell
node --test test/daily-archive-controller.test.js test/renderer-integration.test.js test/responsive-layout.test.js test/static-files.test.js
```

Expected: all pass.

- [x] **Step 9: Commit the UI**

```powershell
git add renderer/daily-archive-controller.js renderer/index.html renderer/app.js renderer/styles.css test/daily-archive-controller.test.js test/renderer-integration.test.js test/responsive-layout.test.js test/static-files.test.js
git commit -m "feat: add daily archive settings experience"
```

## Task 7: Align the scheduler and verify real Electron flows

**Files:**

- Modify: `server/scheduler.js`
- Modify: `test/scheduler.test.js`
- Modify: `test/e2e/electron.test.js`

- [ ] **Step 1: Write failing scheduler and E2E expectations**

Assert daily report cron is exactly `0 8 * * *`, stop destroys it, and an archive-enabled E2E fixture can select a temporary directory through a stubbed native dialog, save current, and observe all three files with a valid manifest.

- [ ] **Step 2: Run focused scheduler and E2E tests**

Run:

```powershell
node --test test/scheduler.test.js
npm run test:e2e
```

Expected: scheduler assertion fails before implementation; add E2E support without weakening existing real Electron checks.

- [ ] **Step 3: Move database daily generation to 08:00**

Change the cron minute from `5` to `0`, update status logging, preserve retention at 08:25, and ensure the independent Electron archive query can safely run concurrently as a read.

- [ ] **Step 4: Complete the real Electron archive flow**

Use an isolated temporary user-data directory and archive root. Verify switch state, save button, generated files, manifest hashes, restart persistence, and no console/page errors.

- [ ] **Step 5: Run scheduler and E2E tests**

Run:

```powershell
node --test test/scheduler.test.js
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 6: Commit scheduling and E2E coverage**

```powershell
git add server/scheduler.js test/scheduler.test.js test/e2e/electron.test.js
git commit -m "test: verify scheduled daily archives"
```

## Task 8: Prepare v0.0.13 documentation and release metadata

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server/export/markdown.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `RELEASE_NOTES.md`
- Modify: `RELEASING.md`
- Modify: `test/export-markdown.test.js`
- Modify: `test/release-readiness.test.js`

- [ ] **Step 1: Write failing version and documentation tests**

Update expectations to v0.0.13 and assert README/Release Notes describe:

```text
08:00
自动保存
news.jsonl
manifest.json
技术突破
隐私
补齐
```

- [ ] **Step 2: Run version/release tests to confirm red state**

Run:

```powershell
node --test test/export-markdown.test.js test/release-readiness.test.js
npm run verify:version -- --tag v0.0.13
```

Expected: fail while manifests and docs remain v0.0.12.

- [ ] **Step 3: Bump package manifests**

Run:

```powershell
npm version 0.0.13 --no-git-tag-version
```

Confirm only `package.json` and `package-lock.json` receive the mechanical version update.

- [ ] **Step 4: Update product and release documentation**

Document folder opt-in, fixed window, all-record JSONL semantics, catch-up, non-overwrite rule, breakthrough evidence gates, formula, privacy, backup, unsigned installer, and migration compatibility. Replace release notes with the v0.0.13 release.

- [ ] **Step 5: Update release commands and tests**

Change tag and artifact examples to v0.0.13 while preserving the protected tag workflow and v0.0.12 size baselines where they are historical limits.

- [ ] **Step 6: Run version and release tests**

Run:

```powershell
node --test test/export-markdown.test.js test/release-readiness.test.js
npm run verify:version -- --tag v0.0.13
```

Expected: all pass.

- [ ] **Step 7: Commit the release preparation**

```powershell
git add package.json package-lock.json server/export/markdown.js README.md CHANGELOG.md RELEASE_NOTES.md RELEASING.md test/export-markdown.test.js test/release-readiness.test.js
git commit -m "chore: prepare v0.0.13 release"
```

## Task 9: Full verification, review, integration, and public release

**Files:**

- Modify only files required by verified defects.

- [ ] **Step 1: Run static and full tests**

Run:

```powershell
npm run verify:version -- --tag v0.0.13
npm test
npm run test:e2e
```

Expected: zero failures.

- [ ] **Step 2: Run audits and notice verification**

Run:

```powershell
npm run audit:sources -- --strict
npm run audit:runtime
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
```

Expected: all enabled sources return non-empty results, no high-severity production dependency findings, and notices remain current.

- [ ] **Step 3: Build and verify the installer**

Run:

```powershell
npm run dist
npm run verify:package
npm run verify:version -- --tag v0.0.13 --artifacts
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.13.exe
```

Expected: build and package checks pass; signature status remains `NotSigned`.

- [ ] **Step 4: Perform requirement-by-requirement smoke verification**

In a clean temporary user-data directory:

- choose archive folder through the native dialog;
- cancel once and confirm switch stays off;
- enable and save current;
- verify Markdown, JSONL, manifest, hashes, and all-record count;
- restart and verify persisted state;
- simulate a missed date and verify catch-up;
- inspect positive and rejected breakthrough fixtures in the hot view;
- verify no regression in collection, daily view, search, star, memo, settings, tray, storage maintenance, and shutdown.

- [ ] **Step 5: Request code review**

Provide the reviewer:

```text
DESCRIPTION: v0.0.13 daily archive and evidence-gated breakthrough heat
PLAN_OR_REQUIREMENTS: this plan and the approved design spec
BASE_SHA: e573bb6
HEAD_SHA: current branch HEAD
```

Fix every Critical and Important finding, then rerun affected tests and the complete verification set.

- [ ] **Step 6: Confirm final Git scope**

Run:

```powershell
git status --short
git diff main...HEAD --stat
git log --oneline main..HEAD
```

Expected: only v0.0.13 design, plan, implementation, tests, docs, and release metadata.

- [ ] **Step 7: Fast-forward main and push**

From the main checkout:

```powershell
git merge --ff-only codex/v0.0.13-daily-brief
git push origin main
```

- [ ] **Step 8: Create and push the annotated release tag**

```powershell
git tag -a v0.0.13 -m "摘星阁 v0.0.13"
git push origin v0.0.13
```

- [ ] **Step 9: Wait for GitHub Actions and verify the public Release**

Confirm the release workflow succeeds and the public Release contains:

```text
Star-Picking-Pavilion-Setup-0.0.13.exe
Star-Picking-Pavilion-Setup-0.0.13.exe.blockmap
latest.yml
SHA256SUMS.txt
sbom.cdx.json
THIRD_PARTY_NOTICES.txt
```

Download assets into a new temporary directory and verify the installer hash against `SHA256SUMS.txt`.
