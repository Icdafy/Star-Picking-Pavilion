# 摘星阁 v0.2.14

本版完善热点与情报日志的统一页头，压缩报告概况，并重新整理一级市场的分区与筛选。现有情报、星标、归档、模型密钥与个人设置继续保留。

- **页头横幅**：热点、情报日志采用与精选、全部动态、星标、一级市场等页面相同的栏目、标题、说明、右侧状态和星轨装饰。热点领域筛选、实时热度说明与情报日志出刊节奏保留。
- **报告概况**：收紧上下留白和日期字号。宽窗口将日期、状态、生成时间与三项统计左右对齐，窄窗口自然分为上下两行；统计标签与数字各自对齐，生成信息不再重复数量和状态。日报、周报、月报继续同步各自统计，保留加载、失败、重试与日期边界。
- **一级市场选项卡**：六个分区采用同一行等宽导航，选中项清晰高亮；下方独立展示当前分区的用途，再将领域、时间范围、标的范围、搜索按标签整齐排列。公司热度和公司库显示各自的统计范围，不再展示不适用的时间下拉框。切换分区保留原筛选，支持方向键、Home / End 移动焦点及 Enter / Space 激活。
- **主题与操作**：浅色、深色主题、四档缩放和宽窄窗口继续适配；文字与星轨动效沿用既有减少动画、低功耗和后台暂停策略。统一工具栏保留日报、周报、月报切换及日报复制、导出 .md、重新生成的操作范围。

设计参考 [IBM Carbon 的标签、对齐与键盘交互规范](https://carbondesignsystem.com/components/tabs/usage/)与 [Ant Design 的统计展示](https://ant.design/components/statistic/)，复用摘星阁现有 Aqua 材质、语义颜色和共享页头。无新增运行依赖、外部图片、脚本标签或动画关键帧；清理旧页头与重复样式以保持原有样式预算。实现与验证见 [v0.2.14 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0214-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.14.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.14.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
