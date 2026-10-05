# v0.2.10 设计与验证记录

## 设计依据

2026-10-05 查阅官方资料，并结合现有原生 JS、WAAPI、玻璃界面和阅读场景做了以下取舍。

- [Apple · Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/)：交互及时响应，运动可以随用户意图中断和改向。应用于连续导航和筛选；不等待转场结束才响应下一次输入。
- [Motion · Animation performance](https://motion.dev/docs/performance/)：优先使用 transform 与 opacity，减少布局、绘制和常驻图层。应用于 FLIP 选择块与光波；尺寸一次更新，用平移和缩放呈现过渡。
- [Motion · springValue](https://motion.dev/docs/spring-value)：弹簧目标随输入变化，运动结合速度持续响应。应用于局部指针追光，使用有界物理步长并在静止后停止 RAF。
- [Linear · A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)：保持阅读层级与界面秩序。这里选择只移动装饰层，不让文章正文随鼠标倾斜，不接管原生滚轮。

上述为本项目的设计选择；没有引入这些产品的源码或第三方运行时，也不以资料中的帧率目标作为本机性能实测。

## 实现与边界

版本徽标读取桌面预加载桥的应用版本，网页模式回退到受现有安全边界保护的 GET /api/version。两处均来自 package.json；界面没有硬编码 v0.2.10。

DomUtils.createMotion.retargetIndicator 在中断前读取当前视觉矩形，提交目标几何，通过预采样 WAAPI transform 完成 FLIP。原有 --ti-x/y/w/h/o 契约保留。相同目标不重播，首次空尺寸和减少动画直接呈现终态。

DomUtils.createInteractionMotion 使用委托监听与小型选择控件的局部观察器，覆盖领域、分类、热点、一级市场分区和日报周期。按钮最多同时保留 4 个光波；每个按钮只保留最新一波。追光最多一个，逐帧只更新该装饰层 transform，指针位置使用缓存矩形，静止后停止帧循环。

static 跳过运动；lite 保留短选择过渡和操作反馈，关闭追光；full 启用全部增强。运行中减少动画、隐藏、失焦、滚动、退出和 dispose 会清理对应装饰、动画、帧回调与监听。没有新增脚本标签、依赖或 CSS @keyframes。

已有偏好、信源目录、数据库、星标、模型配置、研究归档与内置字体沿用。安装器继续未签名。

## 验证进度

初步动效单元与既有运动／DOM／性能护栏 30／30 通过，新增真实 Electron 专项 3／3 通过。首轮完整单元为 880 项、879 通过、1 失败，原因是日报导出测试仍固定期待 v0.2.9；改为核对当前 package.json 版本，保留导出内容和文件名的其余断言。

2026-10-06 完整复验为 **880／880 单元、17／17 真实桌面通过**，fail、cancelled、skip、todo 均为 0。桌面总耗时 118.92 秒，包含既有 112 种窗口／缩放／视图布局、标题栏滚动条、持久化、导出和安全检查。新增专项覆盖版本 API、运动中改向视觉连续性（偏移小于 2px）、30 次导航中断、领域选择块、窄窗重测、键盘切换、光波上限和清理、双主题追光、运行中减少动画、原生隐藏／恢复、lite 与 dispose。

双主题截图已人工查看，保存在 work/v0210/e2e/v0210-{light,dark}.png；版本徽标与正文均可读。生产依赖审计 **0 漏洞**，第三方声明 47 项，仅产品版本更新。CSS、脚本、关键帧及滤镜原有护栏全部通过。

首轮本地候选构建及 1,271 项包边界通过，ASAR 为 13,402,432 B，安装包为 99,545,024 B；PE 产品／文件版本为 0.2.10，签名 NotSigned，SHA-256 为 `02e6cbfdcd9d271f3a515fd6d95d2dd464fd58e6d516287735669efa95e3b927`。版本、安装包、更新元数据与目标 tag 一致。本机没有运行安装器；安装／卸载仅在一次性 CI 中执行。

首轮 [main CI 37337946939](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37337946939) 在提交 `81419e05e1831e3c319c701de938e40ef766a150` 上为 880／880 单元通过、16／17 桌面通过。点击光波用例等待 600ms 后仍有 4 个装饰节点，后续构建／发布步骤未执行。日志没有记录当时浏览器运动时钟和完成 Promise 状态，不能据此断言图形驱动或调度根因；原始输出保存在 work/v0210/main-ci-first.{json,log}。

原实现仅通过 Animation.finished 释放光波。补充 500ms 资源寿命上限，正常完成提前释放，替换／减少动画／失焦／销毁撤销计时器；测试模拟浏览器实际播放但完成 Promise 持续 pending，仍必须在原来的 600ms 等待之后完全清理。没有延长等待、删除断言或放宽发布门禁。

光波修正后再次完整本地复验为 **880／880 单元、17／17 桌面通过**，桌面耗时 119.71 秒；新增桌面专项按最终测试代码另跑 **3／3 通过**，含完成 Promise 不返回的故障注入，所有计数 fail／cancelled／skip／todo 为 0。重建后 1271 包边界和版本验证通过，ASAR 13,402,781 B，候选安装包 99,544,909 B，PE 0.2.10、NotSigned，SHA-256 为 `b6d2fdee24233e0dc95f4f5156d4d34592e0c93c9d1b68f9ee99399c5e17261c`。原始记录为 work/v0210/{unit,e2e,motion-e2e,build,package}-after-cleanup.log 与 candidate-pe-after-cleanup.json。

[修正提交 CI 37340116821](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37340116821) 的三次执行均使用 `847b8c8909f5caa69df907b4f2da8daf2085c912`。attempt 1 为 876／880 单元通过，4 个既有后台启动用例报 server ready timeout；原样本地相关测试 17／17 通过。attempt 2 为 880 单元通过、16／17 桌面，既有安全／持久化用例的后台在 20 秒握手超时后约 4 秒才返回就绪，主窗口已关闭；新增动效 3／3 均通过，原样本地该旧桌面链路 1／1 通过。没有调整旧启动程序、超时或测试标准；本地通过不等于已定位 CI 启动延迟根因。

attempt 3 为 880 单元通过、15／17 桌面，领域指示块在原定 450ms 后未达到目标几何，追光用例未观察到装饰节点。日志没有记录运动时钟或当时指针命中对象，不据此断言图形驱动根因。通用运动引擎补充“时长＋延迟＋50ms”终态时限，取消或改向撤销旧计时器；新单元故障注入验证过期回调不能取消最新意图，桌面测试主动暂停指示块运动时钟，仍按原来的几何标准检查归位。追光测试先通过定位器等待卡片稳定命中，再移动指针，并补充失败时的焦点、命中对象和档位诊断；原有视觉反馈断言与超时保持。原始失败为 work/v0210/main-ci-{second,third,fourth}.{json,log}，原样诊断为 startup-diagnostic.log 与 desktop-startup-diagnostic.log。

终态修正后本地完整验证为 **881／881 单元、17／17 桌面通过**，fail／cancelled／skip／todo 为 0，桌面耗时 122.95 秒。重建与 1271 包边界、版本验证通过：ASAR 13,403,366 B，候选安装包 99,545,261 B，PE 0.2.10、NotSigned，SHA-256 为 `1f98eb8e5eb7adf5b556ea38b5f000f157fe70dfeb9596476b855d536d70fc8d`。记录为 work/v0210/{unit,e2e,build,package,version}-after-terminal.log 与 candidate-pe-after-terminal.json。

精确提交 main CI、Release 工作流及六项正式附件下载核验已完成，正式结果见下文。本地候选摘要不作为正式 CI 产物摘要。

原始证据保存在被忽略的 work/v0210/；测试使用隔离样本与配置，不读取用户数据库，不调用付费模型。新增桌面用例在真实 Electron/Chromium 前台验证，CI 显式选择 full 档以覆盖追光；系统减少动画、lite 与原生隐藏另行验证。

## 正式发布与下载核验

北京时间 2026-10-06 01:22:39 发布 [摘星阁 v0.2.10](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.10)，Release ID 403957876，非 draft、非 prerelease，已通过 /releases/latest 确认为最新正式版。产品提交与远端注释 tag 解引用均为 `c02173065a8263f1aeac070008795b652901bee4`。

此前各次 CI 失败、原样诊断及两次动效修正详见上文；启动延迟根因未宣称定位。最终产品提交的第 1 次完整 main CI 成功。Release 首轮为 880／881 单元通过，既有日报归档接口用例报 server ready timeout，桌面、构建及上传未执行；原样本地该文件 5／5 通过，记录为 release-daily-startup-diagnostic.log。未改变产品、tag、旧程序、超时或判据，同一 tag 的第 2 次完整 Release 工作流成功。首轮原始失败为 work/v0210/release-ci-first.{json,log}。

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37344672306) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37345837754) 均完整通过：881／881 单元、17／17 真实桌面（112 布局组合）、0 生产漏洞、47 项声明和 1271 包边界，fail／cancelled／skip／todo 为 0。一次性 Windows 安装、启动、单实例、退出与卸载检查成功，用户数据保留。

六项正式附件重新下载核验，尺寸与 GitHub SHA-256 摘要全部匹配。正式安装器 99,543,243 B，PE 产品／文件版本 0.2.10，签名 NotSigned；SHA-256 为 `a678eadbe6cb2d9c5006ba403c2419dc115adbfbf52e59a829cf2a4fee0fe946`。latest.yml 的版本、文件名、尺寸及两处 SHA-512 均与实际安装器匹配，SBOM 为 CycloneDX 1.6、产品 0.2.10，第三方声明与提交一致。

| 附件 | 字节数 |
| --- | ---: |
| latest.yml | 373 |
| sbom.cdx.json | 81,352 |
| SHA256SUMS.txt | 106 |
| Star-Picking-Pavilion-Setup-0.2.10.exe | 99,543,243 |
| Star-Picking-Pavilion-Setup-0.2.10.exe.blockmap | 105,861 |
| THIRD_PARTY_NOTICES.txt | 6,347 |

正式 CI 包大小：app.asar: 13412162 bytes (12.79 MiB)；installer: 99543243 bytes (94.93 MiB)。本地候选和正式 CI 的摘要分别记录。本机没有运行安装器。

原始发布证据为 work/v0210/main-ci.{json,log,verified.json}、release-ci.{json,log,verified.json}、remote-tag.txt，以及 work/v0210/published-37345837754-attempt2 内的 Release／latest 元数据、verification.json 与 pe-metadata.json。发布后文档提交只补录结果，正式产品 tag 与附件保持一致。
