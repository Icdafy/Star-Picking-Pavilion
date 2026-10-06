# v0.2.16 实现与发布验证

验证日期：2026-10-06。目标仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.16。

## 实现与设计依据

报告概况保持既有最小高度和内外留白，日期移到统计左侧空间的中心，上一期和下一期按钮在日期两侧。三种刊期、四档字号和双主题继续适用。

更新按钮放在“本地情报工作区”右侧，窄窗口在品牌下方保留工作区入口。检查、当前已最新、发现版本、下载、下载完成、安装及失败状态共用稳定节点；百分比与 SVG 定量环对应真实更新状态，未知进度转为短弧旋转。下载完成仍需明确点击安装，沿用优雅关闭后端和静默 NSIS 更新。

参考 [Material 环形进度](https://github.com/material-components/material-components-android/blob/master/docs/components/ProgressIndicator.md)区分确定与未知进度；参考 [Radix Icon Button](https://www.radix-ui.com/themes/docs/components/icon-button)的名称、加载与禁用状态。实现使用本项目原生 SVG/CSS 和现有 spin，未复制外部源码或引入组件依赖。

环形过渡与按钮按压、悬停遵守减少动画、低功耗、静态档位及后台暂停；提供键盘焦点、可见百分比、进度语义与 10% 分段播报。主进程限制检查请求 sender，阻止下载／安装期间检查、并发检查和 30 秒内重复请求。

## 本地验证

- 单元与真实接口：908／908 通过，20.05 秒，fail／cancelled／skip／todo 均为 0。新增检查协调器覆盖并发、下载／安装边界、30 秒节流和网络失败后的重试；按钮覆盖百分比边界、未知进度、重复点击、新状态优先及错误恢复。
- 真实 Electron：23／23 完整通过，264.83 秒，fail／cancelled／skip／todo 均为 0。原 160 组布局与报告复制、导出、重新生成保持；三刊期／双主题／四缩放／两窗口 48 组高度偏差不超过 1px，水平中心最大偏差 0px、垂直最大偏差 0.0078125px，左右按钮与日期同轴，无横向溢出。
- 更新专项覆盖四窗口／四缩放／双主题 32 组。按钮均在工作区文字右侧，文字保持一行；通过实际桌面桥推送检查、最新、发现、0／55／100% 下载、完成和错误状态。Enter 安装请求只发送一次，原按钮和环形节点保留；低功耗、静态、减少动画、后台暂停、高对比度与进度语义通过。更新状态在测试中通过真实 IPC 注入，不将其当作真实 GitHub 下载证明。
- 生产依赖审计：0 漏洞；47 项第三方声明与 44 条内置更新日志同步。样式 CRLF 口径合计 295,683 B，原预算 299,008 B；脚本 27、关键帧 20。压缩既有样式注释的历史说明，不修改相关声明和性能阈值。
- 最终本地候选包：1,274 项 ASAR 边界通过，app.asar 13,621,710 B；安装器 99,590,127 B，PE 产品／文件版本均为 0.2.16，NotSigned，SHA-256 为 `f6a06200a68c295b3ee5b23909ff7136b95ecc0c98cdbff58bd091e3d46b260e`。版本与更新元数据通过，本机没有运行安装器。初版候选的构建与摘要另存，未当作最终附件。
- 实网信源严格复查：183／186 返回内容，0 空结果；国家航天局·官网、爱范儿、泰伯网·空天资讯均为 fetch failed，退出 1。原因未定位，本版未修改信源或采集逻辑；如实保留失败，未将严格复查记为通过。

首次更新专项遇到窄屏主题按钮点击后的自动滚动，导致位于品牌下方的入口滚出视口。专项固定在顶部测量其初始布局后通过，产品不强制改变用户阅读位置。最初新页脚继承窄屏宽度公式导致宽屏标签换行，已为侧栏设置 100% 宽度与单行标签。首轮单元测试有四项仍使用上版安装包／导出版本和发布说明断言，按新公开号及本版功能更新后完整通过。原始失败日志均保留。

## 发布状态

main [首轮 CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37448908877) 在提交 `54623062582d5a3e163bc2e5e2d676127b97b48c` 上为 908／908 单元、22／23 桌面。新增更新专项在旋转断言中收到 none 而非 spin；日期 48 组、入口布局 32 组和其余 22 项桌面通过。新测试直接写 data-fx-tier=full，与应用 MediaQueryList 异步重算存在竞态；低资源设备会按原策略回到 lite。修正功能测试的设备能力夹具为 8 核／8 GiB，通过应用自身 syncFxTier 推导 full，再用 4 核及 4 GiB 两种条件验证 lite，真实减少动画媒体条件验证 static。保留 spin／none、进度、布局等原断言，不修改产品、工作流、超时或门禁。

能力夹具补验首次在等待减少动画媒体事件时超时；静态样式停掉全部动画后，CDP 接受设置不代表 Electron 已送出媒体事件。沿用旧动效测试的布局读取方式推进原生渲染生命周期，再等待实际 MediaQueryList 与 static 状态，不伪发事件。修正后的更新专项 1／1 通过，8.17 秒；原失败与通过日志为 update-capabilities.log、update-capabilities-settled.log。首轮 CI 日志及结果另存 main-ci-attempt1.log／json。

main [第二轮 CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37450311957) 在提交 `af90712e0d4292939a7c7c648a9bb530e4ba2b78` 上为 908／908 单元、22／23 桌面；新更新专项和日期专项均通过。原有 electron.test.js 在关闭首个应用后，第二个应用的 firstWindow 收到 Target page, context or browser has been closed，原因未定位。该原测试单独在本地补验 1／1 通过，11.11 秒；未更改其断言、超时或启动代码，也未加入内部重试。证据保存在 main-ci-attempt2.log／json、restart-isolated.log。

最终动效复核发现：环形 SVG 的初始 -90° 变换与复用 spin 的 360° 终点组合成 450° 旋转，循环边界会跳变。新增真实动画矩阵断言，在原实现上复现边界差值 0.999979；将 -90° 只作用于进度弧，外层按 0→360° 连续旋转，保持进度从顶部起步。修正后差值小于 0.01，更新专项 1／1 通过，8.46 秒，性能预算通过；不新增关键帧，不放宽断言或发布门禁。原失败与修正日志为 update-loop-before.log、update-loop-final.log、perf-final.log。最终候选重新构建并检查包边界、PE 版本和更新元数据。完整 CI 待重跑确认。

本地验证完成，tag Release 与公开附件核验待执行。使用既有工作流与一次性 Windows 安装／启动／单实例／退出／卸载烟测，门禁及范围不变。

原始证据保存在 work/v0216：unit.log、unit-final.log、journal-first.log、electron-final.log、update-first.log、update-diagnostic.log、update-final.log、runtime-audit.log、sources-audit.log、sources-summary.json、build.log、package-audit.log、candidate-installer.json、build-loop-final.log、package-loop-final.log、candidate-loop-final.json、native-exports 与 update-button 截图／几何记录。
