# AIHOT 整合核对（v0.2.2）

2026-09-30 核对 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT) 的 `main` 至提交 `885b736dc0fd3ef3d4c9c70af2bc3a981a99ff38`（上次核对为 v0.2.1 时的 `f6c2952`）。逐个读取上游提交的差异，对照本地实现，能对应到本地功能的全部移植并补测试，不能对应的写明原因。

**结论：AIHOT 的核心业务流程已完整适配到桌面版，截至 885b736 的上游修复已全部同步或确认不适用；但这不是上游整仓移植。** 本地 Electron/SQLite 与上游 React SSR/Fastify/PostgreSQL/pg-boss/Docker 架构不同，云端运营模块未移植（见文末）。

## 上游提交逐项核对

| 上游提交 | 内容 | 本地结果 |
|---|---|---|
| `885b736` pairwise event-relation evaluation harness | 报道对四分类评测、混淆矩阵、门槛扫描、回执复用 | 已移植：`scripts/eval-relations.js`（`npm run eval:relations`），接受上游四分类并汇总到本地三分类，走同一套 group-pair 提示词、回执与预算；`test/v022-sync.test.js` |
| `6a8ad4b` validate tweet URL host | 推文 ID 解析前校验 x.com / twitter.com 主机 | 不适用：本地没有 X/推文素材去重（上游付费 SocialData 渠道未接入），无对应代码 |
| `6052bb8` revert PR review setup | 仓库 CI 配置 | 不适用 |
| `f6c2952` PR review rules | 仓库协作配置 | 不适用 |
| `e9d40e2` leaderboard tooltip | 模型榜 | 不适用：模型榜未移植 |
| `1db4b16` preserve Atom XHTML text constructs | Atom `type="xhtml"` 混合内容 | 已移植：`server/collectors/rss.js` 解析前改写为等价 HTML 文本；此前本地标题会变成 `[object Object]` |
| `68bd04c` normalize invalid bookmark dates | 网页端浏览器本地收藏日期 | 不适用：本地星标存于 SQLite（`starred_at` 由服务端写入），没有浏览器本地收藏 |
| `44578fa` image viewing, tooltip, changelog unread | 网页端交互 | 不适用：对应网页组件未移植；本地卡片图片与提示另有实现 |
| `8bf54f9` links follow site identity | 网页品牌 | 已符合：本地导出与链接使用摘星阁身份，不使用 AIHOT 品牌 |
| `127361b` Docker worker stop | 容器编排 | 不适用 |
| `de4be99` list-page date read in source offset | 无时区日期按信源时区 | 已移植：`server/collectors/loose-date.js`，网页列表（`html.js`，可配 `utcOffset`）与交易所接口（`api.js`）共用；拒绝 2 月 30 日等非法日期 |
| `de46b70` prevent omissions across report periods | 迟到入选资料归入下一期、报告快照与发布协调 | 已适配：周报 / 月报按 `max(采集, 归组完成)` 归属，未归组资料等归组后再进入当期；刊期融资改按入库时间归属（修复日报“0 起资本事件”） |
| `589f79e` visitor address / random DB password | 服务端部署安全 | 不适用：本地仅监听 127.0.0.1，随机端口与令牌、凭据经 safeStorage 加密 |

## 核心能力对照

| 上游能力 | 本地结果 |
|---|---|
| 行业包、提示词版本、分类与分级门槛 | 已适配：`config/industry/`、`server/industry.js` |
| 预筛 UNKNOWN 补正文、同标准两次独立评分 | 已适配：`editorial.js`、`pipeline.js` |
| 中文标题、摘要、推荐理由、实体与事件 | 已适配，保留事实与外部文本安全边界 |
| 回执、预算熔断、页面不调模型 | 已适配；仅小时/天预算 |
| 召回、三分类归组、灰区独立复核 | 已适配；v0.2.2 补事件级合并（同批次并行事件、综述后标题趋同的事件），灰区同样三分类并复核 |
| 关系评测 | v0.2.2 已适配（见上表 885b736） |
| 独立出版方热度、窗口、衰减、走势、综述 | 已适配；v0.2.2 转载文章按“文章来源”计真实出版方，同一出版方不同写法归一 |
| 日报、周报、月报与导语 | 已适配；v0.2.2 同步刊期归属修复 |
| 外部内容导入（external） | v0.2.2 已并入安装包：本机鉴权接口、信源页导入、判重、历史回灌；见 [external-ingest.md](external-ingest.md) |
| 公开 RSS、网页、JSON、公众号 | 免费入口已适配；公众号仅公开文章/订阅。未接入收费 Dajiala、SocialData X、Jina |
| 公司主题、搜索、融资、关注与被投 | 本地扩展；v0.2.2 新增市场概览、事件性质分类、名称变体去重、导出与交易所上市进程 |
| RSS 输出、MCP、OpenAPI、站点地图、分享图、全文翻译、人工锁定归组、外部推送 | 未整体移植；已提供本机鉴权 API、Markdown/CSV/文本导出，不能称为等价 |
| 飞书、IndexNow、云端管理、模型榜、Codex 监控 | 未移植，为原框架运营或 AI 专属模块 |
| 许可署名 | MIT 原文保留在 THIRD_PARTY_NOTICES.txt，不使用 AIHOT 品牌标志 |

验证：`test/v020-engine.test.js`、`test/v020-api.test.js`、`test/v021-capital.test.js`、`test/external-ingest.test.js`、`test/v022-sync.test.js`、`test/v022-capital.test.js`、`test/v022-render.test.js` 与 Electron e2e。这些测试覆盖本地适配行为，不代表上游全部功能的等价验证。
