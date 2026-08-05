# 摘星阁发布指南

本文适用于 `Icdafy/Star-Picking-Pavilion`。发布流程只允许通过受门禁保护的 tag 工作流执行，不再提供会绕过测试的本地 `--publish always` 命令。

## 发布前授权门槛

在任何公开推送前，维护者必须确认：

1. 常用网址采用了用户明确授权的公开策略；若选择私有策略，内部分享链接只能存在于被 Git 忽略的本地配置中，且不得进入将要推送的 Git 对象。
2. 本次版本未签名的事实已获接受，README 与发布说明保留 SmartScreen 警告。
3. 目标仓库、分支和 tag 已逐项核对，无秘密、数据库、日志或用户数据。
4. `main` 上的精确提交已经通过完整验证矩阵和安装/卸载烟测。

## 本地候选包验证

在干净工作树中运行：

```powershell
npm ci
npm run verify:version -- --tag v0.0.17
npm test
npm run test:e2e
npm run audit:sources -- --strict
npm run audit:runtime
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
npm run dist
npm run verify:package
npm run verify:version -- --tag v0.0.17 --artifacts
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.17.exe
```

v0.0.17 的签名状态预期为 `NotSigned`。

**体积不再有上限。** `npm run verify:package` 会打印 ASAR 与安装包的精确字节数供发布记录比对，但不会因为体积失败。

沿革：v0.0.11 把上限钉死在 v0.0.10 实测产物上当「不得回退」的棘轮，余量被逐版吃掉（安装包 v0.0.11 余 52,292 字节、v0.0.12 余 40,728、v0.0.13 只剩 12,522），v0.0.15 的八段式管线超出 1,778 字节，CI 与发布双双打红，只好重新基线化到 12.5 MiB / 95 MiB。但那只是把同一个问题往后推：100 MiB 这个「硬顶」本就是 v0.0.11 瘦身设计里的审美取值，不是任何技术边界——GitHub Release 单个附件允许 2 GB，NSIS 与 electron-updater 都不在乎，而安装包的绝大部分是 Electron/Chromium 运行时，不是本项目的代码。门禁因此从「别塞垃圾进去」异化成了「别写新代码」。

取消的只是体积这一项。**包边界检查一条都没有放松**，而那才是真正拦得住「不该进包的东西」的部分：根目录白名单与数据库/日志/临时文件/文档目录黑名单、只允许 lockfile 里的生产依赖、私钥与各类 Token 扫描、`resources/` 逐项白名单、LICENSE 与第三方声明校验。误打 dev 依赖、漏排除 docs、把用户数据库塞进包里，这些会让体积突然变大的真实情形依旧会失败，而且报的是「哪个文件不该在这」，比「总数大了几字节」有用得多。

思源黑体约 4.6 MiB，继续完整保留。

### 为什么不继续压体积（v0.0.15 实测，别再重做这个实验）

安装包体积的构成决定了它压不下去。win-unpacked 共 320.4 MiB，其中：

| 组成 | 体积 | 占比 |
| --- | --- | --- |
| `Star-Picking-Pavilion.exe`（Chromium 运行时） | 232.8 MiB | 72.6% |
| `dxcompiler.dll` | 24.5 MiB | 7.6% |
| `LICENSES.chromium.html` | 19.4 MiB | 6.1% |
| **`resources/app.asar`（本项目全部代码 + 内置字体）** | **11.9 MiB** | **3.7%** |
| 其余 Electron 资源（icudtl、resources.pak、swiftshader 等） | 31.8 MiB | 10.0% |

本项目自己的代码只占 3.7%，把它压到零也只省下不到 4%。

`build.compression` 三档实测（同一台机器、同一份产物）：

| 设置 | 安装包字节 |
| --- | --- |
| `store` | 100,336,559 |
| 未设置（默认 `normal`） | 99,330,701 |
| `maximum` | 99,330,670 |

`store → normal` 省约 1 MiB，`normal → maximum` 只省 31 字节。默认档已经贴着压缩极限，所以**不设置 `compression`**——加一个买不到任何东西的旋钮只会让人以为它有用。

结论：在继续使用 Electron 的前提下，安装包不存在有意义的瘦身空间。真要大幅缩小只能换掉运行时框架，那是另一个产品决策，不是发布门禁能解决的问题。

## 版本与 tag

版本采用 SemVer。`package.json`、tag、安装包文件名和 `latest.yml` 必须一致。创建 tag 前先运行版本校验：

```powershell
npm run verify:version -- --tag v0.0.17
git tag -a v0.0.17 -m "摘星阁 v0.0.17"
git push origin v0.0.17
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会依次执行版本检查、单元测试、真实 Electron 测试、生产依赖审计、第三方声明生成与差异检查、构建、包审计、SHA-256 和 SBOM。全部成功后才会运行 `gh release create`。

## 发布资产

v0.0.17 Release 应包含：

- `Star-Picking-Pavilion-Setup-0.0.17.exe`
- `Star-Picking-Pavilion-Setup-0.0.17.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

发布完成后下载到新的临时目录，按 `SHA256SUMS.txt` 重新校验并执行一次安装、启动、单实例、退出和卸载烟测。

## 回滚

不要覆盖或强推已经公开的版本资产。若候选 tag 尚未形成有效 Release，可以在确认精确目标后删除失败的远端 tag，再用包含修复的新提交重新创建；若用户已下载该版本，则发布更高的补丁版本并在变更日志中说明。
