# 摘星阁 · 低空经济与商业航天情报站

聚合信源、AI 精选**中国与全球低空经济、商业航天**热点的桌面情报站。
开源、免费、**本地运行**——数据只存在你自己电脑上。

架构沿用 [AIHOT](https://aihot.virxact.com/)（数字生命卡兹克）的核心哲学：

> **能用脚本就别用模型** —— 模型只打五维分，最终质量分、精选判定、日报全部由代码公式完成，可控可调。

---

## 下载安装（普通用户）

1. 到 [Releases](https://github.com/Icdafy/Star-Picking-Pavilion/releases) 下载 `Star-Picking-Pavilion-Setup-0.0.1.exe`
2. 双击安装（未做代码签名，Windows SmartScreen 可能提示一次：点「更多信息 → 仍要运行」即可）
3. 打开即用 —— **无需安装 Node、无需注册、无需配置**

安装后**自动更新**：作者发布新版本后，应用下次启动会自动检测、后台下载，右上角出现「▲ 重启安装」，点一下即完成升级。

### 想要更聪明的 AI 精选？（可选）

默认运行**关键词启发式**模式：照常采集、打分、精选、出日报，零配置。
如果你想要更精准的「五维 AI 评分 + 情报研判」，在『设置』里填入自己的 [DeepSeek API Key](https://platform.deepseek.com/)（很便宜，按量付费），点「测试连接」通过即生效。

> 🔒 本项目**不内置任何人的 API Key**。Key 只保存在你本机的设置里，不上传、不共享。

---

## 功能

- **实时捕捉**：后台持续采集 + 持续打分，前端不刷新也自动跟上新情报（右上角「实时」可开关）
- **精选 / 热点 / 全部动态**：五维评分 → 代码公式算质量分 → 按分类阈值判精选（约 14% 精选率，保护注意力）
- **情报研判**：每条精选附 AI 一句话「为什么值得看」编者按
- **多源聚类**：同一事件多家报道折叠为「N 个信源 · 关联报道」
- **情报日报**：每天 08:05 纯代码分桶生成
- **全文检索**：FTS5 中文检索
- **信源管理**：国内外信源增删改，支持 RSS / 网页爬虫 / 关键词 API / RSSHub

## 信源

内置数十个信源，以**大陆网络可达**为主：
- **官方一手 (T1)**：民航局、工信部、国家航天局、航天科技/科工集团等官网
- **关键词聚合 (T2)**：东方财富全网搜索（低空经济、eVTOL、可回收火箭、卫星互联网，及 SpaceX/星链/Joby 等海外公司中文报道）
- **科技媒体 RSS**：36氪、IT之家、虎嗅
- **国外原生 / 公众号**：经 RSSHub 中转（在『设置』填入 RSSHub 地址后启用对应信源；谷歌新闻等需代理）

---

## 开发 / 从源码构建

```bash
npm install                 # 安装依赖（Electron 经镜像更快：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
npm start                   # 启动桌面应用（内置 Node 跑后端，无需系统 Node）
npm run server              # 仅启后端，浏览器开 http://127.0.0.1:7644 调试
npm run pipeline            # 手动跑一轮采集→分析→聚类→日报
npm run icon                # 重新生成应用图标（需 Python + Pillow）
npm run dist                # 打包出 Windows 安装包到 dist/（本地，不发布）
```

- **桌面壳**：Electron 主进程用 `utilityProcess` + 内置 Node 跑独立后端（HTTP :7644）
- **数据库**：Node 内置 SQLite（含 FTS5），打包版数据存于用户 `userData` 目录
- **AI 接口**：OpenAI 兼容协议，`baseUrl` 可换硅基流动 / 火山方舟 / 本地 Ollama

发布新版本（维护者）见 [RELEASING.md](RELEASING.md)。

## 配置

| 文件 | 内容 |
|---|---|
| `data/settings.json` | DeepSeek Key、模型、采集/分析间隔（设置页可视化编辑；**已 gitignore，不入库不打包**）|
| `config/scoring.json` | 五维权重、信源等级系数、各分类精选阈值、热度半衰期、聚类阈值 |
| `config/sources.default.json` | 信源种子库（按 `_version` 幂等增量同步）|

## 许可

MIT —— 自由使用、修改、分发。
