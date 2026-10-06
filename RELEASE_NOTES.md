# 摘星阁 v0.2.16

本版优化情报日志日期导航，并将更新功能移到工作区侧栏，用按钮内的环形进度展示下载状态。

- **报告概况排版**：保持既有横幅尺寸，日期居中放在“精选情报”统计左侧的可用区域，上一期与下一期按钮分列日期两旁。日报、周报、月报共享布局，报告状态及统计保留。
- **工作区更新按钮**：更新入口移至左侧“本地情报工作区”右侧；窄窗口在品牌下方保留工作区入口。点击检查更新，失败可重试；下载完成后点击重启安装。
- **环形下载进度**：按钮内的 SVG 环与百分比显示真实下载进度；检查或未知进度使用旋转短弧，下载完成切换为“重启”。鼠标悬停与键盘焦点可查看版本和状态。
- **动效与可访问性**：环形进度平滑过渡，轻抬悬停与按压反馈沿用现有配色；减少动画、低功耗及后台暂停继续适用。明确提供按钮名称、进度数值及分段状态播报，避免重复下载和重复安装。
- **兼容与保留**：浅色、深色主题、四档缩放、宽窄窗口及三种刊期继续适用；已有情报、星标、归档、模型密钥与设置保留。无新增依赖、脚本标签或动画关键帧。

设计参考 [Material 环形进度](https://github.com/material-components/material-components-android/blob/master/docs/components/ProgressIndicator.md)与 [Radix 图标按钮状态](https://www.radix-ui.com/themes/docs/components/icon-button)，以原生 SVG/CSS 实现。完整实现与验证见 [v0.2.16 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0216-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.16.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.16.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
