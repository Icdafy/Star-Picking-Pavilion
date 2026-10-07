# 摘星阁 v0.2.27

软件内 Logo 更新为本次上传的金色星星与紫色弧线动画，默认静止，鼠标悬停时播放。

- **默认静止，悬停播放**：指挥栏 Logo 在鼠标未移入时保持第一帧；鼠标移入后循环播放原稿的 5.2 秒“跃升摘星”动效，移开立即恢复第一帧，再次移入从头播放。悬停旁边的文字不会触发动效。
- **采用上传的 SVG**：保留原稿的六条动画轨道、轮廓、颜色和透明背景。SVG 约 20 KB，缩放清晰，比同稿 WebP（约 1.65 MiB）和 GIF（约 702 KiB）更适合桌面界面；静态回退图从同一 SVG 第一帧生成。
- **适配主题与窗口**：宽窄窗口保留正方形比例，深色主题提亮紫色弧线。系统开启减少动态效果、窗口失焦或退到后台时恢复静态显示；动画资源加载失败时保留静态 Logo。
- **版本信息同步**：应用界面、安装器、自动更新元数据与内置更新日志统一为 0.2.27。已有情报、星标、归档、模型密钥与设置保留，无新增运行依赖。

桌面动效检查与发布证据见 [v0.2.27 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0227-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.27.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者；请先核对 `SHA256SUMS.txt`。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.27.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
