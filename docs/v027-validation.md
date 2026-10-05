# v0.2.7 候选验证报告：未完成，未发布

## 当前续跑结果（2026-10-05）

候选精确提交 `5e04d436c940a45fadbec0346ac15a0759d4e320` 的开发分支 [Windows CI 37292639190](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37292639190)全部成功，耗时10m12s。原始 `v027-final-ci.log` / `v027-final-ci-result.json` 直接记录 `# tests 869 / # pass 869 / # fail 0 / # skipped 0 / # todo 0` 和 `# tests 12 / # pass 12 / # fail 0 / # skipped 0 / # todo 0`，包含原112布局组合。生产审计 `found 0 vulnerabilities`，47项声明再生成Git零差异；构建、1270条包边界通过。CI ASAR13,399,011B、安装器99,541,227B，与本地构建分别保留，不混用哈希。一次性Windows的原始烟测输出为：`Installed, launched, checked single-instance, closed and uninstalled v0.2.7; user data retained.` 本机没有执行安装器或伪设CI=true。

红→绿链：首次候选CI d735815的10/12失败已保留；确认观测改为等待Promise解析后仍严格false，阅读通知流内59px导致600→659，修复后CPU4诊断600→600、焦点保留，当前完整本地与CI12/12通过。一次本地恢复后即时动画断言失败原因未定位，诊断和后续全量本地/CI均通过；风险记录仍在，不声称根因已解决或吞掉失败。

当前仅完成开发分支技术候选。参考作品实际体验0/3；main仍bcf9beb、v0.2.7 tag不存在、最新正式版v0.2.6（draft=false/prerelease=false），见 `v027-final-remote-state.log` / `v027-final-latest-release.json`。main精确SHA CI、注释tag、release与六资产/下载SHA256仍未执行，目标未完成，不把开发分支CI当作正式发布门禁。

当前产品最新冻结性能口径三次全部通过：导航8.2/7.2/7.4ms，中位7.4ms（旧版13.9、110%上限15.29、绝对上限20）；超过50ms长任务0/0/0、中位0未增加。闲置7.1/7.2/7.1、中位7.1≤7.92。full档/1440×920/DPR1/144Hz/90条样本/30张首屏一致，原生每50ms和页面每帧前台校验全成立。日志 `v027-final-measure-foreground.log`、原始 `after-v2/`、摘要 `v027-final-perf-summary.json`。首次最新重测因原生失焦退出1，整次无效，不计入三次中位；失败日志 `v027-final-measure.log`、目录 `after-v2-invalid-focus-1/`完整保留。先前有效8.7ms样本封存在 `after-v2-pre-reading-fix/`，没有覆盖或改变冻结脚本及阈值。

最新full渲染轨迹4s的三次中位总成本：Layout199.131→170.986ms、Paint130.187→132.524ms、UpdateLayoutTree516.719→412.501ms；绘制成本小幅增加，不能宣称所有成本下降。CPU4附加单次诊断lite P95 229→138.7ms/长任务28→23，static P95 104.1→41.6ms/长任务19→6、有限动画0。附加诊断不套用full的20ms门槛，也不据单次诊断推广所有慢CPU设备流畅。先前219.444ms/Layout与270.9ms/lite样本仍在after-v2-pre-reading-fix/；下文旧值属于此前候选。

当前本地安装包已重建通过 `dist` / `verify:package` / `verify:version -- --tag v0.2.7 --artifacts`：1270项ASAR、13,389,299B；安装器99,542,963B、PE文件/产品0.2.7、NotSigned、SHA256=`8bb0a04be11f250d27dcee7c2c6b2f0050efe84f721aead357b39d3ba73ebfeb`。实际隔离Electron界面桥0.2.7，实际安装器SHA512与latest.yml/尺寸/文件名匹配；8项发布文档测试通过。日志与JSON `v027-final-{dist,package,artifact-version,installer,ui-and-update-version,document-gates}`。本机没有运行安装器，独立CI安装烟测已通过；本地SHA256不是尚未发布的正式资产校验和。

最新完整本地回归：`npm test` 869/869、`npm run test:e2e` 12/12，fail/skip/todo均0；日志 `v027-final-unit-visible.log` / `v027-final-e2e-observed.log`，包含原112布局组合。审计0、47项声明重复生成Git差异0，见 `v027-final-{audit,notices}.log`。先前本地完整运行11/12时恢复后的即时动画断言一次失败（v027-final-e2e.log），两次原速及一次CPU4真实状态诊断均full/前台/260ms运行中，原因未定位。只增加失败诊断信息，保持原Animation且running判据及超时，没有增加重试或将失败静默豁免；后续独立CI已通过，最终main/release仍须按既有门禁验证。

通知布局修复后的实际四组合取证：800×600/1440×920、深浅主题，600→600、相同焦点，通知实际点击命中，位于粘顶工具栏下约8px、无横向溢出。截图检查发现第一次浮层定位部分遮挡，因此复用现有 `--stack-top` 安全偏移、使用有效的两层背景；原遮挡截图与新截图分别保留在 `evidence/reading-banner/` / `reading-banner-visible/`。后者 observations.json、`v027-reading-banner-visible.log` 含全部坐标和背景值。当前包已重建，前候选安装器哈希不用于新代码。

### 先前续跑阶段记录（当时状态；以上为最新结果）

开发分支此前已推d735815；首次CI [37287385385](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37287385385) 的869单元通过、桌面10/12，未运行打包/安装烟测。新确认取消需要等待close事件中的Promise结果；新通知流内高度使阅读scrollY移59px，真实4倍CPU/4核心复现。修成无高度占用sticky通知后同诊断delta0、焦点保留、通知可见，2/2绿；确认结果等待修正不改变严格false判据。完整复跑已通过，旧包哈希对应此前候选，不冒充CI通过。失败与红→绿日志见v027-ci-{failed,e2e-diagnostic,e2e-diagnostic-green}.log。

用户明确“继续”后，按上一轮列出的必要范围更新目标版本测试/声明、纠正验收环境并继续验证。以下历史章节保留原三轮的失败，不代表当前状态；新环境口径与冻结哈希见 [协议2](v027-protocol-2.md)。

- `npm run test:e2e`：12 pass / 0 fail / 0 skip / 0 todo，原8项、新4项以及原112布局组合全部通过。实际Electron无焦点模拟，确认20/21/30主题奇偶、原生/持久化一致、30导航、Esc归焦、增量/阅读位置、动态减少动画、真实隐藏/恢复和外观关闭持久化。日志 `work/v027/v027-e2e.log`。
- 原代码在新口径仍4项全红，日志 `v2-red-e2e.log`。候选第一次新口径长任务1/0/1（中位1）失败，原样保存 `after-v2-pre-layout-fix/`；调整滚动复位在控制器写入前执行后，相同冻结协议三次全绿。
- 新口径旧版导航13.8/13.9/13.9ms，中位13.9；候选8.7/7.6/13.9ms，中位8.7≤15.29且≤20ms。旧版导航长任务0/0/1，中位0；候选0/0/0，中位0。闲置中位旧版7.2、候选7.1ms。真实前台、样本、窗口/DPR/144Hz和full档一致；新轨迹含4倍CPU的lite/static，static有限动画0。
- package/Windows/build/lock版本与生成声明现为0.2.7；旧测试只同步版本目标，数量和行为判据不减少。`npm run audit:runtime` 为0漏洞；47项声明生成并保存后再生成，`git diff --exit-code -- THIRD_PARTY_NOTICES.txt` 退出0；`verify:version -- --tag v0.2.7` 通过。日志 `v027-{audit,notices-repeat,version}.log`。
- 版本升级首次单元回归868 pass / 1 fail：Markdown导出页脚仍被旧断言锁定0.2.6。只把目标版本及样本版本同步到0.2.7，保留原失败日志 `v027-unit.log`，全量复跑结果回填进度。
- 最终 `npm test` 为869 pass / 0 fail / 0 skip / 0 todo，原865加新4全绿，日志 `v027-unit-green.log`。目标版本断言升级后未修改服务器或导出功能。
- `npm run dist`、`npm run verify:package`、`npm run verify:version -- --tag v0.2.7 --artifacts`均退出0。1270个ASAR条目、13,389,031B；本地安装器99,542,996B，PE文件/产品版本0.2.7，签名NotSigned，SHA256为 `0e0463eb865484f6c94782ee2c86827aa29b634a2e8d4b24550104e5bb2ce5f8`。latest.yml版本、文件名、尺寸一致。仅核验本地候选，未运行本机安装器；CI安装烟测与正式资产仍待完成。日志 `v027-{dist,package,artifact-version}.log` 与 `v027-installer.json`。
- 另开全新隔离Electron直接观察界面桥版本0.2.7；用实际安装器重算SHA-512，和latest.yml逐字匹配，日志 `v027-ui-and-update-version.log/json`。
- 六链连续帧补录完成：前后各52段，旧版4096帧、候选4063帧，同数据、双主题、两种尺寸；`work/v027/evidence/compare-v2.html` 按真实起始主题/尺寸匹配并按时间逐帧播放。首次操作后实际帧中位7/11ms，最长307/341ms（首次导航）；不伪称固定帧率或所有操作首帧即时。短反馈在回放中可观察，原frozen-1较迟截图仍保留。抽查窄屏暗色命令面板、浅色确认框和宽屏检索，文字及控件可读，主题20连点四组合均正确。
- 渲染诊断的局限：full轨迹4s的Layout总时长中位199.131→219.444ms，Paint130.187→128.900ms，UpdateLayoutTree516.719→485.799ms；布局成本有增加，不能宣称全部渲染成本下降。4倍CPU单次lite P95为229→270.9ms，长任务28→21；static为104.1→69.5ms，长任务19→22，有限动画0。此项按冻结口径是附加诊断，不套用full档20ms门槛，也不冒称慢CPU普遍流畅；原始样本及轨迹全部保留。
- 浏览器UI再次创建超时，备用Computer Use因无法可靠确认当前浏览器URL而中止；遵守停止要求。三个作品实际体验仍缺失。main/tag/正式Release尚未执行；开发分支CI安装烟测已通过，不能据此标记目标完成。
- 本地完成提交前审计相对bcf9beb的32个授权路径，无用户数据/二进制/日志或凭证模式；package/lock只有版本字段变动，4个旧测试逐字只替换版本，release-readiness保留旧断言并增加新版说明检查。只推指定开发分支运行现有CI与一次性Windows安装烟测，不把候选分支CI冒充精确main SHA门禁。

## 原三轮历史结果（保留失败证据）

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
