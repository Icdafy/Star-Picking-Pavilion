# 摘星阁 v0.2.12

本版重新整理情报工作区，新增应用内更新日志与设置章节快捷导航，保留现有情报、星标、备忘、模型密钥与个人设置。

- **更新日志**：新增独立板块，完整收录 GitHub Releases 中的 39 个历史版本及本版说明，按版本倒序展示。当前版本默认展开，支持搜索与逐版展开；联网时自动同步后续正式版本，离线时读取内置记录和已同步记录，也可手动同步或打开 GitHub 原文。
- **分类再次点击取消**：全部动态顶部七个分类再次点击后回到未限定分类的列表，同时清除分类高亮与动效选择块。领域和检索词继续按当前选择生效；鼠标、键盘和快速连续点击一致。
- **情报工作区顺序**：热点、精选、全部动态、星标、情报日志、一级市场、更新日志、常用网址、信源、设置。原“情报日报”更名为“情报日志”，其中的日报、周报和月报沿用；导航内容、命令面板及快捷键提示同步调整。
- **设置快捷导航**：模型、精选标准、采集调度、每日新闻资料库、存储治理、桌面运行、显示与排版、界面氛围、键盘快捷键依序排列。宽窗口固定显示章节目录，窄窗口使用自动换行的横向快捷栏；点击定位章节，滚动同步当前高亮。跳转遵循减少动画设置，所有原有设置和保存操作保留。
- **后续发版同步**：增加更新日志生成与校验，构建前核对本版说明和内置日志，后续版本使用同一发布说明同步应用与 GitHub Releases。无新增运行依赖。

设置导航参考 [Linear 的设置重设计](https://linear.app/changelog/2024-12-18-personalized-sidebar)与 [VS Code 设置目录](https://code.visualstudio.com/docs/configure/settings)，结合摘星阁现有双主题与玻璃材质实现。具体实现和验证见 [v0.2.12 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0212-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.12.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.12.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
