# v0.2.46 验证记录

本版按实测产出重新梳理内置信源，并新增中国政府网最新政策 `govcn://` 适配器；不改界面、分析与预算策略。逐源依据见 [v0.2.46 信源梳理](v0246-sources.md)。[v0.2.46](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.46)已于2026-10-24 18:38:22（北京时间）发布为最新正式版，非draft、非prerelease；main CI与Release均首轮通过，六项公开附件重新下载复核全部通过。

## 实现

- 种子信源库 `config/sources.default.json` 升级到 v15：移出 28 个、修复 3 个、新增 21 个入口，内置信源 201 → 194，海外 16 → 20。迁移在补源之前、同一事务内执行；换址保留原 ID、统计与启停状态，移出保留信源行、历史文章与星标，用户已删除的行不复活。
- 指向本版迁走或移出地址的旧迁移步骤已折叠：被取代的原地修正删除，旧换址直达新地址或改为移出，跨多个旧版本升级结果一致。
- `server/collectors/api.js` 新增 `govcn://[检索词]`：读取中国政府网“最新政策”的静态 JSON，只取最新 40 条，条目地址必须在 gov.cn 站内，检索词沿用既有入库守卫；校验层同步接受该 scheme。
- 版本、安装器与更新元数据统一为 0.2.46，无依赖变更。

## 验证

- 本地完整单元与集成 1246/1246 通过（34721.2593ms），日志为 work/v0246/unit-final.log。新增 4 项：`govcn` 映射与站外地址过滤、检索词守卫与结构异常、v14 → v15 升级（换址保留统计、移出保留星标、公司池与自建源不受影响、幂等）、v15 目录约束。
- 用户库只读副本升级演练：启用信源 201 → 194，与新种子目录逐条一致，文章 7,821 条不变，国家航天局、民航局、中国民航网三行保留原 ID 与统计。
- 产品适配器逐源实测（work/v0246/audit-final.json）与正式巡检 `npm run audit:sources`（work/v0246/audit-sources-final.json，2026-10-24T10:01:26Z，海外网络可用）：194 个入口中 191 个返回内容、3 个空结果、0 个失败、0 个跳过，共解析 5,434 条。三个空结果均为公司池监控线（时的科技、迅蚁科技、九天微星），按规则保留；严格模式因此仍不通过，这项检查不属于 CI 或 Release 门禁。
- 生产与完整工具链依赖审计均为 0 漏洞，日志为 work/v0246/audit-runtime.log 及 audit-toolchain.log。第三方声明已更新为本版，内置发布历史 74 条校验通过。

- 真实 Electron 45/45 通过（662883.6033ms），日志为 work/v0246/e2e.log。本地候选构建、包边界、七尺寸图标与带产物版本校验通过：ASAR 16,177,501 字节、安装器 102,248,515 字节，日志为 work/v0246/build.log 及 package.log；正式附件由 Release 工作流重新构建。

## main CI

精确提交 `9496ae3881546a6249ab6025eaa41181271a7640` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/40085769532) 首轮全部通过：1246/1246单元与集成（42256.0754ms）、45/45真实Electron（619371.8952ms）、生产及完整工具链零漏洞审计、第三方声明一致性、ASAR包边界、7种规范Windows图标，以及一次性Windows安装、启动、单实例、原生窗口与Shell图标、退出、卸载和用户数据保留。CI候选ASAR 16,190,272字节、安装器102,245,835字节，完整日志为work/v0246/main-ci.log。

## Release与公开附件

`v0.2.46` annotated标签指向同一精确提交，[Release工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/40085771374)首轮全部通过并发布：1246/1246单元与集成（47793.0556ms）、45/45真实Electron（668686.9736ms）、零漏洞审计、第三方声明、包边界、七尺寸图标、带产物版本检查及一次性Windows安装/卸载烟测。正式ASAR 16,190,272字节、安装器102,245,897字节，完整日志为work/v0246/release-success.log。

六项公开附件重新下载至work/v0246/published/，字节数和SHA-256逐一匹配GitHub资产摘要，安装器SHA-256与SHA256SUMS.txt一致：`394ec9be774f594afad2a9aa1cdc732d36eda74369dd26fad6f769d8401cf06a`。

| 附件 | 字节数 |
| --- | ---: |
| Star-Picking-Pavilion-Setup-0.2.46.exe | 102,245,897 |
| Star-Picking-Pavilion-Setup-0.2.46.exe.blockmap | 107,390 |
| latest.yml | 374 |
| SHA256SUMS.txt | 106 |
| sbom.cdx.json | 82,051 |
| THIRD_PARTY_NOTICES.txt | 6,347 |

安装器PE产品及文件版本均为0.2.46，签名状态NotSigned，七尺寸图标一致；latest.yml版本、文件名、尺寸与SHA-512匹配实际安装器；blockmap 4901块覆盖完整文件；CycloneDX SBOM 47个组件含锁定的Electron 42.11.18；第三方声明换行归一化后与仓库一致。公开Release ID为422667388，已核对为最新正式版，远端tag解析到精确提交，正文与该提交的RELEASE_NOTES.md一致。核验报告为work/v0246/published-verification.json及published-release-state.json。未执行下载的安装器。

## 边界

信源巡检只反映巡检时刻的站点状态，不保证各站点今后持续可用。中国宇航学会因巡检期间连续 HTTP 504 未写入；Launch Library 2 结构化发射数据列为待接入。安装包沿用未签名策略；安装、启动、单实例、退出、卸载与用户数据保留在一次性 Windows CI 执行，本机不运行安装器。
