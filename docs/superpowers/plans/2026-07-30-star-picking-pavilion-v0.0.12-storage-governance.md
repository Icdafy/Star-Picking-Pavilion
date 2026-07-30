# 摘星阁 v0.0.12 智能存储治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为摘星阁增加可观测、可压缩、可治理且不会静默删除旧数据库的本地存储生命周期，并完整发布 v0.0.12。

**Architecture:** 后端新增只管理当前 SQLite 数据库的维护模块，Electron 主进程新增只管理固定白名单缓存、迁移残留和已验证旧库候选的桌面存储模块，渲染层通过现有认证 HTTP API 与受限 IPC 聚合展示。所有自动动作由明确阈值控制，当前数据库、用户设置、凭据、星标和备忘始终留在各自安全边界内。

**Tech Stack:** Electron 36、Node.js 22 内置 `node:sqlite`、原生 JavaScript、SQLite FTS5、Node test runner、原生 HTML/CSS。

---

## 文件结构

- Create `server/database-maintenance.js`：SQLite 指标、优化、自动压缩阈值、磁盘余量检查与深度压缩。
- Create `electron/storage-maintenance.js`：缓存状态、白名单扫描、启动清理、迁移残留和旧库候选治理。
- Create `electron/storage-maintenance-ipc.js`：固定桌面存储 IPC 注册。
- Create `renderer/storage-maintenance-controller.js`：合并 HTTP/IPC 快照并管理四种操作状态。
- Create `test/database-maintenance.test.js`：真实 SQLite 指标与压缩测试。
- Create `test/storage-maintenance.test.js`：真实临时目录的缓存、临时残留和旧库安全测试。
- Create `test/storage-maintenance-ipc.test.js`：IPC schema 和控制器就绪状态测试。
- Create `test/storage-maintenance-controller.test.js`：渲染控制器状态与错误测试。
- Modify `server/db.js`：导出规范数据库路径，不改变现有 schema。
- Modify `server/retention.js`：普通清理完成后运行 SQLite 优化并扩展维护快照。
- Modify `server/scheduler.js`：加入压缩互斥、自动评估和状态。
- Modify `server/index.js`：扩展维护快照并增加手动压缩端点。
- Modify `electron/main.js`：设置缓存软上限、初始化桌面存储控制器并注册 IPC。
- Modify `electron/preload.js`：暴露三个无路径参数的桌面存储方法。
- Modify `renderer/index.html`、`renderer/app.js`、`renderer/styles.css`：存储分项、操作按钮和响应式状态。
- Modify `test/preload.test.js`、`test/retention.test.js`、`test/scheduler.test.js`、`test/renderer-integration.test.js`、`test/main-security.test.js`：集成与回归断言。
- Modify `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`、`RELEASE_NOTES.md`、`RELEASING.md`、`server/export/markdown.js`、发布验证测试：统一 v0.0.12。

### Task 1: SQLite 指标与深度压缩

**Files:**
- Create: `server/database-maintenance.js`
- Modify: `server/db.js`
- Test: `test/database-maintenance.test.js`

- [ ] **Step 1: 写入失败的真实 SQLite 测试**

测试创建临时数据库、填充并删除大文本，验证指标和阈值：

```js
test('reports reusable pages and compacts only when automatic thresholds are met', () => {
  const snapshot = databaseStorageSnapshot({ database, databasePath });
  assert.ok(snapshot.allocatedBytes >= snapshot.reclaimableBytes);
  assert.equal(shouldAutoCompact({
    ...snapshot,
    lastCompactionAt: '2026-06-01T00:00:00.000Z',
    nowMs: Date.parse('2026-07-30T00:00:00.000Z')
  }), snapshot.reclaimableBytes >= AUTO_COMPACT_MIN_BYTES
      && snapshot.reclaimableRatio >= AUTO_COMPACT_MIN_RATIO);
});

test('manual compact preserves every live row and returns bytes to the filesystem', () => {
  const before = databaseStorageSnapshot({ database, databasePath });
  const result = compactDatabase({
    database,
    databasePath,
    mode: 'manual',
    availableBytes: before.fileBytes * 2 + COMPACT_FREE_SPACE_RESERVE_BYTES
  });
  assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.equal(database.prepare('SELECT COUNT(*) c FROM keepers').get().c, 1);
  assert.ok(result.after.fileBytes <= result.before.fileBytes);
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `node --test test/database-maintenance.test.js`

Expected: FAIL，错误包含 `Cannot find module '../server/database-maintenance'`。

- [ ] **Step 3: 实现独立数据库维护模块**

模块导出固定常量与可注入依赖的函数：

```js
const AUTO_COMPACT_MIN_BYTES = 64 * 1024 * 1024;
const AUTO_COMPACT_MIN_RATIO = 0.25;
const AUTO_COMPACT_INTERVAL_MS = 30 * 86_400_000;
const COMPACT_FREE_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;

function shouldAutoCompact({ reclaimableBytes, reclaimableRatio, lastCompactionAt, nowMs = Date.now() }) {
  const previous = Date.parse(lastCompactionAt || '');
  return reclaimableBytes >= AUTO_COMPACT_MIN_BYTES
    && reclaimableRatio >= AUTO_COMPACT_MIN_RATIO
    && (!Number.isFinite(previous) || nowMs - previous >= AUTO_COMPACT_INTERVAL_MS);
}

function compactDatabase({ database, databasePath, mode = 'manual', availableBytes, nowMs = Date.now() }) {
  const before = databaseStorageSnapshot({ database, databasePath });
  if (mode === 'auto' && !shouldAutoCompact({ ...before, lastCompactionAt: readMeta(database, 'lastCompactionAt'), nowMs })) {
    return { skipped: true, reason: 'threshold', before, after: before };
  }
  assertHealthy(database);
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (availableBytes < before.fileBytes * 2 + COMPACT_FREE_SPACE_RESERVE_BYTES) {
    return { skipped: true, reason: 'space', before, after: before };
  }
  database.exec('VACUUM');
  assertHealthy(database);
  writeMeta(database, 'lastCompactionAt', new Date(nowMs).toISOString());
  return { skipped: false, before, after: databaseStorageSnapshot({ database, databasePath }) };
}
```

`databaseStorageSnapshot` 必须用 `PRAGMA page_count`、`page_size`、`freelist_count` 和规范数据库主文件/WAL/SHM 的 `stat` 结果计算，不扫描其他目录。`server/db.js` 增加 `DATABASE_PATH` 导出并复用它打开数据库。

- [ ] **Step 4: 运行数据库维护测试**

Run: `node --test test/database-maintenance.test.js`

Expected: PASS，且临时数据库 `quick_check` 为 `ok`。

- [ ] **Step 5: 提交 SQLite 维护核心**

```powershell
git add server/database-maintenance.js server/db.js test/database-maintenance.test.js
git commit -m "feat: add safe database compaction"
```

### Task 2: 保留清理、维护互斥与后端 API

**Files:**
- Modify: `server/retention.js`
- Modify: `server/scheduler.js`
- Modify: `server/index.js`
- Test: `test/retention.test.js`
- Test: `test/scheduler.test.js`
- Test: `test/feed-query.test.js`

- [ ] **Step 1: 写入失败的优化、互斥和 API 测试**

```js
test('prune records optimize separately after committed deletions', () => {
  const result = pruneDatabase({ settings, nowMs: NOW_MS });
  assert.equal(result.optimized, true);
  assert.equal(getMaintenanceSnapshot().lastOptimizeAt, new Date(NOW_MS).toISOString());
});

test('compaction skips while collection is active and blocks new work while running', async () => {
  const busy = compactOnce('manual');
  assert.equal(busy.skipped, true);
  assert.equal(busy.reason, 'busy');
});

test('maintenance API exposes database storage detail and accepts compact without paths', async () => {
  const snapshot = await get('/api/maintenance');
  assert.equal(typeof snapshot.database.allocatedBytes, 'number');
  const compacted = await post('/api/maintenance/compact', {});
  assert.equal(Object.hasOwn(compacted, 'databasePath'), false);
});
```

- [ ] **Step 2: 运行三组测试并确认新断言失败**

Run: `node --test test/retention.test.js test/scheduler.test.js test/feed-query.test.js`

Expected: FAIL，缺少 `optimized`、`compactOnce` 或 `/api/maintenance/compact`。

- [ ] **Step 3: 接入优化、压缩和互斥**

`pruneDatabase` 在事务提交后调用：

```js
let optimized = false;
try {
  db.exec('PRAGMA optimize');
  writeMaintenanceMeta('lastOptimizeAt', new Date(nowMs).toISOString());
  optimized = true;
} catch {}
```

调度器增加 `compactRunning`，让 `collectOnce`、`analyzeOnce`、`pruneOnce` 在压缩期间返回 `{ skipped: true, reason: 'maintenance' }`。`compactOnce(trigger, { mode })` 在任何其他任务运行时返回 `busy`，否则调用数据库维护模块。每天普通清理和启动清理完成后以 `mode: 'auto'` 评估一次。

后端维护快照改为：

```js
{
  database: databaseStorageSnapshot(),
  articles,
  irrelevant,
  starred,
  expiring,
  retentionDays,
  irrelevantRetentionDays,
  ...getMaintenanceSnapshot(),
  scheduler: getStatus()
}
```

新增 `POST /api/maintenance/compact`，忽略任何未知请求字段，并只返回字节数、状态、原因和耗时。

- [ ] **Step 4: 运行后端维护回归**

Run: `node --test test/database-maintenance.test.js test/retention.test.js test/scheduler.test.js test/feed-query.test.js`

Expected: PASS。

- [ ] **Step 5: 提交后端集成**

```powershell
git add server/retention.js server/scheduler.js server/index.js test/retention.test.js test/scheduler.test.js test/feed-query.test.js
git commit -m "feat: coordinate automatic storage maintenance"
```

### Task 3: Electron 缓存、迁移残留与旧库安全模型

**Files:**
- Create: `electron/storage-maintenance.js`
- Test: `test/storage-maintenance.test.js`
- Modify: `electron/user-data-migration.js`
- Test: `test/user-data-migration.test.js`

- [ ] **Step 1: 写入失败的桌面文件系统安全测试**

覆盖 256 MiB/7 天缓存阈值、精确临时文件模式、30 天旧库宽限和未知文件保护：

```js
test('only fixed cache names are removable and automatic cleanup observes threshold and interval', async () => {
  const controller = createStorageMaintenanceController(options);
  const snapshot = await controller.getSnapshot();
  assert.equal(snapshot.cache.bytes, expectedManagedBytes);
  assert.equal(snapshot.cache.paths.some(value => value.includes('Local Storage')), false);
});

test('legacy cleanup requires an eligible regenerated candidate and explicit confirmation', async () => {
  const candidate = (await controller.getSnapshot()).legacy.candidates[0];
  await controller.deleteLegacy(candidate.id);
  assert.equal(fs.existsSync(legacyDatabase), false);
  assert.equal(fs.existsSync(path.join(legacyDirectory, 'unknown.keep')), true);
});

test('development data and symlinked cache entries are never removable', async () => {
  const snapshot = await controller.getSnapshot();
  assert.equal(snapshot.legacy.candidates.some(candidate => candidate.path.startsWith(repoDataDir)), false);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test test/storage-maintenance.test.js test/user-data-migration.test.js`

Expected: FAIL，错误包含 `Cannot find module '../electron/storage-maintenance'`。

- [ ] **Step 3: 实现桌面存储控制器**

模块固定：

```js
const MANAGED_CACHE_NAMES = Object.freeze([
  'Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache'
]);
const CACHE_SOFT_LIMIT_BYTES = 256 * 1024 * 1024;
const CACHE_AUTO_INTERVAL_MS = 7 * 86_400_000;
const LEGACY_GRACE_MS = 30 * 86_400_000;
const MIGRATION_TEMP_MAX_AGE_MS = 7 * 86_400_000;
```

`prepareStorageBeforeReady` 只解析 `userData` 直属白名单缓存目录，拒绝符号链接，读取原子状态文件并在 `pendingStartupCacheClear` 或自动阈值满足时删除。`createStorageMaintenanceController` 提供：

```js
{
  initializeAfterMigration(),
  getSnapshot(),
  clearCache(),
  deleteLegacy(candidateId)
}
```

旧库候选 ID 由当前扫描生成；`deleteLegacy` 忽略渲染层路径，重新扫描、重新检查规范库、迁移记录、30 天宽限和候选 `quick_check`，再经注入的 `confirm(candidate)` 返回 `true` 后删除主文件/WAL/SHM。任何未知文件和整个目录都不得递归删除。

迁移模块导出其规范常量和 `quickCheck`，让存储治理复用同一判断，不复制数据库身份规则。

- [ ] **Step 4: 运行桌面存储测试**

Run: `node --test test/storage-maintenance.test.js test/user-data-migration.test.js`

Expected: PASS，取消确认、未满宽限和开发目录文件均保持不变。

- [ ] **Step 5: 提交桌面存储核心**

```powershell
git add electron/storage-maintenance.js electron/user-data-migration.js test/storage-maintenance.test.js test/user-data-migration.test.js
git commit -m "feat: govern desktop caches and legacy data"
```

### Task 4: Electron IPC、preload 与主进程接线

**Files:**
- Create: `electron/storage-maintenance-ipc.js`
- Modify: `electron/preload.js`
- Modify: `electron/main.js`
- Test: `test/storage-maintenance-ipc.test.js`
- Test: `test/preload.test.js`
- Test: `test/main-security.test.js`

- [ ] **Step 1: 写入失败的固定 IPC 测试**

```js
test('storage IPC never forwards renderer paths', async () => {
  registerStorageMaintenanceIpc({ ipcMain, getController: () => controller });
  await handlers.get('storage:delete-legacy')({}, { id: 'legacy-1', path: 'C:\\arbitrary.db' });
  assert.deepEqual(calls.at(-1), ['deleteLegacy', 'legacy-1']);
});

test('preload exposes frozen no-path storage methods', async () => {
  await api.getStorageSnapshot();
  await api.clearManagedCache();
  await api.deleteLegacyData('legacy-1');
  assert.deepEqual(ipcCalls.slice(-3).map(call => call[1]), [
    'storage:get', 'storage:clear-cache', 'storage:delete-legacy'
  ]);
});
```

- [ ] **Step 2: 运行测试并确认 IPC 尚不存在**

Run: `node --test test/storage-maintenance-ipc.test.js test/preload.test.js test/main-security.test.js`

Expected: FAIL，缺少存储 IPC 或 preload 方法。

- [ ] **Step 3: 实现 IPC 与主进程初始化**

`storage-maintenance-ipc.js` 注册：

```js
ipcMain.handle('storage:get', () => requireController().getSnapshot());
ipcMain.handle('storage:clear-cache', () => requireController().clearCache());
ipcMain.handle('storage:delete-legacy', (_event, request) =>
  requireController().deleteLegacy(String(request?.id || '')));
```

preload 增加对应三种方法并对返回值 `cloneAndFreeze`。`main.js` 在 `app.whenReady()` 之前设置：

```js
app.commandLine.appendSwitch('disk-cache-size', String(CACHE_SOFT_LIMIT_BYTES));
```

在数据迁移完成、窗口创建之前初始化控制器；旧库删除确认使用 Electron 原生 `dialog.showMessageBox`，正文列出控制器重新验证后的精确文件和不可恢复提示。

- [ ] **Step 4: 运行 Electron 桥测试**

Run: `node --test test/storage-maintenance-ipc.test.js test/preload.test.js test/main-security.test.js`

Expected: PASS。

- [ ] **Step 5: 提交桌面桥**

```powershell
git add electron/storage-maintenance-ipc.js electron/preload.js electron/main.js test/storage-maintenance-ipc.test.js test/preload.test.js test/main-security.test.js
git commit -m "feat: expose safe storage maintenance controls"
```

### Task 5: 数据维护界面

**Files:**
- Create: `renderer/storage-maintenance-controller.js`
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`
- Test: `test/storage-maintenance-controller.test.js`
- Test: `test/renderer-integration.test.js`
- Test: `test/responsive-layout.test.js`

- [ ] **Step 1: 写入失败的控制器与静态集成测试**

```js
test('combines database and desktop snapshots without treating unavailable values as zero', async () => {
  await controller.load();
  assert.equal(elements.database.textContent, '12.0 MB');
  assert.equal(elements.cache.textContent, '暂不可用');
  assert.equal(elements.total.textContent, '12.0 MB');
});

test('legacy action stays disabled without an eligible candidate', async () => {
  await controller.load();
  assert.equal(elements.legacyButton.disabled, true);
});
```

静态回归断言必须找到 `msDatabase`、`msReclaimable`、`msCache`、`msMigrationResidue`、`msLegacy`、`msTotal`、`btnCompactNow`、`btnClearCache`、`btnDeleteLegacy` 和独立状态区域。

- [ ] **Step 2: 运行界面测试并确认失败**

Run: `node --test test/storage-maintenance-controller.test.js test/renderer-integration.test.js test/responsive-layout.test.js`

Expected: FAIL，缺少控制器、DOM ID 或响应式样式。

- [ ] **Step 3: 实现无框架存储控制器和界面**

控制器接收：

```js
createStorageMaintenanceController({
  elements,
  requestDatabase: () => api('/api/maintenance'),
  compactDatabase: () => api('/api/maintenance/compact', { body: {} }),
  getDesktopStorage: () => Desktop.getStorageSnapshot(),
  clearDesktopCache: () => Desktop.clearManagedCache(),
  deleteLegacyData: id => Desktop.deleteLegacyData(id),
  formatBytes
});
```

`load()` 用 `Promise.allSettled` 独立呈现后端和桌面失败；总计只加总已知分项，并在存在未知分项时标注「至少」。四个按钮使用独立状态、只在自身运行时禁用；旧库按钮只在合格候选存在时启用。

HTML 使用卡片内可换行的统计网格；CSS 在 720px 和 480px 下分别收敛为两列和单列，不引入横向滚动。

- [ ] **Step 4: 运行界面与响应式测试**

Run: `node --test test/storage-maintenance-controller.test.js test/renderer-integration.test.js test/responsive-layout.test.js`

Expected: PASS。

- [ ] **Step 5: 提交用户界面**

```powershell
git add renderer/storage-maintenance-controller.js renderer/index.html renderer/app.js renderer/styles.css test/storage-maintenance-controller.test.js test/renderer-integration.test.js test/responsive-layout.test.js
git commit -m "feat: add storage governance dashboard"
```

### Task 6: 统一 v0.0.12 版本与文档

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `RELEASE_NOTES.md`
- Modify: `RELEASING.md`
- Modify: `server/export/markdown.js`
- Modify: `test/branding.test.js`
- Modify: `test/export-markdown.test.js`
- Modify: `test/release-readiness.test.js`
- Modify: `test/package-verifier.test.js`

- [ ] **Step 1: 更新版本测试期望并确认失败**

把所有当前产品身份断言更新为 `0.0.12`，并增加 README/Release Notes 对数据库深度压缩、缓存治理、旧库确认保护和阈值的覆盖。

Run: `node --test test/branding.test.js test/export-markdown.test.js test/release-readiness.test.js test/package-verifier.test.js`

Expected: FAIL，当前文件仍声明 `0.0.11`。

- [ ] **Step 2: 更新 npm 版本**

Run: `npm version 0.0.12 --no-git-tag-version`

Expected: `package.json` 与 `package-lock.json` 均为 `0.0.12`，没有创建 tag。

- [ ] **Step 3: 更新全部用户和发布资料**

README 首屏、版本说明、功能列表、数据保留、本地文件、备份与隐私章节统一到 v0.0.12。CHANGELOG 顶部新增完整的 `0.0.12` 变更；RELEASE_NOTES 改为可直接用于 GitHub Release 的 v0.0.12 正文；RELEASING 中所有命令、资产名和 tag 改为 v0.0.12。导出页脚改为：

```js
const EXPORT_VERSION = '0.0.12';
```

包审计基线使用 v0.0.11 实际产物尺寸；正式代码、设计和计划允许进入 ASAR，数据库、维护状态、日志和测试夹具继续被排除。

- [ ] **Step 4: 运行版本和发布资料测试**

Run: `npm run verify:version -- --tag v0.0.12`

Run: `node --test test/branding.test.js test/export-markdown.test.js test/release-readiness.test.js test/package-verifier.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: 提交版本资料**

```powershell
git add package.json package-lock.json README.md CHANGELOG.md RELEASE_NOTES.md RELEASING.md server/export/markdown.js test/branding.test.js test/export-markdown.test.js test/release-readiness.test.js test/package-verifier.test.js
git commit -m "chore: prepare v0.0.12 release"
```

### Task 7: 完整验证、打包与运行烟测

**Files:**
- Modify when generated: `THIRD_PARTY_NOTICES.txt`
- Verify: `dist/Star-Picking-Pavilion-Setup-0.0.12.exe`
- Verify: `dist/Star-Picking-Pavilion-Setup-0.0.12.exe.blockmap`
- Verify: `dist/latest.yml`

- [ ] **Step 1: 运行完整单元和集成测试**

Run: `npm test`

Expected: 全部 PASS，无跳过的存储安全测试。

- [ ] **Step 2: 运行真实 Electron E2E**

Run: `npm run test:e2e`

Expected: 全部 PASS，桌面进程正常退出且无残留。

- [ ] **Step 3: 运行信源、依赖和声明门禁**

Run: `npm run audit:sources -- --strict`

Run: `npm run audit:runtime`

Run: `npm run notices`

Run: `git diff --exit-code -- THIRD_PARTY_NOTICES.txt`

Expected: 信源无空结果/失败，生产依赖无 high 级漏洞，第三方声明无未提交差异。

- [ ] **Step 4: 构建并审计安装包**

先确认 `dist` 解析后的绝对路径为 `F:\摘星阁\dist`，再用 PowerShell `Remove-Item -LiteralPath` 清理旧构建文件。

Run: `npm run dist`

Run: `npm run verify:package`

Run: `npm run verify:version -- --tag v0.0.12 --artifacts`

Run: `Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.12.exe`

Expected: 构建和两项验证 PASS，签名状态为 `NotSigned`，包内不存在用户数据库、维护状态、日志或测试夹具。

- [ ] **Step 5: 执行安装与存储治理烟测**

在临时测试数据目录启动解包版，验证空库启动、维护分项、手动普通清理、无可回收空间时深度压缩跳过、缓存清理、无旧库时按钮禁用、单实例和正常退出。再用安装包完成当前用户安装、启动和卸载；卸载后用户数据目录继续保留。

Expected: 所有操作给出确定状态，数据库 `quick_check` 为 `ok`，进程完全退出。

- [ ] **Step 6: 提交验证中产生的必要修正**

```powershell
git add -A
git diff --cached --check
git commit -m "test: verify v0.0.12 release candidate"
```

若没有文件变化，不创建空提交。

### Task 8: 推送 main、标签与核验 GitHub Release

**Files:**
- Remote: `origin/main`
- Tag: `v0.0.12`
- Release: `Icdafy/Star-Picking-Pavilion` v0.0.12

- [ ] **Step 1: 完成发布前 Git 审计**

Run: `git status --short`

Run: `git log --oneline --decorate main..codex/v0.0.12`

Run: `git diff --check main...codex/v0.0.12`

Expected: 工作树干净，提交只包含 v0.0.12 设计、计划、功能、测试和发布资料。

- [ ] **Step 2: 让 main 快进到候选提交并推送**

```powershell
git switch main
git merge --ff-only codex/v0.0.12
git push origin main
```

Expected: 本地与 `origin/main` 指向同一已验证提交。

- [ ] **Step 3: 创建并推送受注释标签**

```powershell
git tag -a v0.0.12 -m "摘星阁 v0.0.12"
git push origin v0.0.12
```

Expected: 远端出现精确标签并触发受保护发布工作流。

- [ ] **Step 4: 等待发布工作流并核验资产**

使用 GitHub 连接器读取 tag 对应工作流和 Release。Release 必须包含：

```text
Star-Picking-Pavilion-Setup-0.0.12.exe
Star-Picking-Pavilion-Setup-0.0.12.exe.blockmap
latest.yml
SHA256SUMS.txt
sbom.cdx.json
THIRD_PARTY_NOTICES.txt
```

若工作流失败，读取精确失败步骤和日志，修复后发布更高提交；在 Release 尚未形成且没有用户下载时，才可按发布指南重新创建失败 tag。

- [ ] **Step 5: 下载远端资产并复核**

将 Release 资产下载到新建临时目录，按 `SHA256SUMS.txt` 逐项验证安装包、blockmap、latest.yml、SBOM 和第三方声明。

Expected: 所有哈希匹配，GitHub Release 标题和正文为 v0.0.12，`latest.yml` 版本与安装包一致。
