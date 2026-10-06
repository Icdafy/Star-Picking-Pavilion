# v0.2.12 验证与发布记录

目标仓库为 Icdafy/Star-Picking-Pavilion，版本、Windows 产品版本与构建版本均为 0.2.12。本次工作只调整情报工作区导航、分类取消状态、更新日志和设置章节定位，保留应用 ID、数据库路径、设置格式、模型密钥及归档流程。

## 实现与设计依据

- 侧栏顺序为热点、精选、全部动态、星标、情报日志、一级市场、更新日志、常用网址、信源、设置。实际内容面板跟随顺序；三个信息流入口继续共用同一面板。命令面板、Alt+1–9／0 和 G U 同步。
- GitHub Releases 于 2026-10-06 读取到 39 个已发布正式版本，最早为 v0.0.2；v0.0.6 没有正式 Release，没有制造记录。逐条核对 tag 与原始正文，39 个历史记录均完整匹配。加上本版为 40 条。
- 本版正文与 RELEASE_NOTES.md 是同一份内容，生成脚本、版本检查、构建前检查和单元测试共同校验。运行时通过固定 GitHub API 请求合并完整分页，过滤草稿和预发布，保留离线历史及已同步缓存；请求不发送本地情报、密钥或用户配置。成功限频五分钟，失败一分钟，超时八秒，退出时中止请求。
- 更新日志使用原生 details 展开，当前版本初始展开，完整版本号精确检索 tag，其他词检索正文。远端 HTML 转义；只生成文字、标题、列表、安全链接和代码，不执行脚本或内嵌内容。
- 分类的实际筛选状态在旧版已经可取消；修复的是无活动分类时选择块仍残留的问题。同时由状态判断二次点击，避免装饰与业务状态不一致。
- 设置参考 [Linear 设置重设计](https://linear.app/changelog/2024-12-18-personalized-sidebar)的明确分节、[VS Code 设置目录](https://code.visualstudio.com/docs/configure/settings)的章节定位。在既有材质内采用固定目录＋连续内容列，窄窗口改为自动换行的横向快捷栏。定位和滚动高亮以实际 appViewport 为准，减少动画直接定位，键盘点击移交标题焦点，离开页面解除滚动／尺寸监听。
- 页面脚本仍为 27 个，无新运行依赖或关键帧。精简过时的样式开发历史说明，CSS 按 Windows CRLF 最坏口径为 298,334 B，低于既有 292 KiB／299,008 B 门槛，预算未上调。

## 已完成的专项与初轮问题

真实 Electron 专项验证七个分类选中／再次点击恢复、分类选择块隐藏、领域和检索保留、Enter／Space／双击、40 条版本阅读、精确版本检索、无结果状态、九章顺序与定位、滚动高亮、键盘标题焦点、深浅主题及宽窄窗口，首轮因正文也含历史版本号导致精确版本检索匹配两条，已增加完整版本号按 tag 精确匹配并复验通过。

视觉检查发现点回第一章时“设置”标题停留在吸顶工具栏下面，已改为回到页首。最终完整回归已重新生成八张宽窄／深浅截图，留在 work/v0212/screenshots。

初轮完整桌面回归为 17／20：三处测试仍断言旧九项导航、精选右侧为热点、命令名称为情报日报。断言按用户要求同步为十项、新顺序和情报日志，未降低动效、几何或焦点精度。随后布局专项定位到横向滚动目录末项超出可见边界，改为自动换行，让九个快捷标题在窄窗口下均可直接看到；保留原“无交互元素越界”断言。旧日志分别保存在 e2e-first.log、ui-matrix-first.log。

## 信源与依赖

生产依赖审计为 0 个漏洞；本轮没有新增依赖。第三方声明已按 0.2.12 重新生成。

实网信源复查：186 项中 184 返回内容，1 项为空（东财检索·穿越者）、1 项失败（泰伯网·空天资讯，fetch failed）。audit:sources --strict 因此退出 1，不将其记作严格通过。本次未更改信源目录和采集逻辑；公开站点的本轮可用性单独披露，不用删源掩盖失败。证据在 work/v0212/source-audit.{log,json}。

## 最终本地、CI 与正式附件

最终完整本地回归：892／892 单元与集成测试（15.27 秒），20／20 真实 Electron 测试（153.05 秒），128 个窗口／缩放／视图组合通过，fail／cancelled／skip／todo 为 0。最终实现的八张深浅／宽窄截图已复核，第一章返回页首及窄窗口九项快捷标题均完整可见。日志在 work/v0212/unit.log、e2e.log。

本地候选包构建成功，1273 项包边界通过；app.asar 为 13,579,421 B，安装包为 99,581,374 B。十二项本轮生产文件与 ASAR 逐字节一致。PE 文件／产品版本、包内公开版本与更新元数据均为 0.2.12，签名 NotSigned；安装器 SHA-256 为 `71d959bdfa5724e391799b238f0bbd9bf2cac097e43933ed5855dd9561f7cecb`。证据在 work/v0212/build.log、package-audit.log、candidate-metadata.json、candidate-asar.json。辅助检查最初读取包内 build.buildVersion，但 electron-builder 会剥离构建配置；已按实际包结构核对包内版本与 PE 两个版本，十二项字节核对均通过。

产品提交为 `e8c5ca1d99efccae32c3de34c73c58c00ad728c8`。[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37419711923) 首次执行全部通过：892／892 单元、20／20 真实桌面、0 生产漏洞、47 项声明无差异、1273 包边界，以及一次性 Windows 安装、启动、单实例、退出与卸载成功，用户数据保留。CI app.asar 为 13,589,936 B，安装包为 99,577,315 B；与本地候选产物分别记录。原始 metadata／完整日志／直接核验在 work/v0212/main-ci.{json,log,verified.json}。

注释 tag `v0.2.12` 对象为 `81711f159c046cb739dc1d289281140f37a4bbe0`，远端解引用为上述产品提交。既有 Release 工作流第 2 次完整通过并生成正式附件，详见下方下载复核。本机没有运行安装器或设置伪造 CI 环境。

运行时匿名 GitHub 同步在首次八秒内未完成，按设计保留 40 条本机日志；随后原八秒超时设置下实网同步成功（4.56 秒、2026-10-06T05:42:19.545Z），40 条合并记录与缓存均可用。失败与成功分别保存在 work/v0212/real-sync.json、real-sync-retry.json，缓存位于隔离的 work/v0212/sync-cache，不将重试成功描述成网络原因已修复。

### Release 首轮失败与原样诊断

Release 首次执行失败（[attempt 1](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37420427051/attempts/1)）：892 单元通过、桌面 19／20，新增 v0212、128 布局及其他功能通过；旧 v0211 卡片光效测试在 test/e2e/v0210-motion.test.js:328 的“核心位置领先光晕超过 5 px”断言失败。首个样本 core=210.3949、halo=205.8701，差值约 4.52 px，随后三个样本间隔约 109 ms 且接近终态；页面为 full、前台、有焦点。该采样现象不能单独确认为根因。后续审计、构建、安装、SBOM 和发布步骤均未执行，没有正式附件。原始输出与 metadata 在 work/v0212/release-attempt1-failed.{log,json}。

原样本地复查整个动效测试文件为 5／5、fail／cancelled／skip／todo 0，33.03 秒，日志为 work/v0212/release-motion-diagnostic.log。光效实现和该断言相对旧版本未改变，未改阈值、跳测、伪造时间或覆盖 tag。原因尚未定位；已对原 tag／原提交开启 Actions 调试日志，完整重跑既有发布门禁。本地未复现不等于已经修复。

## 正式发布与下载复核

[v0.2.12](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.12) 于 2026-10-06T06:05:38Z 发布，draft=false、prerelease=false，latest 指向该 Release。上述产品提交的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37419711923) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37420427051/attempts/2) 均最终完整通过（main 首次、Release 第 2 次），Release 同样为 892／892 单元、20／20 桌面、fail／cancelled／skip／todo 0、审计 0 漏洞、47 项声明无差异、1273 包边界，版本和 SBOM Schema 检查通过；一次性 Windows 安装、启动、单实例、退出与卸载成功，用户数据保留。正式构建 app.asar: 13589936 bytes (12.96 MiB)；installer: 99577316 bytes (94.96 MiB)。原始完整证据为 work/v0212/release-ci.{json,log,verified.json}。

六项正式附件重新下载到新的隔离目录，均为 uploaded，逐项大小与 GitHub SHA-256 摘要完全匹配；SHA256SUMS.txt 与实际安装器一致。

| 附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `c7e68fbd897349fd50a21a6ee14976e59f15926940c3c68c4ea495ae10865a30` |
| sbom.cdx.json | 81,352 | `9023e17652a77e0c99674b2fa2bc8d93d8e73827e2b278c580706115495e0b35` |
| SHA256SUMS.txt | 106 | `102f388d59fe642302570b69f377243609f6461006f42eccef406773fea7d576` |
| Star-Picking-Pavilion-Setup-0.2.12.exe | 99,577,316 | `c561619a7ad8691e4b22cf501c78f963eda0ee5d1608b654f4447f312482d92b` |
| Star-Picking-Pavilion-Setup-0.2.12.exe.blockmap | 105,944 | `971e331d1dbaa143d62b5b98a6cecbcab13c669eb084be5efb8f054e29e57b2e` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `b218311bc86c465e2a295883979a81d4454c91f4806f98534914e3fc1d0f846d` |

PE 文件／产品版本均为 0.2.12、NotSigned。latest.yml 的版本、文件名、尺寸以及两个 SHA-512 字段均匹配实际安装器；SBOM 为 CycloneDX 1.6、产品 0.2.12，第三方声明与提交逐字节一致。原始元数据、下载文件和 PE 记录位于 `F:/摘星阁/work/v0212/published-20261006060614564`；汇总为 work/v0212/published.verification.json。

公开 Release 正文、内置本版日志与 RELEASE_NOTES.md 换行归一后完整一致。发布后使用应用原匿名同步服务实网读取 40 个正式版本，本版发布日期更新为 2026-10-06T06:05:38.000Z，同步时间 2026-10-06T06:06:48.211Z，正文一致；随后不联网重建服务，记录和同步时间从缓存完整恢复。证据为 work/v0212/published-sync.verification.json 与其隔离目录。

发布后收尾只更新 PROGRESS.md、BLOCKED.md、RELEASING.md 和本报告，产品、版本、发布说明、内置历史及验收文件保持与发布 tag 一致。

Release 首轮为 19／20 桌面通过，旧卡片光效的瞬态差值断言失败；原样本地动效复查 5／5，原因未定位。正式门禁第 2 次完整执行通过，失败日志继续保留，没有修改光效实现、阈值、超时或验收门禁；后续通过不代表首轮根因已修复。
