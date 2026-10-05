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

本地候选构建及 1,271 项包边界通过，ASAR 为 13,402,432 B，安装包为 99,545,024 B；PE 产品／文件版本为 0.2.10，签名 NotSigned，SHA-256 为 `02e6cbfdcd9d271f3a515fd6d95d2dd464fd58e6d516287735669efa95e3b927`。版本、安装包、更新元数据与目标 tag 一致。本机没有运行安装器；安装／卸载仅在一次性 CI 中执行。

精确提交 main CI、Release 工作流及六项正式附件下载核验尚在执行，完成后补录正式产物结果。本地候选摘要不作为正式 CI 产物摘要。

原始证据保存在被忽略的 work/v0210/；测试使用隔离样本与配置，不读取用户数据库，不调用付费模型。新增桌面用例在真实 Electron/Chromium 前台验证，CI 显式选择 full 档以覆盖追光；系统减少动画、lite 与原生隐藏另行验证。
