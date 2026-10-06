# 摘星阁 v0.2.15

本版完善情报工作区的情报日志：日期居中放大，日报、周报、月报统一支持复制、导出文件和重新生成。现有情报、星标、归档、模型密钥与个人设置继续保留。

- **报告概况**：保持原横幅尺寸，日期置于横幅正中，字号放大 50%；删除“生成于”时间。三项统计、报告状态、前后日期／刊期导航继续保留。
- **统一报告操作**：日报、周报、月报均显示复制、导出文件、重新生成。复制按钮随当前刊期显示“复制日报”“复制周报”“复制月报”，各操作使用当前报告日期或期号；重新生成刷新所选刊期，切换报告时保留请求竞态保护。
- **导出文件**：点击后下拉选择 `.md` 或 `.doc`。Markdown 保留标题、分组和原文链接；Word 使用真正的 Word 97–2003 二进制文档，支持中文与 emoji，生成与下载均在本机完成，无需安装 Office。导出包含本期导语、热点、分类精选、一级市场、我的关注、公司声量榜及技术突破等已有内容。
- **适配与保留**：浅色、深色主题、四档缩放、宽窄窗口和键盘操作继续适用；下拉菜单支持 Enter 打开、Tab 选择、Escape 或点击外部关闭，切换刊期自动关闭。沿用减少动画、低功耗及后台暂停策略，无新增运行依赖、脚本标签或动画关键帧。

实现与验证见 [v0.2.15 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0215-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.15.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.15.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
