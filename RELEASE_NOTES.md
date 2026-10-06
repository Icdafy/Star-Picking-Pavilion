# 摘星阁 v0.2.19

本版仅微调情报日志“报告概况”横幅中的日期位置。

- **日期轻微上移**：情报日志“报告概况”中的日期导航稍微上移，使日期更接近横幅上下边缘之间的中间位置，左右方向标随日期保持同轴对齐。
- **刊期与显示适配**：日报、周报、月报共用调整，宽窄窗口、四档界面缩放及浅色、深色主题同步适配。横幅尺寸、日期字号和报告功能沿用，无新增依赖。
- **兼容与保留**：浅色、深色主题、减少动画及低功耗设置继续适用；已有情报、星标、归档、模型密钥与个人设置保留。

实现与验证见 [v0.2.19 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0219-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.19.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.19.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
