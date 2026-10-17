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

当前仍为候选版本。本地完整单元与集成、完整真实 Electron 回归、原生窗口与 Shell 身份检查、快捷方式夹具、依赖审计及重新构建的候选包检查均已通过。独立 CI、正式 Release 与公开附件复核尚未完成。

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
| main CI 与一次性 Windows 安装/卸载烟测 | 待验证 |
| tag Release 工作流与六项公开附件复核 | 待验证 |

## 限制与发布条件

- 安装包沿用已接受的未签名策略，预期签名状态为 `NotSigned`；Windows SmartScreen 可能提示未知发布者，README 与发布说明保留校验指引。
- 安装、启动、单实例、退出和卸载烟测仅在一次性 Windows CI 进行，本机不运行安装器。
- 安装烟测使用隔离的 `testDataDir`，会跳过正式版启动时的用户快捷方式迁移；迁移证据来自单独的临时真实 `.lnk` 夹具，不能将安装烟测视为真实用户快捷方式迁移的验证。
- 正在运行的旧版本仍读取旧包资源，安装并重启新版后才使用新资源；旧的手动固定快捷方式是否缓存图标须以实际验证为准。
- 正式发布必须记录精确提交、main CI 与 tag Release 结果，下载并逐项复核六项公开附件后填写发布时间、附件尺寸、摘要和元数据检查结果。
