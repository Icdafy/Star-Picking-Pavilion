# Star-Picking-Pavilion v0.0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将摘星阁收口为安全、可迁移、可复现打包的 Windows 桌面应用，并在通过全部门禁后发布 `Icdafy/Star-Picking-Pavilion` 的首个版本 `v0.0.1`。

**Architecture:** Electron 主进程以单实例方式启动，在随机回环端口拉起 utility process，并通过启动期随机令牌保护本地 HTTP API；用户数据在服务启动前以一致性 SQLite 备份迁移。渲染层继续使用现有无框架页面，但补齐存储键迁移、键盘焦点恢复、URL/HTML 安全处理和 CSP。发布端使用严格文件白名单、ASAR 扫描、Windows 冒烟测试和 GitHub Actions 质量门生成首版安装包。

**Tech Stack:** Electron、Node.js 22+/`node:sqlite`、原生 HTTP、原生 HTML/CSS/JavaScript、Node test runner、Playwright Core、electron-builder、GitHub Actions/CLI。

---

## File map

- `config/brand.json`：唯一当前品牌、数据文件名、存储键和兼容旧标识清单。
- `electron/main.js`：单实例、随机端口服务握手、请求令牌注入、窗口安全、更新和退出生命周期。
- `electron/preload.js`：只读桌面能力桥，动态版本号，新旧全局对象兼容。
- `electron/user-data-migration.js`：幂等数据库/设置迁移与来源冲突选择。
- `electron/credential-store.js`：基于 Electron `safeStorage` 的加密 API Key 持久化。
- `server/index.js`：可测试的服务器启动/关闭和 utility-process ready/credential 消息。
- `server/http-security.js`：Host、Origin、令牌、JSON body、CSP 与 URL 校验。
- `server/config.js`：原子配置写入，非秘密设置与运行时 API Key 分离。
- `server/db.js`：新数据库名、兼容环境变量、完整性检查和可关闭句柄。
- `renderer/bootstrap.js`：CSP 兼容的主题早期初始化与旧 localStorage 键迁移。
- `renderer/dom-utils.js`：HTML 转义、HTTP(S) URL 规范化、焦点键恢复。
- `renderer/common-links.js`：新收藏键与旧键导入，14 条数据保持不变或按发布决策转为本地配置。
- `renderer/app.js`：安全渲染、焦点恢复、新 preload API 和更新错误反馈。
- `scripts/verify-version.js`：校验 package 版本、Git tag 和生成更新元数据一致。
- `scripts/verify-package.js`：ASAR 文件集合、体积、秘密和发布文件名门禁。
- `scripts/generate-third-party-notices.js`：从安装后的生产依赖生成第三方许可清单。
- `test/fixtures/yunwo-common-links.json`：来自云幄的 14 条完整对象基准。
- `test/*.test.js`：品牌、迁移、安全、配置、渲染、信源删除、打包和版本回归测试。
- `test/e2e/electron.test.js`：真实 Electron 启动、常用网址、焦点、单实例/本地服务冒烟。
- `README.md`、`RELEASING.md`、`LICENSE`、`CHANGELOG.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.txt`、`RELEASE_NOTES.md`：公开仓库与首版发布资料。
- `.github/workflows/ci.yml`、`.github/workflows/release.yml`：每次提交质量门和标签发布。

## Task 1: Create an isolated release worktree and prove the baseline

**Files:**
- No source changes.

- [ ] **Step 1: Detect existing worktree state and verify the local worktree directory is ignored**

Run:

```powershell
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --show-superproject-working-tree
git check-ignore .worktrees
```

Expected: the root checkout is not already a linked worktree, no superproject is reported, and `.worktrees` is ignored.

- [ ] **Step 2: Create the implementation branch in an isolated worktree**

Run:

```powershell
git worktree add '.worktrees\star-picking-pavilion-v0.0.1' -b 'release/star-picking-pavilion-v0.0.1'
npm ci
```

Expected: worktree exists on the release branch and dependency installation exits 0.

- [ ] **Step 3: Run the untouched baseline**

Run:

```powershell
npm test
node --check electron/main.js
node --check electron/preload.js
node --check server/index.js
node --check renderer/app.js
```

Expected: 16 tests pass and all syntax checks exit 0.

## Task 2: Lock exact Yunwo data and fix keyboard focus first

**Files:**
- Create: `test/fixtures/yunwo-common-links.json`
- Create: `renderer/dom-utils.js`
- Create: `test/dom-utils.test.js`
- Modify: `test/common-links.test.js`
- Modify: `test/renderer-integration.test.js`
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`

- [ ] **Step 1: Add failing data and focus tests**

The common-links test must use a committed fixture and require deep equality:

```js
const expectedLinks = JSON.parse(read('test/fixtures/yunwo-common-links.json'));
assert.deepEqual(LINKS, expectedLinks);
```

Add a DOM helper test for a stable focus key:

```js
test('returns the replacement control with the same focus key', () => {
  const replacement = { focusKey: 'favorite:work-plan' };
  assert.equal(findFocusReplacement([replacement], 'favorite:work-plan'), replacement);
});
```

Run:

```powershell
node --test test/common-links.test.js test/dom-utils.test.js test/renderer-integration.test.js
```

Expected: FAIL because the fixture/deep comparison and focus utility do not yet exist.

- [ ] **Step 2: Implement stable focus restoration and safe URL helpers**

`renderer/dom-utils.js` exports in Node and attaches `window.DomUtils` in a browser:

```js
function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch { return '#'; }
}

function restoreFocusByKey(container, key) {
  if (!key) return;
  const target = [...container.querySelectorAll('[data-focus-key]')]
    .find(node => node.dataset.focusKey === key);
  target?.focus();
}
```

Category and favorite buttons receive deterministic `data-focus-key` values. `renderCommonLinks(focusKey)` renders, then calls `restoreFocusByKey` synchronously; click handlers pass the triggering control key.

- [ ] **Step 3: Verify the focused behavior and exact data**

Run:

```powershell
node --test test/common-links.test.js test/dom-utils.test.js test/renderer-integration.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```powershell
git add renderer test
git commit -m "fix: preserve common-links data and keyboard focus"
```

## Task 3: Canonicalize the brand and migrate browser storage keys

**Files:**
- Create: `config/brand.json`
- Create: `renderer/bootstrap.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron/preload.js`
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`
- Modify: `renderer/common-links.js`
- Modify: `test/branding.test.js`
- Modify: `test/common-links.test.js`

- [ ] **Step 1: Replace the old compatibility assertions with failing canonical-brand tests**

Required assertions:

```js
assert.equal(pkg.name, 'star-picking-pavilion');
assert.equal(pkg.version, '0.0.1');
assert.equal(pkg.build.appId, 'com.icdafy.star-picking-pavilion');
assert.equal(pkg.build.executableName, 'Star-Picking-Pavilion');
assert.equal(pkg.build.win.artifactName, 'Star-Picking-Pavilion-Setup-${version}.${ext}');
assert.equal(pkg.build.nsis.guid, '5fea1cfe-e72e-5af6-9770-01a551e1f773');
assert.equal(pkg.build.publish[0].repo, 'Star-Picking-Pavilion');
assert.equal(STORAGE_KEY, 'star-picking-pavilion.common-links.favorites');
```

Also assert `云幄 · 常用网址` and all fixture objects remain unchanged. Run the two tests and confirm they fail against the old technical identifiers.

- [ ] **Step 2: Apply the exact identity map**

Use:

```json
{
  "displayName": "摘星阁",
  "englishName": "Star-Picking-Pavilion",
  "packageName": "star-picking-pavilion",
  "databaseName": "star-picking-pavilion.db",
  "storage": {
    "theme": "star-picking-pavilion.theme",
    "realtime": "star-picking-pavilion.realtime",
    "commonLinks": "star-picking-pavilion.common-links.favorites"
  }
}
```

Update package metadata, repository URLs, appId, executable name, artifact name and publish coordinates. Keep `productName`, shortcut and uninstall display name as `摘星阁`, and freeze the old NSIS GUID.

- [ ] **Step 3: Add one-time browser storage migration**

`renderer/bootstrap.js` reads the new key first, otherwise copies a validated old value:

```js
function migrateStorage(storage, currentKey, legacyKeys, validate = value => value != null) {
  if (storage.getItem(currentKey) != null) return storage.getItem(currentKey);
  for (const key of legacyKeys) {
    const value = storage.getItem(key);
    if (validate(value)) { storage.setItem(currentKey, value); return value; }
  }
  return null;
}
```

Load this external script before CSS/application scripts so the inline theme script can be removed for CSP. Preload exposes one frozen API object as `window.starPickingPavilion` and a temporary `window.windcatcher` compatibility alias; renderer always prefers the new name.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test
node --check renderer/bootstrap.js
node --check electron/preload.js
```

Expected: all tests pass.

```powershell
git add package.json package-lock.json config electron/preload.js renderer test
git commit -m "refactor: canonicalize Star-Picking-Pavilion identity"
```

## Task 4: Migrate databases and settings without losing WAL data

**Files:**
- Create: `electron/user-data-migration.js`
- Create: `test/user-data-migration.test.js`
- Modify: `electron/main.js`
- Modify: `server/db.js`

- [ ] **Step 1: Add failing migration tests for every source state**

Tests use temporary directories and real `node:sqlite` databases. Cover:

```js
test('backs up the current 摘星阁 legacy database into the canonical filename');
test('falls back to 捕风司 when it is the only source');
test('asks the injected chooser when both sources exist');
test('never overwrites an existing canonical database');
test('is idempotent and leaves source databases unchanged');
test('runs PRAGMA quick_check before accepting the migrated database');
```

Write a row after enabling WAL but before closing the source connection, then verify it exists after migration. Run the test and confirm failure because the migration module is absent.

- [ ] **Step 2: Implement consistent backup and a migration marker**

Use the Node SQLite backup API rather than copying files:

```js
const { DatabaseSync, backup } = require('node:sqlite');
const source = new DatabaseSync(sourcePath);
await backup(source, destinationPath);
const migrated = new DatabaseSync(destinationPath);
const check = migrated.prepare('PRAGMA quick_check').get();
if (check.quick_check !== 'ok') throw new Error('数据库完整性检查失败');
```

Write `migration-v0.0.1.json` atomically with source, destination, timestamp and status, but no secret values. If both `%APPDATA%\摘星阁\windcatcher.db` and `%APPDATA%\捕风司\windcatcher.db` exist, main injects a `dialog.showMessageBox` chooser; cancellation leaves both untouched and stops startup with a clear message.

- [ ] **Step 3: Switch the server to the canonical database and explicit userData path**

Main fixes `userData` to `%APPDATA%\摘星阁`, passes `STAR_PICKING_PAVILION_DATA_DIR`, and only starts the server after migration. `server/db.js` resolves new env first, old env only as compatibility fallback, opens `star-picking-pavilion.db`, enables foreign keys, and exports `closeDatabase()`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
node --test test/user-data-migration.test.js
npm test
```

Expected: all migration scenarios and the full suite pass.

```powershell
git add electron server/db.js test
git commit -m "feat: migrate legacy user data safely"
```

## Task 5: Authenticate the loopback API and use a verified random-port handshake

**Files:**
- Create: `server/http-security.js`
- Create: `test/http-security.test.js`
- Create: `test/server-security.test.js`
- Create: `test/helpers/server-child.js`
- Modify: `server/index.js`
- Modify: `electron/main.js`

- [ ] **Step 1: Add failing security unit and integration tests**

Cover exact negative behavior:

```js
assert.equal(authorize({ host: 'evil.test', token: SECRET }), false);
assert.equal(authorize({ host: `127.0.0.1:${port}`, token: 'wrong' }), false);
assert.equal(validateAiBaseUrl('http://attacker.example'), false);
assert.equal(validateAiBaseUrl('https://api.deepseek.com'), true);
assert.equal(validateAiBaseUrl('http://127.0.0.1:11434'), true);
```

Spawn a real server on port `0` and assert an unauthenticated `POST /api/settings` is `403`, a cross-origin request receives no wildcard CORS header, a non-JSON body is `415`, and a body over 64 KiB is `413`. Confirm the tests fail against the current server.

- [ ] **Step 2: Implement strict request validation**

`http-security.js` must:

```js
const API_TOKEN_HEADER = 'x-star-picking-pavilion-token';
const MAX_JSON_BYTES = 64 * 1024;
```

- Require the exact loopback `Host` and actual port.
- Require the launch token whenever configured.
- In tokenless standalone development, accept only absent/same-origin Origin.
- Never emit `Access-Control-Allow-Origin: *`.
- Require `application/json` for body-bearing API requests and abort above the limit.
- Accept AI base URLs only over HTTPS, except HTTP loopback hosts.

- [ ] **Step 3: Replace polling with utility-process ready IPC**

The child listens on port `0`, then posts:

```js
process.parentPort?.postMessage({ type: 'server:ready', port, nonce });
```

Main accepts ready only from the spawned process and only when the nonce equals its cryptographically random launch nonce. It installs a `session.webRequest.onBeforeSendHeaders` filter for `http://127.0.0.1:${port}/api/*` that adds the token. Navigation checks compare `new URL(url).origin` with the exact expected origin.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
node --test test/http-security.test.js test/server-security.test.js
npm test
```

Expected: unauthorized and cross-origin tests pass, as does the full suite.

```powershell
git add electron/main.js server test
git commit -m "fix: secure the local API boundary"
```

## Task 6: Encrypt the AI key and make settings writes atomic

**Files:**
- Create: `electron/credential-store.js`
- Create: `server/runtime-credentials.js`
- Create: `test/credential-store.test.js`
- Modify: `electron/main.js`
- Modify: `server/config.js`
- Modify: `server/index.js`
- Modify: `server/ai/deepseek.js`

- [ ] **Step 1: Add failing credential and settings tests**

Use an injected fake `safeStorage` implementation and assert:

```js
await store.set('sk-test-secret');
assert.equal(await store.get(), 'sk-test-secret');
assert.doesNotMatch(fs.readFileSync(secretFile, 'utf8'), /sk-test-secret/);
```

Also assert saved `settings.json` never contains `ai.apiKey`, a base URL change clears the in-memory key unless the same request supplies a replacement, and a failed atomic rename preserves the prior valid file.

- [ ] **Step 2: Implement the credential broker**

Main encrypts/decrypts a small secret envelope with Electron `safeStorage`. Server receives the decrypted key only in its launch environment and memory. When the settings API changes the key, the utility process sends a credential message to main and waits for an acknowledged success/failure; no key is logged or returned to renderer.

Legacy plaintext `settings.ai.apiKey` is migrated on first load: persist through the broker, remove it from the JSON, atomically rewrite the settings file, and retain a timestamped backup until the new encrypted value has been verified.

- [ ] **Step 3: Verify and commit**

Run:

```powershell
node --test test/credential-store.test.js test/config.test.js
npm test
```

Expected: all tests pass and a repository scan outside ignored user-data folders finds no non-placeholder `sk-` value.

```powershell
git add electron server test
git commit -m "fix: protect local AI credentials"
```

## Task 7: Harden rendering, CSP, permissions and source deletion

**Files:**
- Create: `test/source-lifecycle.test.js`
- Modify: `renderer/app.js`
- Modify: `renderer/index.html`
- Modify: `server/index.js`
- Modify: `server/http-security.js`
- Modify: `electron/main.js`
- Modify: `test/renderer-integration.test.js`

- [ ] **Step 1: Add failing tests for XSS-safe URLs, CSP and soft deletion**

Tests require `safeHttpUrl('javascript:alert(1)') === '#'`, no inline `<script>` or `onerror=` remains, static responses contain a CSP with `script-src 'self'`, and DELETE updates `sources.enabled = 0` without deleting the row or orphaning articles.

- [ ] **Step 2: Implement defense in depth**

- Route every remote/user-provided `href` and `src` through `safeHttpUrl`.
- Keep text interpolation behind `esc`; remove inline event handlers.
- Serve CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and frame denial.
- Set `sandbox: true`, deny all permission requests by default, and handle `render-process-gone` with a recoverable failure page.
- Change source DELETE into a soft disable and make the UI wording match.
- Initialize auto-update independently of backend success and expose update errors in the existing status pill.

- [ ] **Step 3: Verify and commit**

Run:

```powershell
node --test test/dom-utils.test.js test/source-lifecycle.test.js test/renderer-integration.test.js
npm test
```

Expected: all tests pass.

```powershell
git add electron server renderer test
git commit -m "fix: harden the desktop runtime and renderer"
```

## Task 8: Add single-instance and graceful server lifecycle behavior

**Files:**
- Create: `electron/server-process.js`
- Create: `test/server-process.test.js`
- Modify: `electron/main.js`
- Modify: `server/index.js`
- Modify: `server/scheduler.js`

- [ ] **Step 1: Add failing lifecycle tests**

Test that a second-instance callback restores/minimizes/focuses the existing window, an unexpected child exit is surfaced, and shutdown asks the server to stop scheduler/HTTP/SQLite before force-killing after a bounded timeout.

- [ ] **Step 2: Implement lifecycle control**

Acquire `app.requestSingleInstanceLock()` before `whenReady`; quit immediately if unavailable. On `second-instance`, restore and focus the existing window. Utility process handles `{type:'server:shutdown'}`, stops scheduler, closes HTTP, closes SQLite, posts `server:stopped`, and exits. Main waits up to five seconds before kill fallback and ensures shutdown only runs once.

- [ ] **Step 3: Verify and commit**

Run:

```powershell
node --test test/server-process.test.js
npm test
```

Expected: all tests pass.

```powershell
git add electron server test
git commit -m "fix: make desktop lifecycle reliable"
```

## Task 9: Update dependencies and enforce a clean package boundary

**Files:**
- Create: `scripts/verify-package.js`
- Create: `test/package-verifier.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add failing package-policy tests**

The verifier test feeds a fake ASAR entry list and requires rejection of:

```js
['/.worktrees/x', '/data/app.db', '/test/a.test.js', '/dist/win-unpacked/x', '/logs/run.log']
```

It must accept only the declared application directories, production dependencies, and package metadata. Add filename and maximum-size assertions.

- [ ] **Step 2: Upgrade and lock dependencies**

Use current compatible releases verified from official npm metadata. At minimum remove the known vulnerable `node-cron`/`uuid` and `undici` versions, update Electron to a supported stable patch, and update electron-builder. Run scheduler tests immediately after the `node-cron` major upgrade.

- [ ] **Step 3: Replace broad globs with a production allowlist**

The builder config contains:

```json
"files": [
  "electron/**/*",
  "server/**/*",
  "renderer/**/*",
  "config/**/*",
  "package.json",
  "!**/*.map",
  "!**/*.test.js"
],
"electronLanguages": ["zh-CN", "en-US"]
```

Remove `asarUnpack` unless the clean packaged runtime proves it necessary. Add `verify:package` and `audit:runtime` scripts. Explicitly ignore `*.db*`, logs, screenshots, local common-link overrides and verification outputs.

- [ ] **Step 4: Verify dependency and package policy**

Run:

```powershell
npm test
npm audit --omit=dev --audit-level=high
npm run dist
npm run verify:package
```

Expected: tests pass, runtime audit reports zero high/critical vulnerabilities, the installer has the expected name, ASAR is below 12 MiB, the installer is below 110 MiB, and no forbidden file/secret is present.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json .gitignore scripts test
git commit -m "build: create a minimal verified Windows package"
```

## Task 10: Add real Electron smoke coverage

**Files:**
- Create: `test/e2e/electron.test.js`
- Create: `test/e2e/fixtures/empty-settings.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing Electron test**

Launch Electron with a temporary data directory and scheduler/updater disabled. Assert:

```js
assert.equal(await page.locator('.common-links-card').count(), 14);
await category.focus();
await category.click();
assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), expectedKey);
```

Also verify window title, exact origin is loopback with a non-7644 random port, an unauthenticated fetch from Node receives `403`, favorites survive reload, external `javascript:` links cannot open, and a second launch does not create a second app window.

- [ ] **Step 2: Make only testability changes required by the smoke test**

Support these test-only environment controls without changing production defaults:

```text
STAR_PICKING_PAVILION_TEST_DATA_DIR
STAR_PICKING_PAVILION_NO_SCHEDULER=1
STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE=1
```

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm run test:e2e
npm test
```

Expected: Electron smoke test and unit/integration suite pass.

```powershell
git add package.json test/e2e electron server
git commit -m "test: cover the packaged desktop flow"
```

## Task 11: Resolve the public common-links publication gate

**Files (safe-private option):**
- Create: `config/common-links.example.json`
- Create: `renderer/common-links-loader.js`
- Modify: `.gitignore`
- Modify: `renderer/common-links.js`
- Remove: historical plan/spec files that contain private URLs from the public snapshot.

**Files (explicit-public option):**
- No data changes; keep the exact fixture and list.

- [ ] **Step 1: Require an explicit informed user answer before any public push**

Accepted answer A: `原样公开 14 个网址`. In this case keep the exact 14-object fixture/list and record that the user authorized publication after the internal-share-link warning.

Accepted answer B: `改为本地私有配置，公开仓库不含内部网址`. In this case implement a local ignored JSON override and ship a neutral schema/example; migrate the current machine's 14 items into the ignored local file so this installation retains full behavior.

- [ ] **Step 2: Test the selected policy**

For A, deep equality against the 14-object fixture must pass. For B, tests must prove the loader uses local data when present, safe sample data otherwise, and no internal host/share URL exists in tracked files or Git objects destined for the new public repository.

- [ ] **Step 3: Commit the selected policy**

```powershell
git add -A
git commit -m "security: define common-links publication policy"
```

## Task 12: Complete public documentation, licensing and CI gates

**Files:**
- Create: `LICENSE`
- Create: `CHANGELOG.md`
- Create: `SECURITY.md`
- Create: `THIRD_PARTY_NOTICES.txt`
- Create: `RELEASE_NOTES.md`
- Create: `scripts/verify-version.js`
- Create: `scripts/generate-third-party-notices.js`
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Rewrite: `README.md`
- Rewrite: `RELEASING.md`
- Modify: `package.json`

- [ ] **Step 1: Add failing version/workflow tests**

Require `v0.0.1`, package `0.0.1`, installer `0.0.1` and `latest.yml` `0.0.1` to match. Assert release workflow runs unit tests, E2E, runtime audit, build, ASAR verification, SHA-256 and SBOM generation before `gh release create`.

- [ ] **Step 2: Write user and maintainer documentation**

README includes Windows 10/11 x64 requirements, install steps, unsigned SmartScreen warning, SHA-256 verification, features, `云幄 · 常用网址` attribution, local data paths, uninstall retention, backup/recovery, AI privacy disclosure, security model, development commands, license and Release link. State plainly that enabling AI sends selected text to the user-configured model service.

Add the full MIT text, changelog and v0.0.1 release notes. Generate third-party notices from installed production dependency metadata and generate CycloneDX SBOM in CI.

- [ ] **Step 3: Implement CI and release gates**

`ci.yml` runs on pushes/PRs. `release.yml` runs only on `v*`, verifies tag/package equality, runs all tests and audit, builds once on `windows-latest`, verifies the package, generates `SHA256SUMS.txt` and `sbom.cdx.json`, then creates the release with installer, blockmap, `latest.yml`, checksums, SBOM and notices. No release command executes before all prior steps succeed.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm run verify:version -- --tag v0.0.1
npm run notices
npm test
npm run test:e2e
npm audit --omit=dev --audit-level=high
npm run dist
npm run verify:package
```

Expected: every command exits 0 and documentation contains no stale repository/product coordinates.

```powershell
git add .github scripts package.json README.md RELEASING.md LICENSE CHANGELOG.md SECURITY.md THIRD_PARTY_NOTICES.txt RELEASE_NOTES.md test
git commit -m "docs: prepare the v0.0.1 public release"
```

## Task 13: Review, merge to local main, build from clean state and test installation

**Files:**
- No new planned source files; fixes found by review receive their own regression test and commit.

- [ ] **Step 1: Run two independent reviews**

Dispatch one reviewer for requirements/security/privacy and one for code/package/runtime. Resolve every actionable issue via a failing test, minimal fix and focused commit.

- [ ] **Step 2: Run the complete verification matrix**

Run:

```powershell
git diff --check main...HEAD
npm ci
npm test
npm run test:e2e
npm audit --omit=dev --audit-level=high
npm run dist
npm run verify:package
Get-AuthenticodeSignature 'dist\Star-Picking-Pavilion-Setup-0.0.1.exe'
```

Expected: clean diff, all tests green, runtime audit below the high threshold, clean package checks pass, and Authenticode reports `NotSigned` as explicitly documented for this release.

- [ ] **Step 3: Install and smoke test the exact installer**

Install as the current non-admin user to a temporary explicit directory, launch without a system Node installation dependency, verify UI/API/data migration/second-instance/exit, then uninstall. Confirm user data remains because `deleteAppDataOnUninstall` is false. Preserve old data directories and do not use them as destructive test targets.

- [ ] **Step 4: Merge the release branch to local main**

Run from the root checkout:

```powershell
git status --short
git merge --ff-only release/star-picking-pavilion-v0.0.1
```

Expected: local `main` fast-forwards and remains clean.

## Task 14: Publish the new repository and v0.0.1 release

**Files:**
- Git metadata and GitHub external state only.

- [ ] **Step 1: Reconfirm release authorization gates**

Do not continue unless the common-link publication answer from Task 11 is explicit, all P0 issues are fixed, no secret scan finding remains in the exact commit to be pushed, and the user has accepted an unsigned first release.

- [ ] **Step 2: Integrate the new repository without losing its initial commit**

Preserve the old remote as `legacy`, point `origin` to the new repository, fetch new `main`, and use a non-force merge when the selected publication policy permits existing history. If the safe-private policy is selected and historical commits contain private URLs, construct a clean public snapshot after preserving a local backup branch; never push those historical objects to the public remote.

- [ ] **Step 3: Push main and trigger release**

Run only after verifying exact targets:

```powershell
git push origin main
git tag -a v0.0.1 -m "摘星阁 v0.0.1"
git push origin v0.0.1
```

- [ ] **Step 4: Monitor GitHub Actions to completion**

Use `gh run list`, `gh run watch --exit-status` and `gh release view v0.0.1`. If the workflow fails, diagnose from logs, add a regression/verification fix, create a replacement tag only after removing the failed unpublished tag/release state in a recoverable, exact-target manner.

- [ ] **Step 5: Download and re-verify public assets**

Download the public Release into a fresh temporary directory, verify SHA-256 against `SHA256SUMS.txt`, inspect asset names, and smoke-launch/install the downloaded installer. Confirm GitHub `main` and local `main` resolve to the same intended source snapshot (or document the clean-snapshot mapping if privacy required it).

## Task 15: Remove only regenerable local bloat

**Files:**
- Local ignored/generated paths only.

- [ ] **Step 1: Resolve and validate exact cleanup targets**

Targets may include only:

```text
F:\摘星阁\dist\win-unpacked
F:\摘星阁\dist\builder-debug.yml
F:\摘星阁\dist\builder-effective-config.yaml
F:\摘星阁\.playwright-cli
F:\摘星阁\.worktrees\star-picking-pavilion-v0.0.1
F:\摘星阁\node_modules
```

Keep the final installer/checksum locally if desired. Never target `F:\摘星阁\data`, `%APPDATA%\摘星阁`, `%APPDATA%\捕风司`, `F:\云幄` or any SQLite `-wal`/`-shm` file.

- [ ] **Step 2: Remove only verified regenerable items and report recovery**

Use native PowerShell `Remove-Item -LiteralPath` only after checking every resolved absolute path stays within `F:\摘星阁` and is in the allowlist above. Report what was removed and that dependencies/build output are recoverable via `npm ci` and `npm run dist`; user data was untouched.

- [ ] **Step 3: Final state verification**

Run:

```powershell
git status --short
git log -1 --oneline
gh repo view Icdafy/Star-Picking-Pavilion
gh release view v0.0.1 --repo Icdafy/Star-Picking-Pavilion
```

Expected: clean local `main`, expected final commit, correct public repository, and accessible v0.0.1 Release.

