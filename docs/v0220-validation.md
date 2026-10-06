# v0.2.20 实现与发布验证

验证日期：2026-10-06（Asia/Shanghai）。目标仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.20。

审查范围、实际缺陷和成熟项目参考见 [后端审查记录](v0220-backend-audit.md)。所有测试与采集审计使用隔离数据目录；用户 data、数据库、模型密钥和设置不参与测试。工作证据保存在被忽略的 work/v0220，正式发布仍使用原 main／tag 门禁。

## 复现与专项

原基线 913／913 单元通过。还原 d74a145 的隔离副本后，14 个针对批次原子性、在途信源变更、模型去重、双额度、完整检索、并行收束、日期补提取预算及四种刊物并发的场景全部失败，结果与当前修复正向回归相符。第一轮夹具未释放门控的失败记录保留，修正释放顺序后的完整复现保存在 baseline-reproduction-final.log。

新增测试覆盖整轮／定时任务互斥、退出等待、实时调度、SQLite 触发器故障注入、真实本地 RSS／模型 HTTP 服务、FTS 分页和快照保护。生产代码无新增依赖或数据库迁移。

首轮旧重试测试曾在总截止时间处失败：测试设置一秒超时，却要求五百毫秒与一秒两段退避后仍获得三次 HTTP 503。现将该“最多两次重试”场景的预算设为五秒，保留三次请求和最终 503 断言；另新增两种协议的一秒预算中断三十秒退避测试。

版本升级后的第一轮全量为 933／941，八项仍断言旧版本的品牌、导出和发布文档夹具失败；同步四个夹具后第二轮为 940／941，剩余一项仍要求旧版日期布局说明。该项改为检查本版实际发布功能，版本、声明和安装说明的严格断言保留；浅色／深色主题及减少动画的保留事实补入说明并同步内置历史。原失败日志分别为 unit.log、unit-final.log。

## 本地完整验证

最终单元及集成 941／941 通过，20.40 秒；真实 Electron 桌面 24／24 通过，267.86 秒。fail／cancelled／skipped／todo 均为 0。原有布局、三种刊期、更新入口、配色、动效、凭据保存和重启检查保持。采集事务格式整理后的九项数据一致性专项再次通过。

生产依赖审计为 0 漏洞，第三方声明 47 项，无新增依赖；内置更新日志 48 条。首次声明生成与旧版本文件的差异仅是版本抬头，这是本次应提交的改动，CI 将对已提交的新抬头执行零差异核验。

实网严格审计结果为 185／186，零空源、一项失败：巨潮资讯·深市公告 fetch failed，因此该命令返回 1。使用相同适配器与隔离目录单独复查得到 30 条公告、178 毫秒。首次网络失败原因未定位，单次复查通过不代表原故障已消除；不移除信源或改变严格检查来制造全绿结果。证据为 source-audit.log／json、source-recheck.log／json。

20,000 条隔离合成数据补验：完整长词检索冷／热请求为 29.45／21.75 毫秒，短主体词为 28.16／25.17 毫秒，均返回 30 条且可翻页；词库按完整集返回 10,000 条匹配，首次计数 3,233.97 毫秒，缓存请求 1.03 毫秒。此为本机样本耗时，不是生产 SLA；大库词库同步计数仍是可观察的性能成本。证据为 search-scale.cjs／log／json。

本地候选构建、包边界、版本、PE 和更新元数据通过：ASAR 1,276 项、13,646,665 B；安装器 99,595,666 B，产品／文件版本 0.2.20，NotSigned，SHA-256 为 `25a618c3a7f18b06e8cfc7d6f4f693520321b7123e87a42969518808de4ea94c`。latest.yml 的版本、文件名、尺寸及两处 SHA-512 与候选安装器一致。格式整理不改变候选行为，正式构建由 CI 从发布提交重新生成，最终摘要以公开附件为准。

本地证据为 unit-complete.log、electron.log、runtime-audit.log、notices.log、build.log、package-verification.log、version-artifacts.log、candidate-pe.json 及前述专项日志。

## 发布状态

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37486620935) 与 [Release](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37487850271) 对提交 `5f01ee5b45d08047c21627c8ba36d60d987b4126` 完整通过：941 项单元及集成、24 项真实桌面、生产依赖审计 0 漏洞、47 项第三方声明、1,276 项包边界及一次性 Windows 安装／启动／单实例／退出／卸载，用户数据保留。发布工作流和门禁保持。

发布时间 2026-10-06T15:36:44Z，Release 非 draft、非 prerelease 且为最新正式版。六项公开附件重新下载并核验 GitHub SHA-256 摘要、校验清单、PE 产品／文件版本、latest.yml 两处 SHA-512、文件名及尺寸、CycloneDX 1.6 SBOM 和第三方声明。正式安装器 99,593,725 B、0.2.20、NotSigned，SHA-256 为 `4c382563bd995688edd21a4b3c7ea4937a0c57aa51ef13320d50012db056a205`。应用匿名实网同步 48 条更新日志，本版正文、发布时间及离线缓存恢复与公开 Release 一致。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `1e11ef051194c2f9bb7e28b9b60c50c7d5227717b24a095a1f95c2b305a19dc7` |
| sbom.cdx.json | 81,352 | `bf20b84f3750d3c6dc0086cb7d7d8708b315e975f9187a7a0cd061ae4f8a0063` |
| SHA256SUMS.txt | 106 | `ff3b8a4968a379e36c76bfd323a734e7f4040e1f29e221616fc649fc93f6c437` |
| Star-Picking-Pavilion-Setup-0.2.20.exe | 99,593,725 | `4c382563bd995688edd21a4b3c7ea4937a0c57aa51ef13320d50012db056a205` |
| Star-Picking-Pavilion-Setup-0.2.20.exe.blockmap | 105,942 | `848ceb31ec8f2d0a2187a7e2b6c0cdb0fee8cb4993e124edba152481416f5e9e` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `9b46826125ba2bd85f97d27d61c99ac0f473971df3f39e164a7e307a83076051` |

发布证据位于 work/v0220：main-ci.log／result.json／verified.json、release.log／result.json／verified.json、tag-verification.txt、release.json、latest-release.json、published-assets/、published-verification.json、published-installer.json、published-sync-verification.json、unpublished-tag-update.json。

最初的后端提交 `553d9d04e0c37c8be0a4478617a1542e8c06d64f` 已通过 [main 完整门禁](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37481309119)。其 Release 两轮均为 941／941 单元、23／24 桌面，原有 layout 矩阵在 Electron 主进程主题观察绑定处（旧 test/e2e/layout.test.js:195）报告“Execution context was destroyed”。原样单项本地补验 1／1 通过、35.15 秒，没有布局溢出断言失败；两次 CI 的原始协议错误未被保留，不能由通用提示推断应用发生导航或崩溃。

核对 [Playwright 1.61.1 的错误改写源码](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright-core/src/server/chromium/crExecutionContext.ts)及[上游同类问题](https://github.com/microsoft/playwright/issues/33737)后，将该测试的主进程观察改为项目既有原生 IPC，继续启动真实 Electron 主入口、真实后端和 renderer，DOM 仍由 Chromium CDP 观察。保持原 160 组矩阵、主题、布局与 240 秒用例时限，额外核对真实主进程 PID，并要求真实抛出的异常透传到调用者；没有重试观察调用或放行门禁。该修改处理测试对实验性 Node 调试上下文的依赖，首次底层协议故障的具体原因仍未知。

修正后的矩阵 1／1 通过、33.95 秒；在相同断言前增加 100 秒观察生命周期的隔离副本 1／1 通过、134.23 秒，单元及集成 941／941 再次通过、20.39 秒。观察修正后本地完整桌面 24／24 通过、260.24 秒，fail／cancelled／skipped／todo 均为 0，证据为 electron-native-complete.log。新提交 main 完整通过后，核对 GitHub 尚不存在 v0.2.20 Release，远端仍为本轮创建的旧标签对象 `e684f8fe9ba71783ff8cd87559384cb935879709`，再以精确 force-with-lease 定向更新这一未发布标签至当前通过提交，重新触发原 Release 流程并完成发布；没有更改已发布版本。旧标签在本地 refs/codex/v0220-unpublished-initial-tag 留有可恢复引用。旧标签对象和两个失败运行证据完整保留。相关证据为 main-ci-backend-original.log／result.json／verified.json、tag-backend-original-verification.txt、release-first.log、release-first-result.json、release-second.log、release-second-result.json、release-failed-layout-local.log、layout-native.log、layout-native-long.log、unit-layout-native.log。


两个旧 Release 运行见 [attempt 1](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37482902289/attempts/1) 与 [attempt 2](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37482902289/attempts/2)。移除测试对实验性 Node 调试上下文的依赖后，完整 main 与新 tag Release 均通过；原始底层协议错误的具体原因仍未知。
