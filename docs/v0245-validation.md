# v0.2.45 验证记录

本版修复采集分析结束后的灵动岛提示与完成文案。[v0.2.45](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.45)已于2026-10-24 13:33:12（北京时间）发布为最新正式版，非draft、非prerelease；六项公开附件重新下载复核全部通过。候选验证、main CI、Release与首轮失败沿革分别记录如下。

## 实现

- 顶部管线胶囊仅在任务运行期间显示，结束时自动清除；重复终态刷新不重新弹出，新一轮任务恢复显示。
- 设置 → 自动采集 → 本轮处理记录继续保留本轮摘要、步骤、耗时、待处理数量与预算等说明。
- 有剩余资料等待后续处理时，本轮完成提示改为“本轮已完成”。本版不改变采集、分析或预算策略。
- 版本、安装器与更新元数据统一为0.2.45，无依赖变更。

## 验证

- 本地完整单元与集成1242/1242通过，0失败，23768.2108ms，日志为work/v0245/unit.log。
- 针对后端生命周期、进度展示及胶囊的35项检查通过。真实Electron42.11.18进度回归1/1通过，覆盖展开中的终态退场、重复终态与迟到运行态、lastPipeline回退、新轮次重现、完成/失败/停止退场、设置记录保留及更新通知共存；截图为work/v0245/screenshots/。目视确认预算记录保留且顶部无管线胶囊。
- 生产与完整工具链依赖审计均为0漏洞，日志为work/v0245/audit-runtime.log及audit-toolchain.log。
- 版本、73条内置发布历史及规范图标检查通过，第三方声明已更新为本版。

- 本地候选构建通过，1311项ASAR包边界、7种规范Windows图标及带产物版本校验通过；ASAR16,168,142字节、安装器102,246,546字节，日志为work/v0245/build.log及package.log。该候选用于本地核验，正式附件由Release工作流重新构建。

## main CI

精确提交 `7b8c91a15eb0e33a62801e4664eb4871086ab10b` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/40063859778) 全部通过：1242/1242单元与集成（60786.9842ms）、45/45真实Electron（677002.6288ms）、生产及完整工具链零漏洞审计、第三方声明一致性、1311项ASAR包边界、7种规范Windows图标，以及一次性Windows安装、启动、单实例、原生窗口与Shell图标、退出、卸载和用户数据保留。完整日志为work/v0245/main-ci.log。

该main CI候选ASAR为16,181,300字节，安装器为102,243,168字节。这是CI候选产物，正式Release附件由标签工作流重新构建，不能以此代替公开附件核验。

## 额外实网信源巡检

隔离巡检结果记录于work/v0245/source-audit.json：201个信源中194个返回内容、4个空结果、3个失败、0个跳过。`npm run audit:sources -- --strict` 未通过；这是额外的外部信源检查，不属于现有CI或Release工作流门禁，不将其记作全通过。

四个空结果为东财检索的时的科技、迅蚁科技、九天微星，以及一级市场·周度融资盘点。三个失败为中国民用航空局·民航要闻（fetch failed）、国家航天局·官网（This operation was aborted）、巨潮资讯·深市公告（fetch failed）。本次记录仅反映巡检时的结果，不据此宣称所有信源持续可用。

## Release与公开附件

`v0.2.45` annotated标签已在main CI通过后推送，指向同一精确提交。其 [Release工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/40064853432) 首轮单元1242/1242通过，桌面44/45；唯一失败为既有v0240-cleanup.test.js第80行，重新开启自动清理后读取settings.json仍为false，期望true。本次新增的进度回归通过，未进入构建和上传阶段。首轮日志为work/v0245/release-first-failed.log。

同一旧用例在不修改产品或测试的情况下连续两次本地定向复验均通过（7629.8488ms、7487.7786ms），日志为work/v0245/cleanup-recheck.log；同一提交此前main完整45项也通过。失败原因尚未完全定位，保留为一次间歇性失败，不将复验当作首轮成功。

保持提交、代码、断言及tag不变，[Release第2次完整作业](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/40064853432/attempts/2)全部通过并发布：1242/1242单元与集成（41403.4397ms）、45/45真实Electron（658766.8415ms）、生产及完整工具链零漏洞审计、第三方声明、1311项包边界、七尺寸图标、带产物版本检查，以及一次性Windows安装、启动、单实例、原生窗口/Shell图标、退出、卸载和用户数据保留。正式ASAR16,181,300字节、安装器102,243,125字节，完整日志为work/v0245/release-success.log。

六项公开附件重新下载至work/v0245/published/，字节数和SHA-256逐一匹配GitHub REST资产元数据，安装器SHA-256与SHA256SUMS.txt一致：`b0f4368349b94b6fbf3a63b333340f337cf4ec101691efc05e150a8294a587e2`。

| 附件 | 字节数 |
| --- | ---: |
| Star-Picking-Pavilion-Setup-0.2.45.exe | 102,243,125 |
| Star-Picking-Pavilion-Setup-0.2.45.exe.blockmap | 107,945 |
| latest.yml | 374 |
| SHA256SUMS.txt | 106 |
| sbom.cdx.json | 82,051 |
| THIRD_PARTY_NOTICES.txt | 6,347 |

安装器PE产品及文件版本均为0.2.45，签名状态NotSigned，七尺寸图标一致；latest.yml版本、文件名、尺寸与两处SHA-512匹配实际安装器；blockmap格式2、4916块覆盖完整文件；CycloneDX1.6 schema通过，47个组件包含锁定的Electron42.11.18；第三方声明换行归一化后与仓库一致。

公开Release ID为422539113，已核对最新正式版与非draft/非prerelease状态，annotated tag解析到精确提交`7b8c91a15eb0e33a62801e4664eb4871086ab10b`，正文与该提交的RELEASE_NOTES.md一致。核验报告为work/v0245/published-verification.json及published-release-state.json，元数据为release.json；核验脚本verify-published.cjs及verify-release-state.cjs保留。未执行下载的安装器。

## 边界

本轮处理记录仍只保留于当前服务进程。安装包沿用未签名策略。实际安装、启动、单实例、退出、卸载与用户数据保留在一次性 Windows CI 执行，本机不运行安装器。
