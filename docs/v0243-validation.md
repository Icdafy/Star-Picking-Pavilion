# v0.2.43 验证记录

本版适配 DeepSeek-V4.1-Flash-1017 与显示器刷新率自动匹配。[v0.2.43](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.43) 已于 2026-10-18 17:24:53（北京时间）发布为最新正式版，非 draft、非 prerelease；六项公开附件重新下载复核全部通过。以下记录区分本地候选、main CI 与最终 Release。

## 实现与依据

- [DeepSeek 官方更新日志](https://api-docs.deepseek.com/zh-cn/updates/) 的 2026-10-17 条目确认 `deepseek-flash` 对应 DeepSeek-V4.1-Flash-1017，API 调用方式与价格保持不变。[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 确认旧 Flash 名称由新版服务。读取、发现、连接测试及实际请求的 Flash 别名统一归一，目录显示 1017 并保留图文输入；旧结果缓存按新版模型身份隔离。
- Electron `screen.getDisplayMatching(window.getBounds())` 读取窗口相交最多的显示器，向沙箱只暴露显示器 ID 与有效刷新率；沿用可信主窗口 IPC 边界。窗口移动、恢复前台、显示指标与热插拔更新，前台五秒原生轮询兜底驱动未上报的纯刷新率变更。
- 默认自动；手动 60 / 70 / 120 / 144Hz，保存用户选择，每台电脑重新检测。系统值优先，缺失时使用前台 rAF 间隔回退；原生结果不会被偶发慢帧覆盖。分数刷新率吸附常见档，跨屏可升可降，过期测量和异步结果不覆盖更新值。
- 动画时长以毫秒为单位，采样跟随有效频率。手动档应用值不超过检测到的屏幕刷新率；减少动态效果、后台暂停与性能分级继续生效。

## 验证状态

- 原生显示器读取、跨屏与显示参数更新、驱动兜底检测、事件去重、生命周期清理和可信 IPC 边界：定向测试通过。
- DeepSeek 模型目录、旧配置迁移、图文能力、实际请求负载、OpenAI / Anthropic 协议、连接测试与模型发现：定向测试通过，使用隔离模拟服务，不使用用户密钥。
- 本地完整单元与集成：1205 / 1205 通过，0 失败，记录 `work/v0243-unit-passed.log`。其中新增 19 项运动时钟回归覆盖四档、系统与 rAF 回退、异步竞态、同时间姿态与着色器两遍绘制节奏。
- 新增真实 Electron 刷新率测试：1 / 1 通过，覆盖原生桥、四档交互、相同动画时长、硬件变化通知、偏好保存与重启恢复，记录 `work/v0243-refresh-e2e.log`；换屏使用原生显示器夹具，不操作实际系统显示设置。
- 生产依赖、完整工具链审计均为 0 漏洞；静态图标一致性检查及 v0.2.43 版本与内置日志检查通过。
- 本地完整真实 Electron：44 / 44 通过，0 失败，耗时 500264.4233 ms，记录 `work/v0243-e2e.log`。
- 本地候选构建成功，1305 项 ASAR 包边界、7 种 Windows 图标尺寸及带产物的 v0.2.43 版本校验通过；ASAR 15,896,936 B，安装器 102,150,496 B，签名状态 NotSigned。这些数字属于本地候选包，不是最终 Release 附件。
- 本地打包 EXE 使用隔离测试资料实际启动，确认 isPackaged、ASAR 路径、0.2.43 版本、原生 144Hz 自动匹配、Flash 1017 默认模型与图文输入、原生窗口图标和 Shell 身份全部通过；无渲染错误。记录 `work/v0243/packaged-runtime.json`，页面截图 `work/v0243/packaged-refresh-settings.png`。
- 本机 144Hz 打包程序短测：动态背景关闭、开启、再次关闭、开启并轻量滚动四组各约 1.5 秒，p95 为 7.2 / 7.2 / 7.3 / 7.1 ms，均无超过 12.5 ms 的帧间隔。测量开始前调速器已进入轻盈冷却期，跟手效果关闭，不能把这组数据解释为完整交互档或其他电脑的持续性能保证；记录 `work/v0243/packaged-performance.json`。
- 精确提交 `790477cf0f54e4e0fd5b7f4d307ed61fca2481ec` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39087333855) 全部门禁通过：1205 / 1205 单元与集成、44 / 44 真实 Electron（704357.3307 ms）、生产及工具链零漏洞审计、1305 项包边界，以及安装、原生窗口图标与 Shell 身份、单实例、退出、卸载与用户数据保留烟测。main CI 候选 ASAR 15,909,839 B，安装器 102,147,944 B，记录 `work/v0243/main-ci-success.log`。
- `v0.2.43` 标签指向同一精确提交；[Release 第 2 次作业](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39088261973/attempts/2) 全部门禁通过：1205 / 1205 单元与集成（40303.39 ms）、44 / 44 真实 Electron（712826.1569 ms）、两项零漏洞审计、1305 项包边界、七尺寸图标、带产物版本校验，以及安装后原生窗口图标与 Shell 身份、单实例、退出、卸载和用户数据保留。最终 Release ASAR 15,909,839 B，安装器 102,147,891 B；成功日志 `work/v0243/release-success.log` 保留。

## 公开附件复核

六项公开附件下载到独立目录 `work/v0243/published/`，文件尺寸和 SHA-256 均与 GitHub REST 元数据一致。安装器 SHA-256 为 `6e889468c0c2789f6a3da0e41971db1e26c4f01ebc3784ee38bf99568cd600fa`，与 `SHA256SUMS.txt` 一致。

| 附件 | 字节数 |
| --- | ---: |
| `Star-Picking-Pavilion-Setup-0.2.43.exe` | 102,147,891 |
| `Star-Picking-Pavilion-Setup-0.2.43.exe.blockmap` | 106,741 |
| `latest.yml` | 374 |
| `SHA256SUMS.txt` | 106 |
| `sbom.cdx.json` | 82,051 |
| `THIRD_PARTY_NOTICES.txt` | 6,347 |

安装器 PE 产品及文件版本均为 0.2.43，签名状态 NotSigned；七尺寸图标与规范资源一致。`latest.yml` 的版本、文件名、尺寸及两处 SHA-512 均与实际安装器一致；blockmap 为格式 2，4863 块覆盖完整文件。CycloneDX 1.6 schema 校验通过，47 项组件包含锁定且作为实际运行依赖的 Electron 42.11.11；第三方声明换行归一化后与仓库一致。

公开 Release ID 为 `416351575`，最新正式版标志与发布时间已核对，正文与精确提交的 `RELEASE_NOTES.md` 一致；远端 annotated tag 对象为 `d2424a899e7a845e22096249403a3e22c2da73c7`，解析至 `790477cf0f54e4e0fd5b7f4d307ed61fca2481ec`。复核报告为 `work/v0243/published-verification.json` 与 `work/v0243/published-release-state.json`，原始 REST 元数据为 `work/v0243/release.json`。本地复核脚本遇到安全模块自动加载失败后，显式从 Windows PowerShell 自身目录加载系统安全模块完成签名读取；未执行下载的安装器。

## 首轮 CI 与修复记录

精确提交 `353561bc681d7a9bb56a316a7c5d0ff161fa37b7` 的 [首轮 main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39086352967) 为 1205 / 1205 单元通过、桌面回归 41 / 44；该轮失败时尚未打 tag 或发布。日志 `work/v0243/main-live.log` 保留三项失败：

- 既有导航测试固定等待 450 ms 后读取几何，早于 300 × 1.382 + 50 = 464.6 ms 的提交兜底期限；缩放后键盘导航在 CI 触发该竞争。诊断确认 WAAPI 初始处于 pending 且最终几何正确；改为有界观察动画结束和连续三帧稳定几何，保留全部小于 1px 的断言和暂停动画的原有检查，超时输出几何与时钟诊断。
- 既有设置测试退出后同步删除临时资料，Chromium DIPS 句柄仍被占用。改为等待 Electron 实际 close、校验临时目录边界，再作有界异步删除重试，失败仍明确报错。
- 新刷新率测试未明确前台与非减少动态效果的动画测量条件，并假定所有设备使用完整档时长。改为确认原生聚焦、显式启用非减少动态效果，按真实硬件推导的 full / lite 档验证相应固定时长及采样密度，保留每档动画和等时长断言；未改变产品的硬件分级策略。

三项修复均仅涉及测试流程，未修改运行时代码。

## Release 首轮与重跑记录

同一精确提交 `790477cf0f54e4e0fd5b7f4d307ed61fca2481ec` 的 [Release 首轮](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39088261973/attempts/1) 为 1205 / 1205 单元通过、桌面回归 42 / 44，未进入发布步骤，未创建 Release。失败为既有模型设置测试等待 `.nav` 可见 30 秒超时，以及既有主题测试等待 1000 ms 后仍观察到 `theme-transition`；原始日志 `work/v0243/release-first-failed.log` 保留。补充定向复验均通过，但不能据此认定首轮原因已解决。[第 2 次执行](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39088261973/attempts/2) 保持相同提交、代码、测试断言及 tag，完整门禁全部通过后发布。

## 验证边界

四档与换屏路径用确定性时钟、原生显示器夹具和真实 Electron 界面共同验证；测试环境的物理显示器不能代表四种不同硬件。不同电脑的 GPU、驱动、负载和系统省电状态影响可实现帧率。手动档属于动效适配，不更改系统显示设置，不承诺 60Hz 屏幕显示 144 个不同画面。

未使用用户 API Key 进行付费模型调用。既有已分析内容继续保留，新任务按新版模型身份执行。安装包沿用未签名策略，Windows SmartScreen 可能提示未知发布者；安装/卸载只在一次性 Windows CI 进行。

实网信源严格巡检为 201 个入口、196 个有内容、4 个空结果、1 个请求失败，因此 strict 命令未通过。空结果为东财检索“迅蚁科技”“九天微星”和一级市场“卫星完成融资”“eVTOL完成融资”，国家航天局官网返回 fetch failed；这是本次时点的联网观察，本版未改动采集器。原始记录 `work/v0243/source-audit.json` 与 `source-audit.log` 保留。
