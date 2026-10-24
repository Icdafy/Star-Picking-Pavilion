# 摘星阁 v0.2.45

## 采集结束提示修复

- **结束后自动收起灵动岛**：本轮采集分析结束后清除顶部管线提示，不再一直显示“本轮暂缓”。重复刷新状态不会重新弹出已结束的任务，新一轮运行时照常显示实时进度。
- **完成文案更清楚**：将“本轮已完成，部分资料等待下轮分析”统一改为“本轮已完成”。
- **处理记录仍可回看**：设置 → 自动采集 → 本轮处理记录继续保留结果、步骤、耗时与预算等详细说明。

升级保留已有情报、星标、备忘、归档、密钥与全部设置，无新增依赖。

版本、安装器和自动更新元数据统一为 **0.2.45**。实现与验证详见 [v0.2.45 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0245-validation.md)。正式附件由 GitHub Actions 完整门禁通过后构建并上传。

下载 `Star-Picking-Pavilion-Setup-0.2.45.exe` 安装；升级安装会保留用户数据。附件包含安装器、自动更新 blockmap、`latest.yml`、`SHA256SUMS.txt`、CycloneDX SBOM 和第三方声明。安装包未签名，Windows SmartScreen 可能提示未知发布者，可先用 `SHA256SUMS.txt` 校验。
