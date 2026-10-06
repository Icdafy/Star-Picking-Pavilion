# v0.2.13 验证与发布记录

目标仓库为 Icdafy/Star-Picking-Pavilion，公开版本、Windows 产品版本及构建版本均为 0.2.13。范围为工作区八个页头横幅与情报日志布局，补充文字及图形动效；应用 ID、数据库路径、用户配置和模型密钥格式沿用。

## 设计与实现

参考 [Linear 的界面重设计](https://linear.app/now/how-we-redesigned-the-linear-ui)中页头、过滤及属性的层级与对齐，[shadcn/ui 控制台](https://ui.shadcn.com/examples/dashboard)的标题和操作布局，以及 [Vercel 界面准则](https://vercel.com/design/guidelines)中的响应式、焦点与减少动画原则。将这些布局思想结合摘星阁已有 Aqua 材质实现，没有引入参考产品的品牌图形或外部图片。

- `.page-banner` 统一覆盖精选、全部动态、星标、一级市场、更新日志、常用网址、信源与设置。信息流控制器依据实际视图同步栏目、标题、说明及状态；Aqua 时段问候移至次级文字。操作入口、网址计数和云幄名称保留。移除矮窗口隐藏信息流页头的旧规则。
- 栏目、标题和说明复用已有运动引擎分层入场。轨道运行与标识轻闪复用现有 sweep／twinkle 关键帧，无 GIF 下载、网络素材或新增脚本。持续动效在 lite／static、减少动画时停止，失焦／后台由既有暂停规则处理；系统强制颜色隐藏轨道。运动引擎在离开视图、失焦、减少动画及退出时取消文字动画。
- 情报日志的周期与操作放入 `.daily-toolbar`，日报／周报／月报与出刊节奏同步。日报专属复制、导出及重新生成范围保留。
- `.daily-head` 紧随工具栏，作为独立报告概况，展示日期、状态、生成信息、日期导航及三项统计。日报使用精选和两领域数量，周／月报使用精选、热点和资本事件。请求开始清除旧值并显示读取状态，失败显示恢复提示，过期请求不得写入旧统计。日期按钮的名称与边界同步周期。
- 既有布局矩阵从八个视图扩展到十个，覆盖全部动态与星标的不同文案；四窗口、四缩放共 160 个组合，原交互元素边界断言保留。

CSS 按 Windows CRLF 最坏口径共 298,936 B，低于既有 292 KiB／299,008 B 门槛，脚本 27／27、关键帧 20／20，预算未上调。用共享页头替换旧主视觉，并清理相关死规则和过时说明。

## 本地专项与修正记录

首批 52 项控制器、布局和静态护栏通过。新增真实 Electron 专项使用独立配置及六条虚构新闻，验证八个页头、深浅主题、1440／800 宽窗口、工具栏结构、日报／周报／月报统计、日期边界、重新生成、真实帧中的文字运动、减少动画和系统强制颜色；最终专项通过，36 张截图在 work/v0213/screenshots，真实运动帧在 banner-motion.json。

专项前两轮因测试新闻时间未进入日报 08:00 入库窗口、分类不在服务端分区中而得到零统计。修正为当天 07:30 及“技术研发”，保留 6／3／3 的精确断言；没有修改日报取数和分区逻辑。原输出保存在 ui-first.log、ui-second.log，成功输出为 ui-third.log。

完整单元首轮 889／892，三处旧品牌和发布说明检查失败；恢复“云幄 · 常用网址”品牌文案，并将发布指南更新为本版安装包。第二轮快照仍读取到尚未更新的指南，891／892；后续 70 项相关检查通过。原始输出保留，最终完整回归另列。

生产依赖审计 0 个漏洞，无新增依赖。第三方声明共 47 项，内置发布历史 41 条（40 个历史正式版本及本版），本版正文与 RELEASE_NOTES.md 完全一致。

## 最终本地回归与信源

观测修正后的最终完整单元与集成回归 892／892（14.60 秒），完整真实 Electron 回归 21／21（194.68 秒），fail／cancelled／skip／todo 全为 0，包含 160 个布局组合。原始输出为 work/v0213/unit-click-final.log、e2e-click-final.log。36 张最终主题／宽窄截图已逐类型复核，报告统计、右侧操作、独立概况和标题文字可见，无重叠或横向溢出。

实网信源复查 186 项中 183 返回内容、1 项为空（东财检索·穿越者）、2 项请求失败（巨潮资讯·深市公告、泰伯网·空天资讯，fetch failed）。严格信源复查未通过，保留失败记录，不删源或调整门禁掩盖结果。本版没有修改信源目录与采集逻辑；原始证据为 work/v0213/source-audit.{log,json}。

## 发布状态

本地候选包构建成功，1273 项包边界通过，app.asar 为 13,590,704 B，安装包为 99,582,467 B。十二项生产文件与 ASAR 逐字节一致，包内版本、PE 文件／产品版本与更新元数据均为 0.2.13，签名 NotSigned；安装器 SHA-256 为 `22fed2504ac3bc112d8d593f78d6fe0aaf045671b6aac623b1f942b75542ffac`。证据为 work/v0213/build.log、package-audit.log、candidate-metadata.json、candidate-asar.json。补充比对工具首次对三层 ASAR 路径使用正斜杠，Windows 库未识别，改为本机路径分隔符后全部通过；包中该文件本来完整存在。

本地候选产物仅作开发验证；正式产物由下述 tag 工作流独立生成。安装／启动／单实例／退出／卸载烟测仅在一次性 Windows CI 执行，本机不运行安装器。

### 分支 CI 首轮与动效观测修正

首个产品提交 `8f4c406bcf6bb04bdc48ebf15c3679a2679ea382` 的 [分支 CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37426460699) 为 892／892 单元、20／21 桌面通过；新增横幅用例未观察到标题位移而失败，其余二十项（包括 160 布局）通过，后续审计、构建和安装步骤未执行。原始完整 metadata／日志为 work/v0213/branch-ci-first-failed.{json,log}。

将新测试的真实帧采样放在原生 click 事件边界，消除“控制点击后，再经 CDP 请求启动采样”的观测间隙；明确设置 no-preference 动画场景并核验真实焦点，随后继续测试减少动画。保留大于两个不同真实位置的原断言、500 ms 采样时长和全部几何／统计检查。补充输出首尾帧、焦点、档位及不同位置数量，不修改动画实现、时长、产品配置或性能预算。首轮没有采样帧记录，不能仅凭失败断言确定其具体原因。

修正后本地专项通过（34.97 秒），73 个真实帧中有 58 个不同位置，标题从 8 px／opacity 0 到 0 px／opacity 1，真实前台且 full 档。原始输出为 work/v0213/ui-click-capture.log，更新的帧记录为 banner-motion.json。随后的完整本地回归采到 74 帧／59 个不同位置；三个远端完整门禁结果见下节。

## 正式发布与下载核验

[v0.2.13](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.13) 已于 2026-10-06T07:21:35Z 发布为最新正式版，draft=false、prerelease=false。注释 tag 对象为 `d792ce446f68a03607fde14d4122f2d795517b7e`，解引用为产品提交 `f8d1b66d8ebabb9171dadc583d3313d4cecc0990`，推送时远端 main 同时指向该产品提交。[分支 CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37427473304)、[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37428438472) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37428443597) 对该精确提交均首次完整通过：892／892 单元、21／21 真实 Electron（160 布局组合），fail／cancelled／skip／todo 全为 0，生产依赖审计 0 漏洞、47 项声明零差异、1273 包边界。一次性 Windows 安装、启动、单实例、退出和卸载成功，用户数据保留。这里的首次指该最终提交；上一提交的分支失败继续保留于上节。

六项正式附件重新下载至新的隔离目录 `F:\摘星阁\work\v0213\published-20261006072215204`，文件尺寸与 GitHub SHA-256 摘要逐项一致，安装器校验同时匹配 SHA256SUMS.txt。正式安装器 99,580,204 B，PE 文件／产品版本 0.2.13，NotSigned；latest.yml 版本、路径、尺寸及两处 SHA-512 均与实际安装器匹配，SBOM 为 CycloneDX 1.6／产品 0.2.13，第三方声明统一行尾后与发布 tag 内容完全一致。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `c157031addadaea044c8f4cf0aeefef8d44227f1077d58bf591c7bd449f41174` |
| sbom.cdx.json | 81352 | `93002f3f0cb84773b6f376e54bc54294043744571a1678cb22c8651d97331149` |
| SHA256SUMS.txt | 106 | `603afd357b3c7aa35d3a9e2f79ed12a2ad861383d30f1553b9eff872662a22e4` |
| Star-Picking-Pavilion-Setup-0.2.13.exe | 99580204 | `e5264dc3ac9d586fc7a37c0111a54b169b4b970926cd11b5c0ce64d7d270cfa2` |
| Star-Picking-Pavilion-Setup-0.2.13.exe.blockmap | 105990 | `1491d4eb239aeba440296b7d0b3b44c5f2c89b7ff466c6ee147372c0881f53b9` |
| THIRD_PARTY_NOTICES.txt | 6347 | `6e76ef9ba1d64f1b5de01dc3f859b0574dd39909818e3c25941985c3f45ee86e` |

公开 Release 正文、本版内置记录与 RELEASE_NOTES.md 一致。发布后按原应用服务、默认超时和匿名实网请求成功同步全部 41 条正式记录，本版发布时间更新为 2026-10-06T07:21:35.000Z；新缓存保存成功，离线重建服务恢复的全部记录及 lastSyncedAt 逐项一致。实网与离线验证无本轮失败。

下载核验首轮在第三方声明逐字节对比本地工作树时失败：发布附件为 6,347 B，本地为 6,387 B。对照发布 tag 的 Git 对象并统一 CRLF／LF 后，正文及标准化 SHA-256 完全相同，差异只在行尾。校验工具改为按 tag 内容比较行尾规范化后的正文；全部六附件的原始字节、尺寸与 GitHub SHA-256 摘要依然逐项校验。首轮输出保存在 published-assets.log，后续为 published-assets-verified.log，行尾证据为下载目录中的 notice-line-ending.verification.json。未修改或覆盖任何正式附件。

证据为 work/v0213/{branch,main,release}-ci.{json,log,verified.json}、publication-refs.json、published.verification.json、隔离下载目录中的 release.json、latest-release.json、verification.json、pe-metadata.json，以及 published-sync.verification.json。收尾提交仅更新文档和状态，生产文件、测试、版本、发布说明及内置历史保持 tag 内容。
