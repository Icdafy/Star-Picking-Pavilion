# 摘星阁 v0.2.1

一级市场与界面优化版，保留数据库、星标、备忘与偏好。

- 一级市场各分区支持企业名称、别名和型号搜索；新增企业动态，集中展示订单、取证、试验等进展。
- 追梦空天／追梦空天科技统一归属，迁移合并历史融资，保留原文证据、投资方和关注备注。
- 保留 A++、A++++、B1、天使+ 轮次，区分 Pre-IPO 与 IPO；约数不冒充精确金额，历史报道不冒充近期融资。
- 修正深浅主题下拉选项，窄窗口保留融资原文和投资方。
- 界面氛围总开关放在恢复默认左侧，关闭后隐藏背景并暂停流体与星鲸渲染，重启后保留。
- 新增投中网、36氪空天、航投基金及产业链免费检索，修复五条检索线，暂停两条持续空结果源。
- AIHOT 核心链路逐项核对，并补充不确定事件的独立复核。两次独立评分、当前热点、一级市场、日报及周报月报继续使用 deepseek-v4-flash-vision-exp。

[AIHOT 整合审计](https://github.com/Icdafy/Star-Picking-Pavilion/blob/v0.2.1/docs/aihot-integration-audit.md)：本地为核心流程的桌面适配，并非上游全部功能整仓移植。

**公众号限制**：商业航天发展三个用户提供链接实测均要求微信环境验证，保留入口并标为受限，不能声称采集成功。持续采集仍需可用公开订阅和可读原文。[信源实测](https://github.com/Icdafy/Star-Picking-Pavilion/blob/v0.2.1/docs/v021-sources.md)。

## 下载与校验

安装包：`Star-Picking-Pavilion-Setup-0.2.1.exe`。此版本尚未代码签名，Windows SmartScreen 可能提示未知发布者；签名状态预期为 NotSigned。请核对 SHA256SUMS.txt 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.1.exe
Get-Content .\SHA256SUMS.txt
```

附带 blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明。GitHub Actions 完成测试、包检查与安装／卸载烟测后发布。
