# 摘星阁 v0.2.18

本版调整更新按钮的显示时机、情报日志的日期导航位置，以及顶栏搜索条的聚焦边框。

- **按需显示更新按钮**：启动、后台检查和已是最新版本时隐藏更新按钮；检测到新版本后显示下载进度。下载失败时保留重试入口，下载完成后保留“重启”入口，安装完成并确认最新后隐藏。下载达到 100% 时仍需重启安装。
- **日期导航下移**：情报日志“报告概况”中的左右方向标与日期整体下移，给上方标题留出更多空间。日报、周报、月报共用调整，宽窄窗口及四档缩放同步适配。
- **搜索条聚焦边框**：顶栏“检索情报库”沿外层圆角条形边框显示聚焦反馈，与更新日志搜索条使用同样的主题色焦点反馈，去掉内部输入框多出的长方形描边。鼠标点击和键盘聚焦均适用，高对比度模式保留外层焦点描边。
- **兼容与保留**：浅色、深色主题、减少动画及低功耗设置继续适用；已有情报、星标、归档、模型密钥与个人设置保留，无新增依赖。

实现与验证见 [v0.2.18 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0218-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.18.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.18.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
