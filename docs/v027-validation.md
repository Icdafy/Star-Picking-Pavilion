# v0.2.7 候选验证报告：未完成，未发布

日期：2026-10-05。任务书来自本次 goal 附件；一个 agent，三轮实现已用完。
开发分支：`codex/v0.2.7-motion`。起点、本地 main 与远端 main 均为
`bcf9beb2ca13ca73214735c103185f9de103b6af`。本报告记录实际结果，失败不豁免。

## 结果与发布状态

主题快速连点、运动取消、面板焦点与信息流交互已有候选修复。原 865 项
单元/集成与原 8 项真实 Electron E2E 均通过；新增单元 4 项通过，新增
E2E 2 项通过、2 项失败。冻结性能门槛未通过，真实恢复归焦的补充诊断
也未通过。三个参考作品的实际体验未完成。不能满足本次完成条件。

版本字段保持 0.2.6，既有发布测试逐字锁定此版本，第三方声明也超出本次
写入边界。没有推送 main/tag、创建 Release 或运行候选安装器；没有
v0.2.7 精确 SHA 的 CI/Release、六项候选资产或下载校验可提供。
最终只读复核：远端 main 仍为上述 SHA，v0.2.7 tag 不存在，最新正式版仍为
[v0.2.6](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.6)。
详细阻塞与所需边界变更见 [BLOCKED.md](../BLOCKED.md)。

## 六条链的候选变化与实际证据

| 交互链 | 候选变化 | 验证结果 |
| --- | --- | --- |
| 导航/指示块 | 最新面板动画替换旧动画；离开面板清理；选中态立即同步 | 30 次连续切换后只显示 settings，同面板动画不超过 1，指示块误差不超过 2px；新增 E2E 通过 |
| 筛选/检索/分页/增量 | aria-busy 等待反馈；校验上下文与输入意图；可见新行最多八个、25ms 错峰；卡片内焦点视为阅读 | 真实筛选/检索/分页、节点身份、无重复、增量可见性、600px 阅读位置与焦点保持通过；撤回保留旧卡片并立即调和的尝试 |
| 星标/复制/Toast | 操作等待态；文本立即替换；Toast 由 motion 重播，取消强制布局 | 真实星标写入、复制与反馈通过；短运动画面采样精度有限 |
| 命令/词库/确认 | 词库共用运动引擎；Esc 归焦；确认取消不继承 OK；旧 close 不影响重开面板 | 命令/词库 Esc 与连续确认 OK→Esc 行为通过 |
| 主题 | state/DOM 同步写入主题，按钮反馈 140ms，颜色过渡 260ms | 20/21/30 的同步、终态与持久化在独立原生诊断正确；冻结 E2E 因 #FFFFFF 与 #ffffff 比较失败，整体仍红 |
| 外观与降载 | 动态减少动画、隐藏/失焦清理；static/idle 关闭 CSS 运动；保留 full/lite 背景 | 运行中 reduced-motion 前置检查有限动画从 160 降为 0；真实 hide 清理通过，恢复归焦未通过，冻结隐藏检查仍失败 |

引擎默认 light/medium/heavy 为 160/260/320ms，位移 6px，八节点错峰
总延迟 175ms；仍使用原生 JS/CSS/WAAPI。CSS 实测 292,797B（上限
299,008B），脚本 27/27、关键帧 20/20、backdrop-filter 9/10；未增加依赖。
DSH、bootstrap、偏好 schema、common-links 及全部其他只读产品路径未改。

## 实际命令与关键输出

全部从 `F:\摘星阁` 执行。原始输出保存在 Git 忽略的 `work/v027/`。

| 命令/阶段 | 实际结果 | 原始日志 |
| --- | --- | --- |
| 基线 `npm test` | 865 pass，fail/skip/todo 0 | baseline-unit.log |
| 基线 `npm run test:e2e` | 8 pass，fail/skip/todo 0；含 112 布局组合 | baseline-e2e.log |
| 基线 `npm run verify:version -- --tag v0.2.6` | Verified v0.2.6，退出 0 | baseline-version.log |
| 第一轮 `npm test` | 869 项，866 pass / 3 fail；新单元 4 项绿 | round1-unit.log |
| 第二轮 `npm test` | 869 pass，fail/skip/todo 0 | round2-unit.log |
| 第三轮 `npm test` | 869 pass，fail/skip/todo 0 | round3-unit.log |
| 文档收尾后 `npm test` | 869 pass，fail/skip/todo 0，退出 0 | final-unit.log |
| 最终 `npm run test:e2e` | 12 项，10 pass / 2 fail，退出 1；原 8 项全绿，skip/todo 0 | round3-e2e.log |
| `npm run audit:runtime` | found 0 vulnerabilities，退出 0 | final-audit.log |
| `npm run notices` | Wrote 47 dependency notices（仍为 0.2.6） | final-notices.log |
| `git diff --exit-code -- THIRD_PARTY_NOTICES.txt` | 零差异，退出 0 | 同次 notices 命令输出 |
| 文档更新后 `node --test test/release-readiness.test.js` | 8 pass，fail/skip/todo 0（0.2.6） | final-document-gates.log |

第一轮三项旧单元回退来自无 motion 时行壳类名变化、旧 pollSignals 条件
及 view-registry 调用字面契约；已恢复真实兼容行为/调用形式，未改旧测试。
最终产品代码的单元与 E2E 已完成上述完整运行；后续只编辑报告和忽略目录
的诊断/回放索引，没有继续改产品实现。

## 红→绿与保留的红

实现前 `node --test --test-concurrency=1 test/e2e/v027-motion.test.js` 的
索引完整样本红测见 `red-e2e-indexed.log`：

- 20 连点：期望 dark，实际 light。
- 同一面板同时留有 5 个入场动画。
- 实时增量五行中有三行在视口外仍动画。
- 运行中 reduced-motion 后有限动画仍为 160。

实现后同面板动画、视口内增量及阅读位置/焦点通过，新 E2E 对应两项绿。
主题奇偶与 reduced-motion 前置断言已经走通，但两项冻结测试在后部失败：
原生颜色返回 `#FFFFFF`、断言写的是 `#ffffff`；窗口 hide 后 Playwright
仍呈现 document.hidden=false。新脚本冻结前红测在前置故障处停止，未执行
这两个环境检查，属于执行方过早冻结的错误。没有更改冻结测试、颜色 API
或 document.hidden 来迎合判据。

补充诊断两次也失败：document.hasFocus 持续 true，关闭新 CDP session
的焦点模拟未解除原 session 覆盖。不加载 Playwright 的隔离 Electron
实例（`node work/v027/native-runner.cjs`）记录了 20/21/30 主题正确，以及
真实 hide 的 hidden=true / hasFocus=false / is-idle=true / 有限动画=0；
随后真实 show/focus 归焦等待 15s 超时，`native-lifecycle-result.json`
明确为 passed=false。Electron 退出码为 0 不代表诊断绿；未以补充诊断
替换门禁，也未继续重复该失败检查。

## 同机性能与渲染轨迹

冻结口径 v027-frozen-1，文件哈希见 [运动计划](v027-motion-plan.md)。相同
90 条虚构样本、30 张首屏卡片，1440×920、DPR1、full、暗主题。Windows
10.0.26200，i7-12700H/20 逻辑核心，系统内存 25,497,915,392B；浏览器
报告 deviceMemory=16；1920×1080、缩放 1、144Hz 显示器。
每轮闲置与导航各 4s，导航每 350ms 在 featured/links/hot/capital 切换。

正式基线来自修改前封存代码。命令：

```powershell
# 基线在封存原代码上运行；仍用相同取证脚本
$env:SPP_V027_ROOT = 'F:\摘星阁\work\v027\baseline-repo'
node work/v027/measure.cjs baseline
Remove-Item Env:SPP_V027_ROOT
node work/v027/measure.cjs after
```

| 三次样本/中位数 | 闲置 P95 ms | 导航 P95 ms | 导航 >50ms 长任务中位数 | 判定 |
| --- | --- | --- | --- | --- |
| 正式基线 | 7.2/7.1/7.1 →7.1 | 7.2/7.5/7.2 →7.2 | 0 | 比较起点 |
| 第二轮 | 7.1/7.1/7.1 →7.1 | 7.3/13.8/41.8 →13.8 | 1 | 退出 1 |
| 第三轮，撤回加载节奏后 | 7.1/7.1/7.1 →7.1 | 8.3/14.0/13.9 →13.9 | 1 | 退出 1 |
| 当前封存原代码对照 | 7.1/7.1/7.1 →7.1 | 13.9/13.9/13.9 →13.9 | 1 | 补充归因，非新基线 |

冻结上限：闲置 7.81ms、导航 7.92ms，另有绝对 20ms 上限，长任务不得
增加。第三轮导航及长任务不通过。当前原代码对照也变慢，说明不能单凭
本轮数据定位机器状态/代码原因；不能换基线或挑样本把候选判绿。full 测试
保留背景和运动，未关闭动效。逐帧 document.hasFocus/hidden 均记录 true
前台标志，但 Playwright 默认焦点模拟影响其可靠性，未逐帧记录原生
BrowserWindow 焦点，必须披露这一取证限制。

4×CPU 与少核心协商 lite 另存轨迹，非 full 同机门槛样本：

| 单次减速样本 | lite P95/长任务 | reduced static P95/长任务 | static 有限动画 |
| --- | --- | --- | --- |
| 正式基线 | 145.9ms / 21 | 111.2ms / 20 | 0 |
| 第三轮候选 | 395.8ms / 22 | 180.5ms / 22 | 0 |
| 当前原代码对照 | 187.5ms / 23 | 194.4ms / 24 | 0 |

候选 lite 表现仍差，不宣称低性能设备流畅；原代码在减速下也有显著卡顿。
这是调度采样，不能推出通用 GPU 结论，也不能把本机 7ms 写成跨机器 CI 阈值。

CDP trace 每段导航约 4s，各三次的中位汇总（ms 为事件总时长，嵌套事件
不可相加当作总帧耗时）：

| 事件 | 正式基线 次数/总 ms | 第三轮 次数/总 ms | 当前原代码对照 次数/总 ms |
| --- | --- | --- | --- |
| Layout | 643 / 173.092 | 607 / 199.796 | 611 / 194.568 |
| Paint | 1769 / 158.620 | 1504 / 183.741 | 1633 / 189.213 |
| UpdateLayoutTree | 654 / 468.738 | 618 / 572.496 | 622 / 530.097 |

持续布局/样式更新成本仍明显，未解决为低开销；CompositeLayers 没有该名
完整事件，不解释为没有合成开销。完整 trace 与逐帧 gaps/longTasks/pageErrors
位于 baseline/、after-round2/、after/、control-current/；正式三轮各无 pageerror。
失败测量日志为 round2-measure.log、round3-measure.log，未覆盖。

## 前后回放与布局

实际命令 `node work/v027/capture.cjs before`（封存原代码）与
`node work/v027/capture.cjs after` 各生成六链、四尺寸主题组合、52 段序列、
312 PNG。`node work/v027/compare.cjs` 仅生成配对索引，不改原始截图/元数据：

- [同真实起始主题的前后对照](../work/v027/evidence/compare.html)
- [修改前回放](../work/v027/evidence/before/replay.html)
- [候选回放](../work/v027/evidence/after/replay.html)

四组 20 连点原版均错误翻转，候选均保持原主题。主题链以后两版实际主题
不同，因此外观段按真实 pre-action theme 跨初始目录配对，不能只按文件夹
名误配。原始 frames.json 保存每帧主题、档位、焦点、滚动位置、忙碌状态。

截图实际完成时刻有漂移：目标 0ms 的首张，原版最短 117ms/中位 331ms/
最长 1459ms；候选最短 123ms/中位 390ms/最长 942ms。部分 140ms 短运动
在首帧前已经结束，回放适合比较状态、终态与布局，不能当精确逐帧运动视频
或完成审美亲验。未改冻结取证脚本凑采样。抽查窄屏暗色命令面板、反馈，
窄屏浅色确认框、外观关闭，宽屏双主题导航/检索/词库/静态外观：文本可读、
主要控件未截断；完整布局结论来自原 112 组合真实 E2E 的绿结果。

## 负控与版本边界实证

`node work/v027/negative-control.cjs` 只改隔离副本的真实产品源码，旧/新
测试逐字保持不变；不 mock 被测功能、改阈值或吞失败。

| 故障/恢复 | 实际命令（隔离 cwd） | 输出 |
| --- | --- | --- |
| 追加 transition:all | node --test test/perf-guard.test.js | 退出 1，6 pass / 1 fail |
| 恢复 CSS | 同上 | 退出 0，7 pass |
| 禁用运动环境清理，留下动画 | node --test test/v027-motion.test.js | 退出 1，2 pass / 2 fail |
| 恢复引擎 | 同上 | 退出 0，4 pass |

日志为 negative-transition-all-{rejected,restored}.log、
negative-residual-motion-{rejected,restored}.log，汇总 negative-results.json。

work/v027/release-conflict/ 中只将版本字段升到 0.2.7，运行原
`node --test test/release-readiness.test.js`：退出 1，4 pass / 4 fail。
`npm run notices` 生成 47 项，只将产品声明头从 0.2.6 改到 0.2.7。
此实证说明只读旧测试、声明不可写与目标版本冲突，详见
release-conflict-{tests,notices}.log。主工作区版本/依赖/声明没有这种变化。

## 边界与留存

六个冻结文件 SHA-256 已逐项复核，与 v027-motion-plan.md 相同。既有测试、
scripts/、工作流、服务器、主进程、配置、字体与许可证未改；所有运行
数据均为新建隔离 profile 和虚构 motion-fixture.example 样本。截图、
脚本、原始日志、轨迹、隔离样本和回放索引只留在被 Git 忽略的 work/v027/。
PROGRESS.md、BLOCKED.md、两项新增测试与本报告随本地候选提交；必需项
尚未满足，目标保持未完成。后续需要先解决写入边界与冻结验收问题，不能
直接从本候选继续推 main/tag 来绕过失败。

提交前逐项检查：22 个暂存路径均在白名单内，没有二进制/数据库/日志或
用户数据文件，新增行的常见凭证模式为 0；115 个既有 test 文件与起点
Git 内容一致，git diff --cached --check 通过。包边界的既有验证器仍保持
只读，本次未因候选受阻而跳过它去发布。
