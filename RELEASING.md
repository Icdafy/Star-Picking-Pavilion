# 摘星阁发布指南

本文适用于 `Icdafy/Star-Picking-Pavilion`。发布流程只允许通过受门禁保护的 tag 工作流执行，不再提供会绕过测试的本地 `--publish always` 命令。

## 发布前授权门槛

在任何公开推送前，维护者必须确认：

1. 常用网址采用了用户明确授权的公开策略；若选择私有策略，内部分享链接只能存在于被 Git 忽略的本地配置中，且不得进入将要推送的 Git 对象。
2. 本次首版未签名的事实已获接受，README 与发布说明保留 SmartScreen 警告。
3. 目标仓库、分支和 tag 已逐项核对，无秘密、数据库、日志或用户数据。
4. `main` 上的精确提交已经通过完整验证矩阵和安装/卸载烟测。

## 本地候选包验证

在干净工作树中运行：

```powershell
npm ci
npm run verify:version -- --tag v0.0.1
npm test
npm run test:e2e
npm run audit:runtime
npm run dist
npm run verify:package
npm run verify:version -- --tag v0.0.1 --artifacts
npm run notices
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.1.exe
```

v0.0.1 的签名状态预期为 `NotSigned`。ASAR 必须小于 12 MiB，安装包必须小于 110 MiB。

## 版本与 tag

版本采用 SemVer。`package.json`、tag、安装包文件名和 `latest.yml` 必须一致。创建 tag 前先运行版本校验：

```powershell
npm run verify:version -- --tag v0.0.1
git tag -a v0.0.1 -m "摘星阁 v0.0.1"
git push origin v0.0.1
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会依次执行版本检查、单元测试、真实 Electron 测试、生产依赖审计、构建、包审计、SHA-256、SBOM 和第三方声明生成。全部成功后才会运行 `gh release create`。

## 发布资产

v0.0.1 Release 应包含：

- `Star-Picking-Pavilion-Setup-0.0.1.exe`
- `Star-Picking-Pavilion-Setup-0.0.1.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

发布完成后下载到新的临时目录，按 `SHA256SUMS.txt` 重新校验并执行一次安装、启动、单实例、退出和卸载烟测。

## 回滚

不要覆盖或强推已经公开的版本资产。若候选 tag 尚未形成有效 Release，可以在确认精确目标后删除失败的远端 tag，再用包含修复的新提交重新创建；若用户已下载该版本，则发布更高的补丁版本并在变更日志中说明。
