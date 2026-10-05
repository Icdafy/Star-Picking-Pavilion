# v0.2.7 阻塞记录

## 发布硬阻塞（边界冲突）
- `test/release-readiness.test.js` 为只读既有测试，但多处 `assert.equal(..., '0.2.6')` 逐字锁住 package.version、shortVersionWindows、build.buildVersion、版本验证器和更新元数据。把允许修改的版本字段升为 0.2.7 将必然使既有测试失败；不升级则不能发布 v0.2.7。任务明确禁止修改既有测试/判据，不能绕过。
- `THIRD_PARTY_NOTICES.txt` 在允许修改路径之外，现有声明头含 0.2.6；既有发布测试也要求声明头为 0.2.6。0.2.7 的 `npm run notices` 会变更产品版本头，与任务要求的 `git diff --exit-code -- THIRD_PARTY_NOTICES.txt` 零差异冲突。不能提交未授权的声明修改或带旧版本声明的包。
- 三轮实现和独立取证已结束；保留主工作区 0.2.6 版本字段。既有测试、声明的写入边界与冻结验收问题没有获得新的授权，不能进入 v0.2.7 版本切换、main/tag/Release。隔离副本失败实证已列在下项。
- 实证：在 work/v027/release-conflict/ 只升版本字段后，`node --test test/release-readiness.test.js` 退出 1，4 pass / 4 fail（实际 0.2.7、期望 0.2.6；tag v0.2.6 does not match public release 0.2.7）。`npm run notices` 正常生成 47 项；与原声明比较只改变产品头 0.2.6 →0.2.7。原始输出 work/v027/release-conflict-{tests,notices}.log；没有改主工作区旧测试、版本或声明。

## 暂时受阻
- 参考作品的浏览器 UI 通道：Linear 页面已创建，但 CUA 的页面绑定/DOM 读取连续三次超时（30s、30s、20s）；换 Rauno 来源后仍超时。备用 Windows Computer Use 通道在选定 Chrome 后停止，原因是无法可靠确认当前浏览器 URL 以执行策略检查。本轮停止浏览器 UI 操作，不绕过该检查。尚未真实观察三个作品的交互，不能声称体验完成；此必需项未完成前不得发布。

## 性能必需项未通过
- 第二轮导航 P95 三次中位 13.8ms，长任务中位 1；第三轮撤回加载节奏改动后仍为 13.9ms / 1，超过冻结的 7.92ms / 0。同机闲置保持 7.1ms，但不能据此忽略导航失败。
- 三轮实现上限已达，不继续新增功能。保留全部失败样本，使用封存原代码补录当前机器对照以核查归因；对照不替换正式基线、不放宽阈值，也不使候选通过。
- 当前封存原代码的三次对照均为导航 13.9ms / 1，和第三轮候选相同；环境字段与显示器相同，仍无法定位机器状态变化的原因。已撤回自身加载节奏尝试，其他改动保留在本地候选，不据对照宣称性能达标。

## 冻结验收的环境假设错误（执行方责任）
- 新 E2E 冻结前的红测在前置故障处停止，未走到两个尾部环境检查，导致冻结过早。后续不擅自修改冻结文件或制造产品行为迎合错误判据。
- 主题的真实原生窗口颜色返回 `#FFFFFF`，冻结测试期望 `#ffffff`。二者颜色相同，但脚本未规范化大小写，第一轮主题测试在原生颜色比较处失败。20/21/30 次同步奇偶与持久化已在原生隔离诊断记录正确；冻结测试仍失败，不得冒称通过。
- 本机 Playwright/Electron 隐藏原生窗口后 `document.hidden` 没有变 true，冻结测试等待此属性超时。复核源码后纠正前次归因：electron/main.js 没有显式设置 `backgroundThrottling:false`；Playwright 的 Electron loader 加入禁用后台节流与遮挡后台化的启动参数，但具体可见性原因尚未单独定位。渲染层继续用真实 blur/focus 停止并恢复运动，同时诊断记录 BrowserWindow.isVisible、document.hasFocus 和动画终态；不改主进程、不伪造 document.hidden，不把诊断替代冻结门禁。
- 补查 node_modules/playwright-core/lib/coreBundle.js：主框架默认发送 `Emulation.setFocusEmulationEnabled`，enabled 为 true。首份补充诊断也因 document.hasFocus 持续 true 失败（日志保留）。后续补充诊断关闭此自动化覆盖再观察真实窗口隐藏/归焦；不修改冻结测试。冻结性能脚本仅用 document.hasFocus/hidden 逐帧判断前台，受该覆盖影响，原生焦点未逐帧核验，这是另一取证限制。
- 补充诊断关闭新 CDP session 的焦点模拟后，原 session 的覆盖仍未解除，隐藏检查再次超时。改用未加载 Playwright 的新原生 Electron 隔离实例取证：20/21/30 主题奇偶、持久化、原生颜色均正确，真实 hide 时 hidden=true、hasFocus=false、is-idle=true、有限动画=0。随后 show/focus 的真实归焦等待 15s 超时，故诊断整体 passed=false；不声称隐藏/恢复整链通过，不再反复尝试同项。原始 work/v027/native-lifecycle-result.json 与日志完整保留。该脚本的 Electron 退出码为 0 但结果失败，不能按进程退出码冒称绿。

## 基线
- 无不符项：865 单元/集成、8 E2E、0 生产漏洞及 v0.2.6 版本校验均通过。
