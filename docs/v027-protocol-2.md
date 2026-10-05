# v0.2.7 续跑取证口径

2026-10-05，用户在需要调整的报告后明确“继续”。本口径纠正自动化环境，不改变产品、行为判据、性能阈值、原测试数量或工作流。原 frozen-1 文件和失败样本保留在 work/v027/frozen-1/ 及原目录。

## 更正与实跑

- Electron 返回的 `#FFFFFF` 与 `#ffffff` 相同，原生颜色比较只规范化大小写。
- 已安装 Playwright 的公开 `chromium.connectOverCDP({ noDefaults:true })` 不开启焦点模拟。实际 Electron 不通过 Playwright loader 启动，不加入禁用后台节流的自动化开关。包装器只载入原 electron/main.js，测试 HTTP/数据库/IPC 和渲染代码均为真实实现。
- 新建隔离 profile，测试窗口固定前台。恢复时先 show/focus，再将测试窗口置顶，避免被其他窗口遮挡。页面必须真实 hidden/hasFocus 与原生 visible/focused 同时成立；不改写属性、不伪造事件。
- 新 E2E 在封存 bcf9beb 上实跑 4 项全失败：20 连点终态反转、单面板 5 个入场、3 个离屏新行有运动、运行中减少动画后残留 1088 个有限动画。日志 work/v027/v2-red-e2e.log。候选的前三项已通过；隐藏/恢复及外观持久化独立实跑通过，完整回归还须再次验证。

## 性能

命令：封存原代码 `SPP_V027_ROOT=work/v027/baseline-repo` 时跑 `node work/v027/measure-v2.cjs baseline-v2`；候选跑 `node work/v027/measure-v2.cjs after-v2`。同一 90 条样本、30 张首屏、1440×920、DPR1、144Hz、full 档。各三次闲置/导航 4000ms，导航每350ms轮转四视图，保留全部样本和轨迹。页面逐帧确认真实前台，主进程每50ms核验原生窗口前台状态。

阈值仍为 P95≤20ms 且≤同机基线110%；超过50ms长任务中位数不得增加。保留4倍CPU减速的lite/static轨迹，静态档必须无有限动画。

纠正环境后的封存原代码：闲置三次7.2/7.2/7.1ms，中位7.2ms；导航13.8/13.9/13.9ms，中位13.9ms；导航长任务0/0/1，中位0。新上限分别7.92/15.29ms，长任务0。这个基线变化来自取消焦点模拟及验证实际前台，不是候选调参；旧7.2ms导航与所有失败样本仍在报告中。

在继续修改产品前保存 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| test/e2e/v027-motion.test.js | 98f1f44ce5d8f7e2a405f74e48d385d953a7a0bfd70a168386a793185708428e |
| work/v027/measure-v2.cjs | b66e0543db58174dde8a4b3488fb45600d83561dc83bc7d93ecfe3aa85703094 |
| work/v027/native-harness.cjs | c35394734253765edfb8b842f3a4e8ead5f5da2ea0dfb2e04296d94a512b0b9e |

原单元行为、样本与负控判据均未变；后续只允许回放展示调整，数值或行为门槛若失败仍须如实保留。

## 连续帧回放

补录 `node work/v027/capture-v2.cjs before-v2` / `after-v2`，同样封存原版与候选，90条样本，深浅主题与800×600/1440×920各四组。通过CDP Page.startScreencast记录实际呈现帧并立即确认，原始时间戳与接收时刻均保留。滑块可逐帧查看；不会把截图工具耗时当成指定0/80ms。每步前后DOM状态另存，不假称每帧有DOM快照；实际前台必须成立。脚本SHA256 `9ca62985a73765cacfb703b528f7a1c7727e0fe0919e099d3b4bb7c16d00464c`。
