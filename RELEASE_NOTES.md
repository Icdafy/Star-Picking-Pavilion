# 摘星阁 v0.2.26

统一更新摘星阁 Logo，使用本次上传的白色圆角底、金色星星与紫色弧线图片。

- **界面与页签统一**：桌面指挥栏、宽窄窗口以及网页页签使用同一张原图，保留轮廓和透明度。
- **主题颜色自动适配**：软件内 Logo 随浅色、深色主题即时变色。浅色使用原图的白底、金色星星与紫色弧线，深色使用深色底、金色星星和较亮的紫色弧线，切回浅色恢复原图颜色。
- **桌面图标统一**：Windows 应用、窗口、任务栏、系统托盘、后台通知、桌面和开始菜单快捷方式，以及安装、卸载程序均采用新版 Logo。
- **可复现的图标资源**：上传的 PNG 保存为项目 Logo 原图，图标生成脚本从同一文件生成 512 像素 PNG 和 16—256 像素多尺寸 ICO，避免重新构建时恢复旧雷达图标。
- **版本信息同步**：应用界面、安装器、自动更新元数据与内置更新日志统一为 0.2.26。已有情报、星标、归档、模型密钥与设置保留，无新增运行依赖。

资源覆盖、桌面检查与发布证据见 [v0.2.26 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0226-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.26.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者；请先核对 `SHA256SUMS.txt`。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.26.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
