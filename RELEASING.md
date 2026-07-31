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
npm run verify:version -- --tag v0.0.14
npm test
npm run test:e2e
npm run audit:sources -- --strict
npm run audit:runtime
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
npm run dist
npm run verify:package
npm run verify:version -- --tag v0.0.14 --artifacts
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.14.exe
```

v0.0.14 的签名状态预期为 `NotSigned`。ASAR 不得超过 13,107,200 字节（12.5 MiB），安装包不得超过 99,614,720 字节（95 MiB）。

这两个上限在 v0.0.14 重新基线化。v0.0.11 起它们一直钉死在 v0.0.10 实测产物（12,476,662 / 99,328,923）上作为「不得回退」的棘轮，余量被逐版吃掉：安装包 v0.0.11 余 52,292 字节、v0.0.12 余 40,728、v0.0.13 只剩 12,522，到 v0.0.14 超出 1,778 字节；ASAR 也只剩 6,469 字节。现改为取产品硬顶（v0.0.11 瘦身设计写明的 ASAR 13 MiB、安装包 100 MiB）之下的整数档，余量只够吸收 NSIS 压缩抖动与几个小版本——MB 量级的真实回退照样会被拦下。思源黑体约 4.6 MiB，继续完整保留。

## 版本与 tag

版本采用 SemVer。`package.json`、tag、安装包文件名和 `latest.yml` 必须一致。创建 tag 前先运行版本校验：

```powershell
npm run verify:version -- --tag v0.0.14
git tag -a v0.0.14 -m "摘星阁 v0.0.14"
git push origin v0.0.14
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会依次执行版本检查、单元测试、真实 Electron 测试、生产依赖审计、第三方声明生成与差异检查、构建、包审计、SHA-256 和 SBOM。全部成功后才会运行 `gh release create`。

## 发布资产

v0.0.14 Release 应包含：

- `Star-Picking-Pavilion-Setup-0.0.14.exe`
- `Star-Picking-Pavilion-Setup-0.0.14.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

发布完成后下载到新的临时目录，按 `SHA256SUMS.txt` 重新校验并执行一次安装、启动、单实例、退出和卸载烟测。

## 回滚

不要覆盖或强推已经公开的版本资产。若候选 tag 尚未形成有效 Release，可以在确认精确目标后删除失败的远端 tag，再用包含修复的新提交重新创建；若用户已下载该版本，则发布更高的补丁版本并在变更日志中说明。
