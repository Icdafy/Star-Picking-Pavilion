# v0.2.7 执行进度

## 初始目标回执（2026-10-05，修改前）
1. 完成六条交互链并经既有工作流正式发布 v0.2.7。
2. 一个 agent，最多三轮实现—验证—打磨；目前为任务 0，尚未修改实现。
3. 先核对基线与边界，再建立并冻结同机取证脚本和新增验收口径。
4. 先保留主题连点失败证据，再修复并完成其他交互。
5. 功能/数据正确 > 流畅 > 清晰 > 装饰；沿用玻璃、星空、星鲸与双主题。
6. 最大风险：CSS 余量、前台性能与生命周期取证、精确 SHA 的 CI/Release。
7. 必需验收缺失时不发布、不宣称达标；受阻项写 BLOCKED.md。

## 已完成
- 已读取目标任务书、架构、前端契约和发布指南。
- Git 工作区干净；本地 main 与远端 main 均为 bcf9beb2ca13ca73214735c103185f9de103b6af。
- 远端为 https://github.com/Icdafy/Star-Picking-Pavilion.git；本地及远端没有 v0.2.7 tag。
- 已切换到用户指定分支 codex/v0.2.7-motion；work/v027/ 已由既有 /work/ 规则忽略。
- 用户已授权公开网址策略、未签名包、通过验证后自动推送 main/tag 与正式 Release。
- 已完成三轮，最终状态为“未完成、未发布”；正式版本/本地 main/远端 main 未改。docs/v027-validation.md 已写入全部实际命令、红→绿与保留失败、轨迹汇总及证据限制。

## 顺序与续跑
- [x] 任务 0：基线、契约、三次前台性能与新增红测已实跑；口径及 SHA-256 记录于 docs/v027-motion-plan.md，现已冻结。
- [ ] 任务 1：真实访问至少三个作品，记录触发—运动—反馈与应用映射。
- [x] 第一轮：六条交互实现已完成；新增四项单元绿，原单元出现三项契约回退；原 8 E2E 全绿，新 E2E 两项通过、两项存在冻结脚本的环境假设错误，详见 BLOCKED.md。
- [x] 第二轮：恢复三项旧契约，补齐窗口失焦清理；869 单元全绿，但导航性能退步，原始样本保存在 work/v027/after-round2/。
- [x] 第三轮：撤回旧列表保留/立即调和，869 单元全绿；导航 P95 仍失败（中位 13.9ms、长任务中位 1）。停止新增功能打磨，只完成对照取证、负控、回放和报告；不发布。
- [x] 取证已生成：六链前后回放、双主题双尺寸、112 布局组合、同机性能与负控；性能和两项新增 E2E 仍失败，不把证据齐全等同达标。
- [ ] 发布（受阻，未执行）：候选文档已更新；版本切换、全绿门禁、本地候选包、精确 SHA CI、正式 Release/六资产与下载核验未完成。

## 证据
- 文档收尾后 npm test 再次 869 pass / 0 fail / 0 skip / 0 todo，work/v027/final-unit.log。暂存 22 个路径全在白名单，115 个旧 test 文件未改、常见凭证模式 0、无数据库/日志/二进制或用户数据；cached diff check 通过。候选及报告保存到本地分支，不推 main/tag。
- 52 组前后对照已生成 work/v027/evidence/compare.html，以真实起始主题和尺寸配对，避免主题故障让外观链目录标签与实际主题不同；不改原 PNG 或 frames.json。
- 最终远端只读复核：main 为 bcf9beb2ca13ca73214735c103185f9de103b6af，v0.2.7 tag 不存在，最新非 draft/非 prerelease 为 v0.2.6。没有执行 main/tag 推送或候选 Release。
- 最终完整桌面回归：12 项，10 pass / 2 fail，原 8 项与新增导航/面板、信息流两项全绿，skip/todo 0；两个冻结错误未改。work/v027/round3-e2e.log。
- 前后回放各为 52 段/312 PNG，四主题尺寸组合；四组 20 连点原版翻转错误，候选均保持起始主题。截图耗时造成采样时刻漂移，所有实际时刻保留，不能当精确 0/80ms 录像。
- 不加载 Playwright 的原生隔离诊断确认 20/21/30 同步奇偶、终态、持久化及颜色；真实 hide 为 hidden=true/hasFocus=false/is-idle=true/有限动画0。恢复归焦超时，诊断整体失败，详见 BLOCKED.md。只将已走通的局部检查作为补充，不替代冻结门禁。
- 只读原代码当前对照三次导航均 13.9ms，长任务均 1；不能把第三轮相对冻结基线的退步直接归因为某项候选代码。正式基线与门槛不变，性能必需项仍失败。
- 负控通过：隔离副本 transition:all 退出 1（6 pass / 1 fail），恢复后 7 pass；关闭 motion 环境清理导致新测试退出 1（2 pass / 2 fail），恢复后 4 pass。旧/新测试文件逐字不变，日志 work/v027/negative-*.log。
- 生产依赖审计仍为 0 漏洞；主工作区 0.2.6 notices 生成 47 项且 Git 声明差异为 0；文档相关原 release-readiness 测试 8/8 通过。此处不是 0.2.7 发布通过。
- 第三轮性能：闲置 P95 7.1ms；导航 8.3/14.0/13.9ms，中位 13.9ms（上限 7.92ms），长任务中位 1（上限 0），退出 1；work/v027/round3-measure.log 与 work/v027/after/。冻结门槛仍未通过。
- 第三轮 npm test：869 pass / 0 fail / 0 skip / 0 todo；原 865 与新 4 项全绿，work/v027/round3-unit.log。
- 第二轮性能：闲置 P95 7.1ms；导航三次 7.3/13.8/41.8ms，中位 13.8ms，长任务中位 1，冻结比较失败。未删样本或放宽阈值；第三轮撤回自己的加载节奏改动。轨迹显示 Layout 中位总时长由 173.092ms 增为 218.791ms，原因尚不能单凭轨迹断言。
- 第一轮 npm test：869 项，866 pass / 3 fail；新增 4 项均通过。失败为无 motion 依赖时行壳快照变化，以及两项旧字面锚点；下一轮恢复增强层兼容性与真实调用形式。
- 第二轮 npm test：869 pass / 0 fail / 0 skip / 0 todo；原 865 项及新 4 项全部通过。三项旧契约回退已恢复。
- 第一轮 npm run test:e2e：12 项，10 pass / 2 fail；原 8 项（含 112 组合）均通过，新导航/面板/增量行为通过。主题连点已修复，但测试停在原生颜色大小写比较；本机隐藏窗口没有触发 document.hidden。复核纠正归因：主进程未显式设置 backgroundThrottling，详见 BLOCKED.md。
- 修改实现前的回放已完成：六条链、四种主题/尺寸组合、52 段序列、312 张 PNG，work/v027/evidence/before/replay.html。
- 索引修正后的正式前台基线：闲置 P95 三次 7.2/7.1/7.1ms（中位 7.1ms），导航 7.2/7.5/7.2ms（中位 7.2ms），长任务中位数 0。冻结比较上限分别 7.81ms、7.92ms，另有 20ms 绝对上限。
- 隔离 0.2.7 版本冲突实证：node --test test/release-readiness.test.js 返回 1，4 pass / 4 fail；npm run notices 生成 47 项，仅产品版本头变为 0.2.7。未改真实工作区版本/声明。
- 发布边界冲突已确认：只读 test/release-readiness.test.js 硬编码 0.2.6，且不允许修改的第三方声明头随版本生成。详见 BLOCKED.md；不放宽测试、不带旧声明发布。
- 冻结前纠正取证样本准备：文章与 articles_fts 原子双写（直接 INSERT 原不会建立检索索引）；未改被测服务器实现或行为断言。按修正后的同一 90 条样本重新跑三次基线和前置回放。
- 新增行为红测：主题 20 连点 light ≠ dark、同面板 5 个同时入场、运行中 reduced-motion 仍有有限运动；原始日志 work/v027/red-e2e-indexed.log。
- 基线：npm test 865 pass / 0 fail / 0 skip / 0 todo；npm run test:e2e 8 pass / 0 fail / 0 skip / 0 todo（含原 112 组合）。
- npm run audit:runtime：found 0 vulnerabilities；npm run verify:version -- --tag v0.2.6：Verified v0.2.6。
- 原始输出：work/v027/baseline-{unit,e2e,audit,version}.log。
- 原始 leader 取证仅用于理解；新口径会按本机前台三次中位数重新建立。
- 所有临时样本、脚本、原始日志、截图/录屏只存 work/v027/。
- 后续每完成一项即更新本文；未完成项不重复声称完成。
