# v0.2.14 验证与发布记录

目标仓库为 Icdafy/Star-Picking-Pavilion，公开版本、Windows 产品版本与构建版本统一为 0.2.14。本次范围为热点与情报日志页头、报告概况及一级市场分区筛选布局。

## 设计与实现

参考 [IBM Carbon 的标签规范](https://carbondesignsystem.com/components/tabs/usage/)中简短明确的标签、对齐、选中状态与手动键盘激活，以及 [Ant Design 的统计展示](https://ant.design/components/statistic/)中统计数字与描述的层次。复用已有 Aqua 材质和共享页头，没有引入第三方品牌图形、外部图片或新运行依赖。

- 热点与情报日志新增 `.page-banner`，同精选、全部动态、星标、一级市场等页面共用栏目、标题、说明、右侧状态与轨道装饰。热点动态说明和领域筛选、情报日志出刊节奏保留。
- 情报日志将页头、紧凑工具栏与报告概况明确分层。概况宽屏左右对齐，窄屏上下分行，减少垂直留白和日期字号；生成时间不再重复三项统计与状态。日报、周报、月报的统计、操作范围、加载／失败、重试、日期边界和请求竞态守卫保留。
- 一级市场六个分区同一行等宽排列，当前用途说明与四类筛选独立展示。领域、时间范围、标的范围、搜索均有可见标签；公司热度与公司库隐藏不适用的时间选择，用明确文字解释统计范围。公司热度的实际周期仍由服务端响应展示，没有写死为时间筛选值。
- 选项卡绑定面板与焦点顺序，方向键和 Home／End 仅移动焦点，Enter／Space 原生激活。切换保留筛选，沿用真实 API 与竞态处理。
- 清理旧 `.intel-hero`、`.intel-kicker`、紧凑页头和重复输入规则，复用既有 CSS／脚本边界；预算门槛不变。

## 本地实现验证

完整单元与集成回归 892／892（15.83 秒），fail／cancelled／skip／todo 均为 0。版本、内置更新日志及发布说明一致，内置 42 条记录，第三方声明 47 项，生产依赖审计 0 漏洞。原始输出位于 work/v0214/unit-final.log、runtime-audit.log。

专项真实 Electron 验证通过（43.81 秒）：十个视图页头、1440／800 宽与深浅主题、报告 6／3／3 精确统计及周期切换、日期边界、重新生成、手动键盘激活与全部筛选到达真实 API。六个一级市场分区同一行、等宽且文字完整；导航与筛选分层。报告概况实际高度为宽窗口 111.125 px、窄窗口 174.09375 px，双主题一致。43 张截图逐类复核，包括周报、月报与日报；无重叠或横向溢出。73 个真实动画帧中 58 个不同位置，减少动画与强制颜色检查通过。证据为 ui-fourth.log、overview-geometry.json、screenshots、banner-motion.json。

保留早期失败：前两轮概况高度分别为宽 119.25 px、窄 181.71875 px，超过新专项的 115／180 px 目标；实际收紧产品留白后达到目标，未放宽断言。第三轮因零融资数据返回有效空态，测试误等候非空概览而超时；改为核验完整筛选的真实请求、200 响应及 30 天范围，没有修改服务端、拦截 API 或制造融资数据。首轮完整单元 887／892，三项旧版本断言、旧 flex 布局断言及缺少新面板属性的测试替身失败；同步版本与新布局契约，补齐属性验证后完整通过。原始失败日志 ui-first.log、ui-second.log、ui-third.log、unit-first.log 保留。

CSS 按 Windows CRLF 最坏口径共 298,847 B，低于原 292 KiB／299,008 B 上限；脚本 27、关键帧 20，原静态预算未改变。

## 信源实网复查

严格复查 186 项中 184 返回内容，东财检索·穿越者返回空，泰伯网·空天资讯请求失败（fetch failed），因此严格检查退出 1。本版未修改信源目录或采集逻辑，未删源或调整检查掩盖结果。原始证据为 work/v0214/source-audit.{log,json}。

## 构建与发布状态

完整真实 Electron 回归 21／21（201.43 秒），fail／cancelled／skip／todo 均为 0，包含 160 个布局组合与新增真实交互验证。原始输出为 work/v0214/e2e-final.log。

本地候选构建成功，1273 项包边界检查通过；app.asar 为 13,598,436 B，安装包为 99,583,565 B。十二项生产文件与包内逐字节一致，包内版本、PE 文件／产品版本和更新元数据均为 0.2.14，签名 NotSigned。安装器 SHA-256 为 `84b41cb7502d4679ff747d49d72563f81d9fee67ba4576fb8ffb7570a3e6fbf1`，latest.yml 的路径、尺寸及两处 SHA-512 匹配实际安装器。证据为 work/v0214/build.log、package-audit.log、candidate-asar.json、candidate-metadata.json。

正式产物由既有 tag 工作流独立构建，安装／启动／单实例／退出／卸载只在一次性 Windows CI 执行。本地验证及远端门禁、正式下载核验均已完成，结果见下节。

## 正式发布与下载核验

[v0.2.14](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.14) 已于北京时间 2026/10/06 16:11:03 发布为最新正式版，draft=false、prerelease=false。注释 tag 对象为 `0bdde1cb8e62b1cb0417c482f60ee24dfc23d92d`，解引用为产品提交 `5979a49e6f57f7e1e42fd135c394b655fff0a8b9`，发布时远端 main 同时指向该提交。

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37432245718) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37433420128) 对该精确提交均首次完整通过：892／892 单元、21／21 真实 Electron（160 布局组合），fail／cancelled／skip／todo 全为 0，生产依赖审计 0 漏洞、47 项声明零差异、1273 包边界，以及一次性 Windows 安装／启动／单实例／退出／卸载成功，用户数据保留。

六项正式附件重新下载至新的隔离目录 `F:\摘星阁\work\v0214\published-20261006081142098`。逐项尺寸及 GitHub SHA-256 摘要匹配，安装器同时匹配 SHA256SUMS.txt；正式安装器 99,581,850 B，PE 文件／产品版本 0.2.14，NotSigned。latest.yml 的版本、路径、尺寸与两处 SHA-512 匹配实际安装器，SBOM 为 CycloneDX 1.6／产品 0.2.14，第三方声明统一行尾后与发布 tag 正文一致。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `6830e647e6d8c48711bab4fba8a929b0f539f838c6460a58f2d41bef022623a8` |
| sbom.cdx.json | 81352 | `85c13f9acef7b40bf2f15ce38988d89c7ffe8c471bdaea444f14513183e400dc` |
| SHA256SUMS.txt | 106 | `c1680bece216cf5ebbefa671158d7b013c75dc4497fe59dff78a2f592a77719d` |
| Star-Picking-Pavilion-Setup-0.2.14.exe | 99581850 | `533317d2db44c3a2213303e43350221bb05a0cbadbd032c998627301d7a9cd46` |
| Star-Picking-Pavilion-Setup-0.2.14.exe.blockmap | 105901 | `75473e046483e864f1c0fc652a34f397e6a5f90f14c70f59d2c95e4908a6b582` |
| THIRD_PARTY_NOTICES.txt | 6347 | `c2fbe054c94279e924b156632c79dc19657d7cd534479e2c2de5c8ad5002a345` |

公开 Release 正文、本版内置记录与 RELEASE_NOTES.md 一致。按原应用服务、默认超时和匿名实网请求同步 42 条正式记录，本版发布时间更新为 2026-10-06T08:11:03.000Z；缓存保存与离线重建恢复的记录及 lastSyncedAt 一致。本轮发布、下载与应用同步验证无失败。

证据为 work/v0214/{main,release}-ci.{json,log,verified.json}、publication-refs.json、published.verification.json、隔离目录的 release.json、latest-release.json、verification.json、pe-metadata.json 及 published-sync.verification.json。收尾提交仅更新文档和状态，生产文件、测试、版本、发布说明与内置历史保持 tag 内容。
