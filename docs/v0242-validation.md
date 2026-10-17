# v0.2.42 验证记录 · Windows 任务栏图标修复

版本日期：2026-10-18（北京时间）。

## 范围与原因

- 用户反馈：应用打开后，Windows 任务栏仍显示 Electron 默认图标，未完全切换为本次上传的新 Logo。
- 本版修复运行时图标路径，全部静态图标统一使用上传的原始 PNG，保留白色圆角底、金色星星与紫色弧线；桌面快捷方式、任务栏、应用窗口、托盘、系统更新通知、安装器、卸载器、网页页签和系统更新页均在范围内。
- 唯一保留项为主页面左上角 Logo：`renderer/logo.svg` 原有动效与 `renderer/logo-still.svg` 首帧回退图，主题适配及悬停播放行为保持不变。
- 公开版本统一为 0.2.42；不调整依赖、用户数据、采集或分析业务。

原生诊断表明，旧实现创建的窗口通过 `WM_GETICON` 已返回上传的新 Logo；窗口的四项 Shell 属性仍为 `VT_EMPTY`。本机还存在一个目标指向本仓库 `electron.exe` 的 `Electron.lnk`，图标仍为 Electron 默认图标，而 AppUserModelID 与正式摘星阁相同。窗口图标已经更新而 Shell 身份缺失、开发入口与正式应用共用身份，解释了只校验 PE 或窗口图标不足以排除任务栏旧图标的问题。

本版据此补齐 Shell 身份路径：

- 正式版沿用 `com.icdafy.star-picking-pavilion`，开发版改用独立的 `.development` AppUserModelID。
- 每个 Windows 窗口通过 `setAppDetails` 显式设置应用标识、图标路径及索引、重新启动命令和显示名称。
- 正式包中的 ICO 改用 `resources/application-icon-0.2.42.ico`，新版本采用自己的资源路径；窗口与通知显式加载 `application-icon.png`。
- 正式版启动时扫描桌面根、开始菜单 Programs 根及“摘星阁”一层子目录、固定任务栏根。仅对目标经 Windows 路径归一化后严格匹配本应用 EXE 的 `.lnk` 更新图标、图标索引与 AppUserModelID，不改目标、启动参数或名称；其它应用链接和开发版快捷方式不迁移。单项失败记录后继续启动。

## 验证状态

[v0.2.42](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.42) 已于 2026-10-18 00:56:27（北京时间）发布为最新正式版，非 draft、非 prerelease。本地完整验证、精确提交 `69167db3a51fd73aff81acc9eca435cd096edee6` 的独立 main CI 与同提交的 Release 第 2 次完整作业均已通过；六项公开附件已重新下载并全部复核通过。

| 项目 | 状态 |
| --- | --- |
| 上传 PNG 与静态源、Windows 多尺寸 ICO 一致性 | PNG SHA-256 `a6f35181efefa063fb674ad5b7a31c3c825765f5d29a635136c7309a394dab21`；`npm run icon -- --check` 通过 |
| 左上角 SVG 动效与首帧回退资源保持原样 | `renderer/logo.svg`、`renderer/logo-still.svg`、`renderer/dom-utils.js` 与品牌样式对上版 Git diff 为空，源文件完全不改 |
| 运行窗口图标与 Shell 任务栏身份 | 实际 Windows 三类 HICON 与上传 PNG 的平均通道误差为 1.637 / 255，四项 Shell 属性通过；完整 E2E 同时通过 Electron 默认图标、缺失 Shell 身份及错误图标的负控 |
| 公开版本、安装器名与发布文档绑定 | `npm run verify:version -- --tag v0.2.42` 通过；`branding.test.js` 与 `release-readiness.test.js` 共 12 / 12 通过 |
| 发布、导出、包校验与快捷方式定向回归 | `branding`、`release-readiness`、`export-markdown`、`package-verifier`、`desktop-branding` 五份测试合计 40 / 40 通过；属于定向检查，不替代完整矩阵 |
| 第三方声明与内置更新日志生成 | `npm run notices` 生成 47 项；`npm run releases:sync` 同步 70 个版本（含 v0.2.42） |
| 已有快捷方式迁移 | mock shell 的 5 / 5 测试通过；临时真实 `.lnk` 夹具在四个指定位置的迁移、再次运行幂等、原有元数据保持及无关目标不变均通过，未对真实用户快捷方式执行迁移 |
| 完整单元与集成 | `npm test` 1170 / 1170 通过，原始记录为被忽略的 `work/v0242/unit.log` |
| 完整真实 Electron 回归 | 43 / 43 通过，0 失败，总耗时 484714.6595 ms；包括 Electron 默认图标、缺失 Shell 身份和错误图标负控 |
| 依赖审计 | 生产依赖与完整工具链审计均为 0 漏洞 |
| 本地候选构建、包边界、实际 PE 图标及版本元数据 | 最终候选重新构建成功，1304 项 ASAR 条目校验通过，应用 EXE 与安装器的七种尺寸 PE 图标相同，resources 中 PNG / ICO 资源检查及 `verify:version -- --tag v0.2.42 --artifacts` 通过；本地 ASAR 15,871,760 B，安装器 102,144,731 B，版本 0.2.42，NotSigned；这些数字属于本地候选包 |
| 本地打包程序实跑 | `win-unpacked` 程序以隔离 `testDataDir` 实际启动，`isPackaged: true`、版本 0.2.42；三类 HICON、四项 Shell 属性、版本化 ICO 托盘资源与 PNG 通知资源均通过，23 项既有快捷方式哈希前后相同；完整记录为被忽略的 `work/v0242/packaged-native/packaged-runtime.json` |
| main CI 与一次性 Windows 安装/卸载烟测 | 精确提交 `69167db3a51fd73aff81acc9eca435cd096edee6` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39048402604) 全部通过：1170 / 1170 单元与集成、43 / 43 真实 Electron、零漏洞依赖审计、1304 项包边界，以及安装后三类 HICON、Shell 属性、单实例、卸载与保留用户数据；CI ASAR 15,884,592 B、安装器 102,142,131 B，属于 main CI 候选产物，不是最终 Release 附件。原始日志 `work/v0242/main-ci-success.log` |
| tag Release 工作流与六项公开附件复核 | `v0.2.42` 指向同一精确提交，[Release 工作流第 2 次作业](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39049461836/attempts/2) 全部通过：1170 / 1170 单元与集成、43 / 43 真实 Electron、0 失败、两项依赖审计零漏洞、1304 项包边界，以及安装后原生图标、Shell 属性、单实例、退出、卸载与用户数据保留；六项公开附件重新下载后的尺寸、摘要、版本、图标与更新元数据复核全部通过。原始日志 `work/v0242/release-success.log`，复核结果 `work/v0242/published-verification.json` |

## 限制与历史记录

- Release 首轮唯一失败为 `v0210-motion.test.js` 的连续导航测试：固定等待 450 ms 后，`.nav-tabs` 选中项与指示器的几何差须全部小于 1 px 的断言未通过。此前基线提交 `719faea` 的 main CI 曾出现相同断言失败；本版同代码本地及 main CI 均为 43 / 43，但尚未定位此次首轮失败原因。原始日志为被忽略的 `work/v0242/release-failed.log`。第 2 次作业保持代码、测试、tag 和精确提交不变，完整重跑后全部通过并发布；首轮失败仍保留，不计为通过。
- 安装包沿用已接受的未签名策略，实际签名状态为 `NotSigned`；Windows SmartScreen 可能提示未知发布者，README 与发布说明保留校验指引。
- 安装、启动、单实例、退出和卸载烟测仅在一次性 Windows CI 进行，本机不运行安装器。
- 安装烟测使用隔离的 `testDataDir`，会跳过正式版启动时的用户快捷方式迁移；迁移证据来自单独的临时真实 `.lnk` 夹具，不能将安装烟测视为真实用户快捷方式迁移的验证。
- 正在运行的旧版本仍读取旧包资源，安装并重启新版后才使用新资源。
- 精确提交、main CI、tag Release 结果、发布时间及六项公开附件复核均已记录，本版发布验证完成。

## 正式发布与附件复核

[v0.2.42](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.42) 于 2026-10-18 00:56:27（北京时间，`2026-10-17T16:56:27Z`）发布为最新正式版，非 draft、非 prerelease；发布 tag 与已验证 main CI 均指向 `69167db3a51fd73aff81acc9eca435cd096edee6`。第 2 次 Release 作业生成的 ASAR 为 15,884,592 B，正式安装器为 102,142,132 B；main CI 的 102,142,131 B 安装器属于单独候选产物。

以下六项公开附件均已重新下载，文件尺寸和 SHA-256 与 GitHub 提供的摘要逐项一致：

- `Star-Picking-Pavilion-Setup-0.2.42.exe`
- `Star-Picking-Pavilion-Setup-0.2.42.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

正式安装器的 PE 产品版本和文件版本均为 0.2.42，签名状态为 `NotSigned`；SHA-256 为 `991033ed7dc12272521cd8f63edba608e6a9089992e66f7570cee1dc42adb421`，与 `SHA256SUMS.txt` 及 GitHub 摘要一致。`latest.yml` 的版本、文件尺寸及两处 SHA-512 均与安装器一致；blockmap 的 4856 块完整覆盖安装器全长，实际安装器的七种尺寸图标帧与仓库 ICO 相同。

SBOM 通过 CycloneDX 1.6 schema 校验，包含 47 个组件及实际 Electron 42.11.11，根版本、锁文件和根依赖一致。第三方声明仅存在 Git LF 与 Windows CRLF 的换行差异，归一化后内容一致；公开 Release 正文与源码发布说明一致。独立复核已确认最新稳定版身份及精确 tag，另一次独立检查的安装器摘要、PE 版本和签名状态也一致。原始附件及元数据保存在被忽略的 `work/v0242/`，完整复核结果为 `work/v0242/published-verification.json`。
