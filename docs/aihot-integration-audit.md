# AIHOT 整合核对（v0.2.1）

2026-09-29 核对 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT) 的提交 `f6c2952a9984d4840442558be114ac959b512b0c`，本地基线 v0.2.0。读取上游架构、信源、精选、事件及公开出口实现后逐项比对。

**v0.2.0 已移植核心业务流程，但不是 AIHOT 整仓或所有功能的完整移植。** 本地 Electron/SQLite 与上游 React SSR/Fastify/PostgreSQL/pg-boss/Docker 的架构不同。不能把核心适配写成全部代码已并入。

| 上游能力 | 本地结果 |
|---|---|
| 行业包、提示词版本、分类与分级门槛 | 已适配：`config/industry/`、`server/industry.js` |
| 预筛 UNKNOWN 补正文、同标准两次独立评分 | 已适配：`editorial.js`、`pipeline.js`，测试覆盖分级门槛 |
| 中文标题、摘要、推荐理由、实体与事件 | 已适配，保留事实与外部文本安全边界 |
| 回执、预算熔断、页面不调模型 | 已适配；仅小时/天预算，未移植所有服务的分钟级预算 |
| 召回及三分类归组 | 已适配事件键、公司、字面倒排；未采用上游付费向量服务，语义召回覆盖不完全等价 |
| 不确定归组二次复核 | v0.2.1 补充低于 0.85 置信度的独立复核与回执；仍使用唯一配置模型，不等于上游跨模型复核 |
| 独立出版方热度、窗口、衰减、走势、综述 | 已适配：`hot.js`、`stories.js` |
| 日报、周报、月报与导语 | 已适配：`daily.js`、`reports.js` |
| 公开 RSS、网页、JSON、公众号 | 免费入口已适配；公众号仅公开文章/订阅。未接入收费 Dajiala、SocialData X、Jina |
| 公司主题、搜索、管理诊断 | 本地公司档案、信源及诊断；v0.2.1 各一级市场分区共用企业搜索 |
| 公司别名、融资、关注与被投 | 本地扩展；本次补充历史归一、轮次、金额与日期修复 |
| RSS 输出、MCP、OpenAPI、站点地图、分享图、全文翻译、人工锁定归组、外部推送 | 未整体移植；已提供本机鉴权 API、Markdown/文本导出，不能称为等价 |
| 飞书、IndexNow、云端管理、模型榜、Codex 监控 | 未移植，为原框架运营或 AI 专属模块 |
| 许可署名 | MIT 原文保留在 THIRD_PARTY_NOTICES.txt，不使用 AIHOT 品牌标志 |

验证：`test/v020-engine.test.js`、`test/v020-api.test.js`、`test/v021-capital.test.js`、`test/e2e/v021-ui.test.js`，不代表上游全部功能的等价验证。
