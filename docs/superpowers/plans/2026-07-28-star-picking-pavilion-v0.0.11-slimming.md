# 摘星阁 v0.0.11 安全瘦身实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留摘星阁全部功能、内置字体和用户数据兼容性的前提下，纳入现有 v4 界面精修，安全降低安装包与长列表渲染负担，并完成 v0.0.11 的本地构建、GitHub 推送与正式 Release。

**Architecture:** 维持 Electron 主进程、沙箱渲染器、Node Utility 后端和本地 HTTP API 的现有边界。瘦身只作用于可再生产物、electron-builder 文件边界和浏览器原生离屏渲染；发布继续由 `main` 上的带注释 tag 触发既有 Windows GitHub Actions 工作流。

**Tech Stack:** Node.js 22、Electron 42、原生 JavaScript/CSS、Node test runner、Playwright Electron、electron-builder、GitHub Actions、GitHub CLI。

---

## 文件结构

- 修改 `renderer/app.js`：纳入维护者已有的领域卡片、异步图片解码与日报类名改动，并修复局部格式。
- 修改 `renderer/styles.css`：纳入维护者已有的 v4 视觉层级和 `content-visibility` 离屏渲染规则。
- 修改 `test/renderer-integration.test.js`：为 v4 DOM 契约和离屏渲染规则增加特征测试。
- 修改 `package.json`：升级版本并增加生产依赖文档、示例和测试材料的打包排除规则。
- 修改 `package-lock.json`：同步根版本为 0.0.11。
- 修改 `scripts/verify-package.js`：收紧体积预算，并让包审计拒绝依赖中的非运行材料。
- 修改 `test/package-verifier.test.js`：覆盖新的体积预算和依赖材料边界。
- 修改 `test/branding.test.js`、`test/release-readiness.test.js`：将公开版本、文档和产物契约升级到 v0.0.11。
- 修改 `README.md`、`CHANGELOG.md`、`RELEASE_NOTES.md`、`RELEASING.md`：完整描述 v0.0.11。
- 重新生成 `THIRD_PARTY_NOTICES.txt`：同步产品版本。
- 删除 `scripts/screenshot-ux.js`：完成本次视觉验收后移除临时脚本。
- 清理被 Git 忽略的 `dist/`、`output/`：删除旧版本和临时产物，正式构建后只保留 v0.0.11 Release 资产。

### Task 1：保护当前改动并建立基线

**Files:**

- Inspect: `renderer/app.js`
- Inspect: `renderer/styles.css`
- Inspect: `scripts/screenshot-ux.js`

- [ ] **Step 1: 记录分支、工作区和现有改动**

Run:

```powershell
git status --short --branch
git diff --stat
git diff -- renderer/app.js renderer/styles.css
git ls-files --others --exclude-standard
```

Expected: 当前分支为 `codex/v0.0.11`；只有设计与计划提交、两项维护者界面改动和临时截图脚本属于本次范围。

- [ ] **Step 2: 运行单元与集成测试基线**

Run:

```powershell
npm test
```

Expected: 全部测试通过，0 failures。

- [ ] **Step 3: 运行真实 Electron 基线**

Run:

```powershell
npm run test:e2e
```

Expected: Electron 启动、核心交互与响应式布局测试全部通过，0 failures。

- [ ] **Step 4: 若基线失败则停止实施并定位**

不得把已有失败归因于新改动。先按失败用例确认是环境、现有未提交界面改动还是仓库基线问题；只有得到可重复通过的基线后继续。

### Task 2：用特征测试锁定 v4 界面与离屏渲染

**Files:**

- Modify: `test/renderer-integration.test.js`
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: 增加 v4 DOM 和性能契约测试**

在 `test/renderer-integration.test.js` 增加：

```js
test('v4 cards use domain accents, async thumbnails and stylesheet-owned daily spacing', () => {
  assert.match(
    app,
    /<article class="card\$\{item\.featured \? ' is-featured' : ''\}" data-id="\$\{item\.id\}"\$\{item\.domain \? ` data-domain="\$\{esc\(item\.domain\)\}"` : ''\}/
  );
  assert.match(app, /class="card-thumb"[^>]*loading="lazy"[^>]*decoding="async"/);
  assert.match(app, /<div class="daily-section glass">/);
  assert.doesNotMatch(app, /class="daily-section glass"\s+style=/);
});

test('long feed and daily content skip offscreen rendering without dropping intrinsic space', () => {
  assert.match(
    css,
    /\.card\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 14rem;/s
  );
  assert.match(
    css,
    /\.daily-section\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 20rem;/s
  );
});
```

这些是维护者已写入工作区的特征测试，不把预先存在的实现伪装成由本任务新写出的 red-green 循环。

- [ ] **Step 2: 运行目标测试**

Run:

```powershell
node --test test/renderer-integration.test.js
```

Expected: 新增特征测试与原有渲染集成测试全部通过。

- [ ] **Step 3: 修复 `cardInner` 的局部格式，不改变输出**

将：

```js
    </div>` : '';  const thumb = DomUtils.safeHttpUrl(item.image) !== '#'
```

改为：

```js
    </div>` : '';
  const thumb = DomUtils.safeHttpUrl(item.image) !== '#'
```

- [ ] **Step 4: 重跑渲染与响应式测试**

Run:

```powershell
node --test test/renderer-integration.test.js test/responsive-layout.test.js test/typography.test.js
```

Expected: 全部通过，0 failures。

- [ ] **Step 5: 提交 v4 界面与离屏渲染**

Run:

```powershell
git add renderer/app.js renderer/styles.css test/renderer-integration.test.js
git diff --cached --check
git commit -m "perf: refine v4 interface and offscreen rendering"
```

Expected: 临时 `scripts/screenshot-ux.js` 仍未跟踪，未进入提交。

### Task 3：用测试驱动安装包边界收紧

**Files:**

- Modify: `test/package-verifier.test.js`
- Modify: `scripts/verify-package.js`
- Modify: `package.json`

- [ ] **Step 1: 写入会失败的体积与依赖材料测试**

把 `MAX_ASAR_BYTES`、`MAX_INSTALLER_BYTES` 加入 `test/package-verifier.test.js` 的解构导入，并增加：

```js
test('v0.0.11 package budgets never exceed the v0.0.10 artifacts', () => {
  assert.equal(MAX_ASAR_BYTES, 12_476_662);
  assert.equal(MAX_INSTALLER_BYTES, 99_328_923);
});

test('package verifier rejects dependency docs, examples and tests', () => {
  for (const forbidden of [
    '/node_modules/undici/docs/docs/api/Client.md',
    '/node_modules/cheerio/test/load.js',
    '/node_modules/rss-parser/examples/sample.js'
  ]) {
    assert.throws(
      () => assertAllowedEntries(['/electron/main.js', forbidden]),
      error => error instanceof Error && error.message.includes(forbidden)
    );
  }
});
```

同时增加 manifest 边界断言：

```js
test('electron-builder excludes non-runtime dependency material', () => {
  assert.ok(packageJson.build.files.includes('!node_modules/**/{docs,doc,example,examples,test,tests,__tests__}/**/*'));
  assert.ok(packageJson.build.files.includes('!node_modules/**/*.md'));
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test test/package-verifier.test.js
```

Expected: FAIL；旧预算仍为 18/120 MiB，依赖文档仍被允许，manifest 尚无两条排除规则。

- [ ] **Step 3: 在包审计器中实现最小边界**

在 `scripts/verify-package.js` 使用：

```js
const MAX_ASAR_BYTES = 12_476_662;
const MAX_INSTALLER_BYTES = 99_328_923;
const FORBIDDEN_DEPENDENCY_ARTIFACT =
  /(?:^|\/)(?:docs?|examples?|tests?|__tests__)(?:\/|$)|\.md$/i;
```

在 `assertAllowedEntries` 的循环中，规范化路径后增加：

```js
    if (root === 'node_modules' && FORBIDDEN_DEPENDENCY_ARTIFACT.test(entry)) {
      throw new Error(`Forbidden package entry: ${entry}`);
    }
```

并从模块导出两个预算常量。

- [ ] **Step 4: 在 electron-builder 白名单中实现相同排除**

在 `package.json` 的 `build.files` 中保留现有规则并增加：

```json
"!node_modules/**/{docs,doc,example,examples,test,tests,__tests__}/**/*",
"!node_modules/**/*.md"
```

- [ ] **Step 5: 运行目标测试并确认通过**

Run:

```powershell
node --test test/package-verifier.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 6: 提交包边界**

Run:

```powershell
git add package.json scripts/verify-package.js test/package-verifier.test.js
git diff --cached --check
git commit -m "build: tighten packaged runtime boundary"
```

### Task 4：测试先行升级版本至 v0.0.11

**Files:**

- Modify: `test/branding.test.js`
- Modify: `test/package-verifier.test.js`
- Modify: `test/release-readiness.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 将公开版本契约更新到 v0.0.11**

在三份测试中把规范版本与安装包名改为：

```js
assert.equal(pkg.version, '0.0.11');
assert.equal(expectedInstallerName(packageJson.version), 'Star-Picking-Pavilion-Setup-0.0.11.exe');
assert.equal(packageJson.version, '0.0.11');
```

把临时产物测试夹具统一改为：

```js
await fs.promises.writeFile(path.join(directory, 'latest.yml'), 'version: 0.0.11\n');
await fs.promises.writeFile(
  path.join(directory, 'Star-Picking-Pavilion-Setup-0.0.11.exe'),
  'fixture'
);
```

并将 tag、返回对象与文档正则中的 v0.0.10 更新为 v0.0.11；历史版本断言继续保留。

- [ ] **Step 2: 运行版本相关测试并确认失败**

Run:

```powershell
node --test test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
```

Expected: FAIL；`package.json`、锁文件和发布文档仍为 0.0.10。

- [ ] **Step 3: 机械同步 manifest 与锁文件版本**

Run:

```powershell
npm version 0.0.11 --no-git-tag-version
```

Expected: `package.json`、`package-lock.json` 和锁文件根包版本均为 0.0.11，不创建 tag 或 commit。

- [ ] **Step 4: 只运行不依赖发布文档的版本测试**

Run:

```powershell
node --test test/branding.test.js test/package-verifier.test.js
```

Expected: 版本与安装包名断言通过；若 branding 文档断言仍失败，留到 Task 5 一并转绿。

### Task 5：完整更新 v0.0.11 发布文档与合规声明

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Replace: `RELEASE_NOTES.md`
- Modify: `RELEASING.md`
- Regenerate: `THIRD_PARTY_NOTICES.txt`
- Modify: `test/release-readiness.test.js`
- Modify: `test/branding.test.js`

- [ ] **Step 1: 在 CHANGELOG 顶部加入 2026-07-28 的 v0.0.11 条目**

条目必须覆盖：

```markdown
## [0.0.11] - 2026-07-28

### Changed
- v4 界面层级精修：领域色条、收敛后的卡片元信息、异步缩略图解码和更清晰的操作入口。
- 长信息流和日报区块使用离屏渲染约束，减少视口外布局与绘制。
- 正式包排除依赖文档、示例和测试材料，体积门禁收紧到不超过 v0.0.10。

### Removed
- 清理本地旧版安装包、解包目录、历史测试截图和临时 UX 截图脚本；不涉及用户数据或正式功能。
```

- [ ] **Step 2: 更新 README**

将安装包、哈希命令和维护命令改为 `0.0.11`，并在版本概述中说明：

- 功能、数据、字体和自动更新全部保留；
- v4 视觉精修与离屏渲染；
- 安装包边界收紧，但 Electron/Chromium 仍是主要内存与体积来源。

- [ ] **Step 3: 重写 RELEASE_NOTES**

正文结构固定为：

```markdown
# 摘星阁 v0.0.11

## 更清楚的界面层级
## 安全瘦身
## 内存优化的真实边界
## 升级与数据
## 安装提示
```

必须出现“领域色条”“异步解码”“离屏渲染”“不删除功能”“未签名”和 `Star-Picking-Pavilion-Setup-0.0.11.exe`。

- [ ] **Step 4: 更新 RELEASING**

把所有命令、tag、安装包名和资产清单升级到 v0.0.11；把体积说明改为：

```markdown
ASAR 不得超过 12,476,662 字节，安装包不得超过 99,328,923 字节；两项均不得大于 v0.0.10 实测基线。
```

- [ ] **Step 5: 更新发布就绪测试的文档主线**

使用：

```js
assert.match(
  read('RELEASE_NOTES.md'),
  /v0\.0\.11[\s\S]*领域色条[\s\S]*离屏渲染[\s\S]*不删除功能[\s\S]*未签名/
);
assert.match(read('THIRD_PARTY_NOTICES.txt'), /摘星阁 \(Star-Picking-Pavilion\) 0\.0\.11/);
```

README 安装包正则和 branding 文档正则同步为 0.0.11。

- [ ] **Step 6: 重新生成第三方声明**

Run:

```powershell
npm run notices
```

Expected: `THIRD_PARTY_NOTICES.txt` 标题版本为 0.0.11；依赖列表和许可证保持完整，无 `UNKNOWN`。

- [ ] **Step 7: 运行版本与发布文档测试**

Run:

```powershell
node --test test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
npm run verify:version -- --tag v0.0.11
```

Expected: 全部通过；版本、tag 预期、安装包命名和文档完全一致。

- [ ] **Step 8: 提交版本与发布文档**

Run:

```powershell
git add package.json package-lock.json README.md CHANGELOG.md RELEASE_NOTES.md RELEASING.md THIRD_PARTY_NOTICES.txt test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
git diff --cached --check
git commit -m "chore: release v0.0.11"
```

### Task 6：完成视觉验收并清理可再生产物

**Files:**

- Delete: `scripts/screenshot-ux.js`
- Delete ignored files under: `output/`
- Delete ignored files under: `dist/`
- Preserve: `data/`
- Preserve: `node_modules/`

- [ ] **Step 1: 用临时脚本生成最后一轮 v4 截图**

Run:

```powershell
node scripts/screenshot-ux.js
```

Expected: `output/ux-review/` 生成深浅主题与核心视图截图，脚本使用临时数据库并正常关闭 Electron。

- [ ] **Step 2: 人工检查代表性截图**

至少查看：

- `output/ux-review/featured-dark.png`
- `output/ux-review/all-light.png`
- `output/ux-review/settings-dark.png`
- `output/ux-review/daily-dark.png`

Expected: 无空白主视图、遮挡、截断、溢出、错误主题或不可见操作按钮。

- [ ] **Step 3: 删除临时截图脚本**

使用文件补丁删除 `scripts/screenshot-ux.js`，然后确认：

```powershell
git status --short
```

Expected: 脚本从未被 Git 跟踪，因此删除后不进入提交。

- [ ] **Step 4: 精确验证清理目标**

Run:

```powershell
Resolve-Path -LiteralPath dist
Resolve-Path -LiteralPath output
git check-ignore dist output
```

Expected: 两个绝对路径都位于 `F:\摘星阁` 内且均被 Git 忽略。

- [ ] **Step 5: 使用 PowerShell 原生命令清空 `dist/` 与 `output/`**

Run:

```powershell
$workspaceRoot = [System.IO.Path]::GetFullPath('F:\摘星阁')
$cleanupTargets = @(
  [System.IO.Path]::GetFullPath('F:\摘星阁\dist'),
  [System.IO.Path]::GetFullPath('F:\摘星阁\output')
)
foreach ($target in $cleanupTargets) {
  if ([System.IO.Path]::GetDirectoryName($target) -ne $workspaceRoot) {
    throw "清理目标越出工作区：$target"
  }
  $leaf = [System.IO.Path]::GetFileName($target)
  if ($leaf -notin @('dist', 'output')) {
    throw "不是允许的清理目录：$target"
  }
  git check-ignore --quiet -- $leaf
  if ($LASTEXITCODE -ne 0) {
    throw "清理目录未被 Git 忽略：$target"
  }
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
New-Item -ItemType Directory -Path 'F:\摘星阁\dist' | Out-Null
```

Expected: 只清空并重建 `dist/`，删除 `output/`；不得触及 `data/`、仓库根目录或用户目录。

- [ ] **Step 6: 确认用户数据和工作区仍完整**

Run:

```powershell
Get-ChildItem -LiteralPath data -Force
git status --short --branch
```

Expected: 数据库与设置仍在；受控改动只属于 v0.0.11。

### Task 7：执行完整本地验证、构建和装机版同源烟测

**Files:**

- Generate ignored artifacts under: `dist/`

- [ ] **Step 1: 安装锁定依赖**

Run:

```powershell
npm ci
```

Expected: 安装成功，`package-lock.json` 无差异。

- [ ] **Step 2: 运行完整单元与集成测试**

Run:

```powershell
npm test
```

Expected: 全部测试通过，0 failures。

- [ ] **Step 3: 运行真实 Electron 测试**

Run:

```powershell
npm run test:e2e
```

Expected: 全部通过，0 failures。

- [ ] **Step 4: 运行实时信源与生产依赖审计**

Run:

```powershell
npm run audit:sources -- --strict
npm run audit:runtime
```

Expected: 生产依赖无 high/critical 漏洞；信源审计无空结果和请求失败。若外部信源波动，记录精确信源与错误并继续其余本地验证，但不得创建 tag。

- [ ] **Step 5: 验证声明可复现且版本一致**

Run:

```powershell
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
npm run verify:version -- --tag v0.0.11
```

Expected: 三项命令成功，工作树不产生新的声明差异。

- [ ] **Step 6: 从空目录构建一次 Windows 产物**

Run:

```powershell
npm run dist
```

Expected: 生成 `Star-Picking-Pavilion-Setup-0.0.11.exe`、blockmap、`latest.yml` 和 `win-unpacked/`。

- [ ] **Step 7: 验证包边界、体积和产物版本**

Run:

```powershell
npm run verify:package
npm run verify:version -- --tag v0.0.11 --artifacts
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.11.exe
```

Expected:

- 包审计通过；
- ASAR 不超过 12,476,662 字节；
- 安装包不超过 99,328,923 字节；
- 版本和 tag 一致；
- 签名状态为 `NotSigned`。

- [ ] **Step 8: 启动 `win-unpacked` 并验证打包后运行时**

使用 Playwright Electron 的 `executablePath` 指向：

```text
F:\摘星阁\dist\win-unpacked\Star-Picking-Pavilion.exe
```

用临时 `STAR_PICKING_PAVILION_TEST_DATA_DIR`、禁用调度与自动更新启动；等待首页加载，切换精选、全部动态、日报、常用网址、信源和设置视图，读取 `app.getAppMetrics()`，最后调用 `app.close()`。

Expected: 所有视图可打开，应用正常退出，无缺失模块或静态资源；记录进程数、总工作集和 Renderer 工作集。

- [ ] **Step 9: 生成本地发布校验与 SBOM**

Run:

```powershell
$installer = '.\dist\Star-Picking-Pavilion-Setup-0.0.11.exe'
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
"$hash  Star-Picking-Pavilion-Setup-0.0.11.exe" | Set-Content -Encoding ascii -LiteralPath '.\dist\SHA256SUMS.txt'
npx cyclonedx-npm --omit dev --spec-version 1.6 --output-reproducible --output-file dist/sbom.cdx.json --validate
```

Expected: `SHA256SUMS.txt` 与安装包哈希一致，SBOM 验证成功。

### Task 8：最终审查、清理中间产物并完成发布

**Files:**

- Inspect all tracked changes
- Preserve release assets under: `dist/`

- [ ] **Step 1: 执行最终差异与秘密审查**

Run:

```powershell
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
git ls-files
```

Expected: 仅包含设计、计划、v4 界面、测试、打包边界、版本与发布文档；不含 `data/`、`output/`、`dist/`、秘密或临时脚本。

- [ ] **Step 2: 运行最终新鲜验证**

Run:

```powershell
npm test
npm run test:e2e
npm run audit:runtime
npm run verify:package
npm run verify:version -- --tag v0.0.11 --artifacts
git diff --check origin/main...HEAD
```

Expected: 所有命令退出 0。

- [ ] **Step 3: 把本地 main 快进到候选提交**

Run:

```powershell
git switch main
git merge --ff-only codex/v0.0.11
```

Expected: `main` 与 `codex/v0.0.11` 指向同一提交，工作树干净。

- [ ] **Step 4: 推送 main**

Run:

```powershell
git push origin main
```

Expected: `origin/main` 更新到本地候选提交。

- [ ] **Step 5: 创建并推送 v0.0.11 tag**

Run:

```powershell
git tag -a v0.0.11 -m "摘星阁 v0.0.11"
git push origin v0.0.11
```

Expected: 远端 tag 创建成功并触发 `.github/workflows/release.yml`。

- [ ] **Step 6: 等待 release workflow**

Run:

```powershell
$releaseRuns = gh run list `
  --repo Icdafy/Star-Picking-Pavilion `
  --workflow release.yml `
  --limit 10 `
  --json databaseId,headBranch,event,status,conclusion | ConvertFrom-Json
$releaseRunId = $releaseRuns |
  Where-Object { $_.headBranch -eq 'v0.0.11' -and $_.event -eq 'push' } |
  Select-Object -First 1 -ExpandProperty databaseId
if (-not $releaseRunId) {
  throw '未找到 v0.0.11 的 release workflow'
}
gh run watch $releaseRunId --repo Icdafy/Star-Picking-Pavilion --exit-status
```

Expected: release workflow 全部步骤成功。

- [ ] **Step 7: 核对远端正式 Release**

Run:

```powershell
gh release view v0.0.11 --repo Icdafy/Star-Picking-Pavilion --json name,tagName,isDraft,isPrerelease,publishedAt,assets,body
```

Expected:

- 标题为 `摘星阁 v0.0.11`；
- 非草稿、非预发布；
- 包含安装包、blockmap、`latest.yml`、`SHA256SUMS.txt`、`sbom.cdx.json`、`THIRD_PARTY_NOTICES.txt` 六项资产。

- [ ] **Step 8: 下载远端校验文件并核对 digest**

Run:

```powershell
$releaseCheckBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$releaseCheckDir = Join-Path $releaseCheckBase ('spp-v0.0.11-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $releaseCheckDir | Out-Null
try {
  gh release download v0.0.11 `
    --repo Icdafy/Star-Picking-Pavilion `
    --pattern 'Star-Picking-Pavilion-Setup-0.0.11.exe' `
    --pattern 'SHA256SUMS.txt' `
    --dir $releaseCheckDir
  $installerPath = Join-Path $releaseCheckDir 'Star-Picking-Pavilion-Setup-0.0.11.exe'
  $checksumPath = Join-Path $releaseCheckDir 'SHA256SUMS.txt'
  $expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
  $release = gh release view v0.0.11 `
    --repo Icdafy/Star-Picking-Pavilion `
    --json assets | ConvertFrom-Json
  $assetDigest = ($release.assets |
    Where-Object name -eq 'Star-Picking-Pavilion-Setup-0.0.11.exe').digest
  if ($expectedHash -ne $actualHash -or $assetDigest -ne "sha256:$actualHash") {
    throw '远端安装包 SHA-256 三方校验不一致'
  }
} finally {
  $resolvedCheckDir = [System.IO.Path]::GetFullPath($releaseCheckDir)
  if (
    $resolvedCheckDir.StartsWith($releaseCheckBase, [System.StringComparison]::OrdinalIgnoreCase) -and
    [System.IO.Path]::GetFileName($resolvedCheckDir) -like 'spp-v0.0.11-release-*'
  ) {
    Remove-Item -LiteralPath $resolvedCheckDir -Recurse -Force
  }
}
```

Expected: 三方 SHA-256 完全一致。

- [ ] **Step 9: 删除本地中间解包目录**

Run:

```powershell
$distRoot = [System.IO.Path]::GetFullPath('F:\摘星阁\dist')
$unpackedTarget = [System.IO.Path]::GetFullPath('F:\摘星阁\dist\win-unpacked')
if (
  [System.IO.Path]::GetDirectoryName($unpackedTarget) -ne $distRoot -or
  [System.IO.Path]::GetFileName($unpackedTarget) -ne 'win-unpacked'
) {
  throw "解包清理目标不安全：$unpackedTarget"
}
if (Test-Path -LiteralPath $unpackedTarget) {
  Remove-Item -LiteralPath $unpackedTarget -Recurse -Force
}
foreach ($file in @('builder-debug.yml', 'builder-effective-config.yaml')) {
  $candidate = Join-Path $distRoot $file
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    Remove-Item -LiteralPath $candidate -Force
  }
}
```

Expected: 仅删除 `dist/win-unpacked/` 与两项构建调试文件，保留当前 v0.0.11 的六项 Release 资产。

- [ ] **Step 10: 最终状态确认**

Run:

```powershell
git status --short --branch
git log -5 --oneline --decorate
gh release view v0.0.11 --repo Icdafy/Star-Picking-Pavilion --json url,tagName,isDraft,isPrerelease
```

Expected: `main` 与 `origin/main` 同步，工作树干净，`v0.0.11` Release 可访问。
