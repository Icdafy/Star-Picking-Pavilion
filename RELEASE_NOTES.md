# 摘星阁 v0.2.21

本版全面梳理低空经济、商业航天和一级市场新闻信源，扩展有效国内与海外入口，并加入外网检测及海外新闻中文翻译。

- **信源清理与修复**：清理 5 个重复关键词检索及 1 个身份不符的网站，修正投资界融资栏目和官方、创投网站的新闻选择器。移出入口仍保留历史文章及来源信息。
- **有效信源扩展**：新增 21 个经实际解析核验的入口，内置共 201 个。国内增加蓝箭航天、星河动力、亿航、中国航空新闻网、科技日报、科学网、中科院、钛媒体、界面新闻与投资界基金资讯；海外增加 SpaceNews、NASA、ESA、Spaceflight Now、Rocket Lab、Joby、EHang 等。
- **外网自动检测**：结合脱敏出口 IP 和实际连通性判断，支持 HTTP(S) 环境代理与 Windows 手动系统代理。外网可用时采集 16 个海外入口；不可达时静默跳过，不报信源错误、不增加失败次数，国内采集正常运行。信源页可查看状态并手动检测。
- **海外新闻中文翻译**：捕获外文新闻后，将标题和摘要译为简体中文，SpaceX、Rocket Lab、Joby、NASA、型号等专有名称保留英文，再进入低空经济与商业航天分析、检索和出刊。原文及原始发布时间保留。
- **翻译与预算衔接**：复用「设置 → 分析模型」的现有配置、付费回执与调用预算。无密钥、预算耗尽或翻译暂未完成时保留待译内容，普通信息流等待中文版；已收藏内容仍以中文待译提示留在星标，信源页显示待翻译数量。
- **兼容与保留**：升级保留用户启停和移出监控状态、采集统计、已有情报、星标、归档、模型密钥及个人设置；浅色、深色主题、缩放、减少动画设置和原有动效继续适用，无新增依赖。详细名单、移除依据及运行限制见 [信源梳理](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0221-sources.md)和[验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0221-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.21.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.21.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
