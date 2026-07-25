# 摘星阁 v0.0.9 全尺寸自适应排版与可靠性复查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将摘星阁升级为 v0.0.9，使真实 Electron 窗口可缩小到约 800×600，并让四档界面缩放、全部核心视图和启用信源通过完整验证。

**Architecture:** 保留 v0.0.8 的视觉和排版令牌，以 `body` 内联尺寸容器、内容驱动网格、可换行功能组和受控浮层替换固定像素断点；通过静态契约测试与真实 Electron 尺寸矩阵共同防止回归。信源复查复用现有采集器和隔离数据目录，输出结构化审计结果，不污染用户数据库。

**Tech Stack:** Electron 42、Node.js 22 test runner、Playwright Electron、原生 HTML/CSS/JavaScript、SQLite、GitHub Actions。

---

## 文件结构

- Create: `test/responsive-layout.test.js` — 响应式 CSS 与 Electron 最小窗口的静态契约。
- Create: `test/e2e/layout.test.js` — 真实 Electron 的窗口 × 缩放 × 视图矩阵。
- Create: `scripts/audit-sources.js` — 在隔离数据库中调用现有采集器并汇总启用信源实时状态。
- Create: `test/source-audit.test.js` — 信源审计汇总与退出码行为。
- Modify: `electron/main.js` — 将最小窗口降为 800×600。
- Modify: `renderer/styles.css` — 内容驱动的顶栏、导航、网格、热点区、表单和浮层布局。
- Modify: `package.json` / `package-lock.json` — v0.0.9 与信源审计命令。
- Modify: `test/branding.test.js`、`test/package-verifier.test.js`、`test/release-readiness.test.js` — v0.0.9 发布契约。
- Modify: `README.md`、`CHANGELOG.md`、`RELEASE_NOTES.md`、`RELEASING.md` — 使用、升级和发布说明。

### Task 1: 建立干净基线与最小窗口契约

**Files:**
- Create: `test/responsive-layout.test.js`
- Modify: `electron/main.js:181-186`

- [ ] **Step 1: 确认当前目录和基线**

Run:

```powershell
git status --short --branch
npm test
npm run test:e2e
```

Expected: 已知的 `output/` 保持未跟踪且不纳入提交；单元测试和真实 Electron E2E 均为 0 failures。

- [ ] **Step 2: 写入会失败的最小窗口与布局容器测试**

Create `test/responsive-layout.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

test('桌面窗口允许缩小到 800×600', () => {
  assert.match(main, /minWidth:\s*800,/);
  assert.match(main, /minHeight:\s*600,/);
  assert.doesNotMatch(main, /minWidth:\s*1080,/);
});

test('应用建立按实际内容宽度计算的内联尺寸容器', () => {
  assert.match(css, /body\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(css, /body\s*\{[^}]*container-name:\s*app;/s);
  assert.match(css, /@container\s+app\s*\(max-width:/);
});
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```powershell
node --test test/responsive-layout.test.js
```

Expected: FAIL，明确指出 `minWidth: 800` 或 `container-type: inline-size` 尚不存在。

- [ ] **Step 4: 只修改 Electron 最小窗口**

Modify `electron/main.js`:

```js
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 600,
```

保留窗口默认尺寸、安全首选项、显示逻辑和其余生命周期代码不变。

- [ ] **Step 5: 暂不伪造 GREEN**

Run:

```powershell
node --test test/responsive-layout.test.js
```

Expected: 最小窗口断言通过，内容容器断言继续 FAIL；该失败由 Task 2 解决。

### Task 2: 测试先行实现完整自适应堆叠

**Files:**
- Modify: `test/responsive-layout.test.js`
- Create: `test/e2e/layout.test.js`
- Modify: `renderer/styles.css`
- Test: `test/typography.test.js`

- [ ] **Step 1: 扩充静态响应式契约**

Append to `test/responsive-layout.test.js`:

```js
test('核心网格可在自身最小宽度不足时自动降为单栏', () => {
  for (const selector of ['common-links-grid', 'src-list']) {
    assert.match(
      css,
      new RegExp(`\\.${selector}[^}]*grid-template-columns:\\s*repeat\\(auto-fit,\\s*minmax\\(min\\(100%,`),
      `${selector} 必须使用不会撑破容器的内在尺寸网格`
    );
  }
  assert.match(css, /\.settings-grid[^}]*grid-template-columns:\s*repeat\(auto-fit,/);
});

test('热点区在窄容器中降栏但不被隐藏', () => {
  assert.doesNotMatch(css, /@(?:media|container)[^{]+\{[^{}]*\.hot-rail\s*\{\s*display:\s*none;/s);
  assert.match(css, /@container\s+app[^{]+\{[\s\S]*?\.feed-layout\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('顶栏、导航、筛选和动作组均允许受控换行', () => {
  for (const selector of [
    'tower',
    'tower-actions',
    'nav',
    'nav-tabs',
    'nav-filters',
    'feed-toolbar',
    'daily-actions',
    'btn-row'
  ]) {
    assert.match(
      css,
      new RegExp(`\\.${selector}\\s*\\{[^}]*flex-wrap:\\s*wrap;`, 's'),
      `${selector} 缺少 flex-wrap`
    );
  }
});

test('表单、长文本和浮层不会撑破可用空间', () => {
  assert.match(css, /\.field input,\s*\.field select,\s*\.field textarea\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
  assert.match(css, /\.glass-dialog\s*\{[^}]*max-height:\s*min\(92vh,\s*45rem\);[^}]*overflow:\s*auto;/s);
  assert.match(css, /\.hint,[\s\S]*?overflow-wrap:\s*anywhere;/);
});
```

- [ ] **Step 2: 写入真实 Electron 尺寸矩阵测试**

Create `test/e2e/layout.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..', '..');
const fixture = path.join(__dirname, 'fixtures', 'empty-settings.json');
const WINDOWS = [
  { width: 800, height: 600 },
  { width: 1080, height: 680 },
  { width: 1440, height: 920 },
  { width: 1920, height: 1080 }
];
const SCALES = ['sm', 'md', 'lg', 'xl'];
const VIEWS = ['featured', 'daily', 'links', 'sources', 'settings'];

test('全部窗口、缩放和核心视图无横向溢出且主导航完整可见', { timeout: 120_000 }, async t => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-layout-'));
  await fs.promises.copyFile(fixture, path.join(dataDir, 'settings.json'));
  const app = await electron.launch({
    args: ['.', '--hidden'],
    cwd: projectRoot,
    env: {
      ...process.env,
      STAR_PICKING_PAVILION_TEST_DATA_DIR: dataDir,
      STAR_PICKING_PAVILION_NO_SCHEDULER: '1',
      STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1'
    }
  });
  t.after(async () => {
    await app.close().catch(() => {});
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  const page = await app.firstWindow();
  await page.waitForSelector('.nav');
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize()),
    [800, 600]
  );

  for (const size of WINDOWS) {
    await app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0].setSize(value.width, value.height);
    }, size);
    for (const scale of SCALES) {
      await page.evaluate(value => {
        document.documentElement.dataset.uiScale = value;
        window.dispatchEvent(new Event('resize'));
      }, scale);
      for (const view of VIEWS) {
        await page.locator(`.tab[data-view="${view}"]`).click();
        await page.waitForTimeout(40);
        const result = await page.evaluate(() => {
          const navTabs = [...document.querySelectorAll('.nav-tabs .tab')];
          const interactive = [...document.querySelectorAll(
            'button:not([hidden]), a[href]:not([hidden]), input:not([hidden]), select:not([hidden]), textarea:not([hidden])'
          )].filter(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
          const overflowers = interactive.map(element => {
            const rect = element.getBoundingClientRect();
            return {
              id: element.id,
              className: String(element.className || ''),
              text: String(element.textContent || element.value || '').trim().slice(0, 40),
              left: rect.left,
              right: rect.right
            };
          }).filter(item => item.left < -1 || item.right > innerWidth + 1);
          return {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            visibleTabs: navTabs.filter(tab => {
              const rect = tab.getBoundingClientRect();
              const style = getComputedStyle(tab);
              return style.display !== 'none' && rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1;
            }).length,
            overflowers
          };
        });
        const label = `${size.width}×${size.height}/${scale}/${view}`;
        assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label} 文档横向溢出`);
        assert.equal(result.visibleTabs, 8, `${label} 主导航不完整`);
        assert.deepEqual(result.overflowers, [], `${label} 存在交互元素越界`);
      }
    }
  }
});
```

- [ ] **Step 3: 运行响应式测试并确认 RED**

Run:

```powershell
node --test test/responsive-layout.test.js
node --test test/e2e/layout.test.js
```

Expected: 静态测试因缺少容器与内在网格失败；真实 Electron 测试至少在 `800×600` 或 `xl` 组合失败。

- [ ] **Step 4: 建立应用级内联尺寸容器**

Modify the existing `body` declaration in `renderer/styles.css`:

```css
body {
  min-height: 100%;
  container-type: inline-size;
  container-name: app;
}
```

保留 `html { height: 100%; }`、主题、根字号和滚动行为。

- [ ] **Step 5: 把核心网格改成安全的内在尺寸**

Use these declarations in `renderer/styles.css`:

```css
.common-links-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17.8rem), 1fr));
  gap: var(--sp-4);
}
.src-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 23.75rem), 1fr));
  gap: var(--sp-3);
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 34rem), 1fr));
  gap: var(--sp-4);
  align-items: start;
}
```

Remove the now-redundant fixed `980px` settings breakpoint.

- [ ] **Step 6: 让功能组按内容换行并允许子项收缩**

Update `renderer/styles.css` so the affected declarations include:

```css
.tower { display: flex; flex-wrap: wrap; }
.tower-actions { flex: 1 1 24rem; min-width: 0; flex-wrap: wrap; justify-content: flex-end; }
.searchbox { flex: 1 1 14rem; min-width: min(100%, 12rem); max-width: 24rem; }
.nav,
.nav-tabs,
.nav-filters,
.feed-toolbar,
.daily-actions,
.btn-row { flex-wrap: wrap; }
.field input, .field select, .field textarea { min-width: 0; width: 100%; }
.hint,
.src-meta,
.common-links-card > p,
.daily-title p,
.feed-banner { overflow-wrap: anywhere; }
.glass-dialog { max-height: min(92vh, 45rem); overflow: auto; }
```

Do not change font families, font scale tokens, colors, animations or semantic order.

- [ ] **Step 7: 用缩放感知的容器查询替换固定像素布局断点**

Keep `@media (prefers-reduced-motion: reduce)` as a media query. Convert width-only layout rules to named container queries:

```css
@container app (max-width: 77.5rem) { /* former 1240px behavior */ }
@container app (max-width: 68.75rem) { /* former 1100px behavior */ }
@container app (max-width: 67.5rem) {
  .feed-layout { grid-template-columns: 1fr; }
  .hot-rail { position: relative; top: auto; max-height: none; }
}
@container app (max-width: 53.75rem) { /* former 860px behavior */ }
@container app (max-width: 45rem) { /* former 720px behavior */ }
@container app (max-width: 35rem) { /* former 560px behavior */ }
```

Delete `.hot-rail { display: none; }`. At the `67.5rem` threshold the hotspot rail becomes a full-width block beneath the feed.

- [ ] **Step 8: 运行 GREEN 与排版回归**

Run:

```powershell
node --test test/responsive-layout.test.js test/typography.test.js
node --test test/e2e/layout.test.js
```

Expected: all tests pass, no warnings or unhandled rejections.

- [ ] **Step 9: 提交响应式实现**

```powershell
git add -- electron/main.js renderer/styles.css test/responsive-layout.test.js test/e2e/layout.test.js
git diff --cached --check
git commit -m "feat: make v0.0.9 layout fully responsive"
```

### Task 3: 增加可复用信源审计并复查核心功能

**Files:**
- Create: `scripts/audit-sources.js`
- Create: `test/source-audit.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify only if a verified source defect exists: `config/sources.default.json`
- Modify only with a failing regression test: the exact module responsible for any discovered functional defect

- [ ] **Step 1: 先写信源审计汇总测试**

Create `test/source-audit.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSourceResults } = require('../scripts/audit-sources');

test('信源审计区分正常、空结果和失败且保留明细', () => {
  const summary = summarizeSourceResults([
    { source: '正常源', fetched: 3, added: 2, ms: 50 },
    { source: '空结果源', fetched: 0, added: 0, ms: 20 },
    { source: '失败源', error: 'HTTP 404', consecutiveErrors: 1 }
  ]);
  assert.deepEqual(summary.counts, { total: 3, ok: 1, empty: 1, failed: 1 });
  assert.deepEqual(summary.failed, [{ source: '失败源', error: 'HTTP 404' }]);
  assert.deepEqual(summary.empty, [{ source: '空结果源', fetched: 0 }]);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/source-audit.test.js
```

Expected: FAIL with `Cannot find module '../scripts/audit-sources'`.

- [ ] **Step 3: 实现隔离的信源审计脚本**

Create `scripts/audit-sources.js`:

```js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function summarizeSourceResults(results) {
  const ok = [];
  const empty = [];
  const failed = [];
  for (const result of results) {
    if (result.error) failed.push({ source: result.source, error: result.error });
    else if (Number(result.fetched) === 0) empty.push({ source: result.source, fetched: 0 });
    else ok.push({ source: result.source, fetched: result.fetched, added: result.added, ms: result.ms });
  }
  return {
    auditedAt: new Date().toISOString(),
    counts: { total: results.length, ok: ok.length, empty: empty.length, failed: failed.length },
    ok,
    empty,
    failed
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runAudit(options = {}) {
  const temporary = !process.env.STAR_PICKING_PAVILION_DATA_DIR;
  const dataDir = process.env.STAR_PICKING_PAVILION_DATA_DIR
    || await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-source-audit-'));
  process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
  const { collectAll } = require('../server/collectors');
  const { closeDatabase } = require('../server/db');
  try {
    const collection = await collectAll(undefined, { force: true });
    const summary = summarizeSourceResults(collection.results);
    const output = options.output ? path.resolve(options.output) : null;
    if (output) {
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      await fs.promises.writeFile(output, JSON.stringify(summary, null, 2), 'utf8');
    }
    return summary;
  } finally {
    closeDatabase();
    if (temporary) await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runAudit({ output: argumentValue(process.argv.slice(2), '--output') })
    .then(summary => {
      console.log(JSON.stringify(summary, null, 2));
      if (process.argv.includes('--strict') && summary.counts.failed > 0) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runAudit, summarizeSourceResults };
```

- [ ] **Step 4: 注册命令并验证单元测试**

Add to `package.json` scripts:

```json
"audit:sources": "node scripts/audit-sources.js"
```

Run:

```powershell
npm install --package-lock-only --ignore-scripts
node --test test/source-audit.test.js
```

Expected: PASS and lockfile remains synchronized with the package manifest.

- [ ] **Step 5: 运行全部启用信源实时审计**

Run:

```powershell
npm run audit:sources -- --output output/v0.0.9-source-audit.json
```

Expected: exactly 103 enabled sources are classified as `ok`, `empty`, or `failed`; user database remains untouched.

For each `failed` or persistent `empty` entry:

1. Re-run only the failing source through its existing adapter.
2. Verify the current official URL or feed with a direct network request.
3. Classify transient timeout / rate limit separately from address or selector failure.
4. Change `config/sources.default.json` only when the upstream move or parser break is confirmed.
5. Add a focused regression to the relevant collector or migration test before the fix.

- [ ] **Step 6: 运行核心功能与安全回归**

Run:

```powershell
npm test
npm run test:e2e
```

Expected: all unit/integration tests and both real Electron suites pass. If a defect appears, invoke systematic debugging, add a failing regression test, implement the minimal fix, and rerun the targeted test before returning to this step.

- [ ] **Step 7: 提交审计能力与经证实的修复**

```powershell
git add -- package.json package-lock.json scripts/audit-sources.js test/source-audit.test.js
git add -- config/sources.default.json
git diff --cached --check
git commit -m "test: audit v0.0.9 sources and core flows"
```

Omit `config/sources.default.json` from staging when the live audit finds no confirmed configuration defect. Never stage `output/`.

### Task 4: 升级 v0.0.9 版本与公开文档

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/branding.test.js`
- Modify: `test/package-verifier.test.js`
- Modify: `test/release-readiness.test.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Replace: `RELEASE_NOTES.md`
- Modify: `RELEASING.md`

- [ ] **Step 1: 先把发布契约改为 v0.0.9**

Replace release-specific `0.0.8` expectations with `0.0.9` in:

- `test/branding.test.js` package identity assertion.
- `test/package-verifier.test.js` expected installer name.
- `test/release-readiness.test.js` package, lockfile, latest.yml, installer, tag and README assertions.

Add these v0.0.9 release-note assertions:

```js
assert.match(read('CHANGELOG.md'), /\[0\.0\.9\].*2026-07-25/);
assert.match(
  read('RELEASE_NOTES.md'),
  /v0\.0\.9[\s\S]*800×600[\s\S]*完整自适应[\s\S]*信源[\s\S]*未签名/
);
```

Keep the historical v0.0.8 changelog assertion.

- [ ] **Step 2: 运行发布契约并确认 RED**

Run:

```powershell
node --test test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
```

Expected: FAIL because package and public documentation are still v0.0.8.

- [ ] **Step 3: 更新包版本**

Run:

```powershell
npm version 0.0.9 --no-git-tag-version
```

Expected: `package.json`、`package-lock.json` 与 lockfile 根包条目均为 `0.0.9`。

- [ ] **Step 4: 更新公开文档**

Update `README.md`:

- Installer name and hash example use `Star-Picking-Pavilion-Setup-0.0.9.exe`.
- Add a “v0.0.9 自适应排版” paragraph describing 800×600, four scales, full navigation, automatic single-column fallback and preserved data.
- Release verification example uses `v0.0.9`.

Prepend to `CHANGELOG.md`:

```markdown
## [0.0.9] - 2026-07-25

### Changed

- 桌面窗口最小尺寸调整为约 800×600；顶栏、导航、筛选器和主要内容网格改为按实际内容宽度自适应重排。
- 八个主导航始终完整可见；热点、设置、信源、网址与日报在空间不足时自动降栏，不再依赖固定像素断点。

### Fixed

- 修复“大 / 特大”缩放下组件已放大但固定像素断点未提前触发，导致顶栏过高、正文首屏受压和局部控件挤压的问题。

### Tests

- 新增真实 Electron 窗口 × 四档缩放 × 核心视图矩阵，并完成核心功能、全部启用信源、构建与安装包复查。
```

Replace `RELEASE_NOTES.md` with a v0.0.9 document covering:

- 800×600 and complete adaptive stacking.
- Window size × scale behavior.
- Full navigation and hotspot fallback.
- Core functional regression and live source audit counts.
- No database schema, credential, scoring or retention change.
- Unsigned installer and checksum instructions.

Replace release-specific v0.0.8 commands and artifact names in `RELEASING.md` with v0.0.9. Keep historical comments such as “v0.0.8 起随包内置思源黑体”.

- [ ] **Step 5: 运行版本契约并确认 GREEN**

Run:

```powershell
npm run verify:version -- --tag v0.0.9
node --test test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
```

Expected: all tests pass and verifier prints `Verified v0.0.9 -> Star-Picking-Pavilion-Setup-0.0.9.exe`.

- [ ] **Step 6: 提交版本与文档**

```powershell
git add -- package.json package-lock.json README.md CHANGELOG.md RELEASE_NOTES.md RELEASING.md test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
git diff --cached --check
git commit -m "chore: release v0.0.9"
```

### Task 5: 完整验证、推送 main 和发布标签

**Files:**
- Verify: all tracked files
- Generated but untracked: `dist/**`, `output/v0.0.9-source-audit.json`

- [ ] **Step 1: 确认发布范围与 GitHub 认证**

Run:

```powershell
git status --short --branch
git diff origin/main...HEAD --stat
git log --oneline origin/main..HEAD
gh --version
gh auth status
git remote get-url origin
```

Expected: only v0.0.9 commits are ahead of `origin/main`; origin is `https://github.com/Icdafy/Star-Picking-Pavilion.git`; GitHub CLI is authenticated.

- [ ] **Step 2: 运行完整发布门禁**

Run in this exact order:

```powershell
npm ci
npm run verify:version -- --tag v0.0.9
npm test
npm run test:e2e
npm run audit:runtime
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
npm run dist
npm run verify:package
npm run verify:version -- --tag v0.0.9 --artifacts
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.9.exe
```

Expected:

- all tests pass with zero failures;
- production audit has no high-severity vulnerability;
- notices do not change;
- build exits 0;
- package boundary passes;
- installer and `latest.yml` both report 0.0.9;
- Authenticode status is `NotSigned`, matching the public warning.

- [ ] **Step 3: 做完成前差异审计**

Run:

```powershell
git status --short
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git log --oneline --decorate origin/main..HEAD
```

Expected: no unexpected tracked changes; `dist/` and `output/` remain untracked or ignored and are not committed.

- [ ] **Step 4: 推送 main**

```powershell
git push origin main
```

Expected: remote `main` advances to the verified local commit.

- [ ] **Step 5: 创建并推送附注标签**

```powershell
git tag -a v0.0.9 -m "摘星阁 v0.0.9"
git push origin v0.0.9
```

Expected: tag push succeeds and triggers `.github/workflows/release.yml`.

- [ ] **Step 6: 等待并核对 GitHub Release**

Run:

```powershell
gh run list --workflow release.yml --limit 1
gh run watch --exit-status
gh release view v0.0.9
```

Expected: release workflow completes successfully and v0.0.9 Release contains installer, blockmap, `latest.yml`, `SHA256SUMS.txt`, SBOM and third-party notices.

## Plan Self-Review

- Spec coverage: Tasks 1–2 cover the full responsive matrix; Task 3 covers core functions and enabled sources; Task 4 covers all version/document surfaces; Task 5 covers every local and remote release gate.
- Placeholder scan: every code-writing step is explicit and complete.
- Type consistency: `summarizeSourceResults()` and `runAudit()` names match test, implementation and command usage; viewport, scale and view values match existing product identifiers.
- Scope: no database, AI, scoring, retention, credential or unrelated visual redesign is included.
