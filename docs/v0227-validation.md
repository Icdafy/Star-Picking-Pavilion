# v0.2.27 验证记录

日期：2026-10-07（北京时间）。本版按用户要求替换软件内 Logo，默认静止，鼠标悬停时播放动效，并通过既有完整门禁发布 v0.2.27。

## 素材与行为

- 采用上传的 SVG：20,018 B，SHA-256 为 `b1129afc8f5bc94bfd8f486e340d54565797ac34084d9a74a5a4abecb40a6f80`，项目 `renderer/logo.svg` 与上传文件逐字节一致。另两份同稿 WebP 为 1,728,908 B，GIF 为 718,964 B；SVG 更轻且可直接控制动画时钟，适合本项目的 Electron 界面。
- 保留原稿全部六条 SMIL 动画轨道及 5.2 秒循环。初始加载即暂停在第一帧，鼠标只在 Logo 区域内时播放；移开立即暂停并复位，再次移入从头播放。相邻文字不触发动效。
- `renderer/logo-still.svg`（1,150 B）从原稿移除六条动画节点并调整标题、无障碍名称后生成，第一帧轮廓、配色、透明背景和变换保持；加载失败时保留该图。
- 浅色保留原稿颜色，深色以 CSS 提亮弧线；宽窄窗口均保持正方形比例。减少动态效果、窗口失焦或隐藏时恢复静态，后台不运行 SVG 时钟。
- 应用版本、Windows 产品版本、安装器、更新元数据、内置日志及第三方声明统一为 0.2.27。无新增运行依赖。

## 候选验证

Logo 专项真实 Electron 检查通过，覆盖默认静止、实际形状位移、第二轮循环、移开复位、重入、减少动态效果、隐藏窗口暂停、1440／800 像素宽度与浅色／深色，以及资源加载失败的静态回退。截图保留于 `work/v0227/screenshots/`，没有页面异常。

首轮完整单元与集成为 1022／1024，两项失败均为既有脚本数量上限：独立 Logo 控制模块令脚本数量从 27 增至 28。将 Logo 控制合入既有 DOM 动效模块后，最终完整单元与集成为 1024／1024，0 失败、0 跳过。脚本仍为 27 个，未放宽预算或测试门禁。首轮桌面矩阵因修复脚本边界而主动中止，最终源码重新完整验证。

生产依赖审计 0 漏洞，47 项第三方声明、55 条内置更新日志，本版正文与发布说明一致。无新增运行依赖。

本地候选构建、包边界及 tag／产物版本校验通过：1,289 项 ASAR 条目，app.asar 14,894,891 B，候选安装器 100,448,017 B。PE 产品／文件版本均为 0.2.27，产品名称“摘星阁”，签名状态 NotSigned。候选安装器 SHA-256 为 `fcb30b5793ec951917a74dec946599a7ad2d3e11fb8da3169fbd7106c26f7168`。

ASAR 中 SVG 原稿、静态第一帧、DOM 动效控制、应用接线、HTML 和 CSS 与最终源码逐字节一致。静态回退图的生成结果与原稿第一帧完全一致，六条轨道完整；原稿不含脚本、外链、外部图片或外来对象。

原始日志、截图和附件验证资料保存于被 Git 忽略的 `work/v0227/`。正式 main CI、tag Release、一次性 Windows 安装／启动／单实例／退出／卸载和公开附件验证已完成，结果见下文；本机未运行安装器。

首轮 [main CI 37582049292](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37582049292) 的单元与集成 1024／1024，桌面 29／30；新 Logo 用例在等待第一次悬停播放时超时。该用例未像已有动效用例一样明确设置普通动效偏好并检查窗口焦点，首次失败未采集这些状态，具体触发条件不能从旧日志确认。补齐普通动效与前台焦点的测试前置条件、增加启动和失败状态诊断；保留减少动态效果分支、全部播放断言和原超时，应用实现与门禁不变。

最终本机完整桌面矩阵 30／30、0 失败、0 跳过。补齐前置条件后 Logo 专项再次通过。

## 正式 main CI 与 tag

精确提交 `9d48edc077ec9d171382bb04b7eab903bb2060ee` 的 [main CI 37583162679](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37583162679) 全部门禁成功：1024／1024 单元与集成、30／30 真实 Electron、0 生产漏洞、47 项声明、构建与 1,289 项包边界，以及一次性 Windows 安装／启动／单实例／退出／卸载，用户数据保留。

第二轮 CI 的诊断记录显示初始 `reduced: true`、`tier: static`、窗口有焦点且可见，即 Windows CI 的系统默认启用减少动态效果。普通播放检查明确设置普通动效偏好后通过，独立减少动态效果分支继续确认静态行为。该记录与首轮超时的可能触发条件相符；首轮未记录环境状态，故不把推断当作该轮直接观测。

main CI 的 app.asar 为 14,907,489 B，候选安装器为 100,446,052 B，与本机候选分别记录。main CI 完成后才推送注释 tag v0.2.27；tag 对象 `25647488249e7ae346585e0574a012abf1f9b667` 解引用为上述精确提交。

首次 tag Release 的单元 1024／1024，桌面 29／30；Logo 检查通过。失败发生在最后一项已有 `v028-ui` 用例的清理钩子，删除一次性 profile 的 `DIPS-wal` 时返回 Windows `EBUSY`，功能断言未报错；当时没有生成或上传公开 Release。保留该轮日志，在同一提交与 tag 上重新运行完整 Release 作业，不修改应用、测试断言、超时或工作流。

[Release 37584205329](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37584205329) 第二次作业在同一精确提交上全部成功：1024／1024 单元与集成、30／30 真实 Electron、0 失败、0 跳过、0 生产漏洞、47 项声明、构建、1,289 项包边界、版本检查、一次性 Windows 安装／启动／单实例／退出／卸载、SHA-256、SBOM 与发布。安装烟测确认用户数据保留。Release app.asar 为 14,907,489 B，正式安装器为 100,446,098 B。

## 公开 Release 与附件

[v0.2.27](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.27) 于 2026-10-07T07:13:43Z（北京时间 15:13:43）发布，Release ID 为 `405482773`；非 draft、非 prerelease，最新正式版为 v0.2.27，六项附件状态均为 uploaded。公开正文与 `RELEASE_NOTES.md` 一致。

六项附件重新下载到 `work/v0227/public-assets/`，实际字节摘要与 GitHub 资产摘要全部一致：

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 374 | `8ad0fd3800316352e871059f8ccd3ac19e3d944547ee7333423642126eace988` |
| sbom.cdx.json | 81,352 | `2880206b0e183b1d3413d87fdde2403e7cac8ae632065a5695976d45c48d6963` |
| SHA256SUMS.txt | 106 | `d086cbe8e60fbc6ed4ff1d193b6e0e15d5a37e4f809ffabd580fb9e5cbaa8c62` |
| Star-Picking-Pavilion-Setup-0.2.27.exe | 100,446,098 | `1820fbd09fbff8a9acbe90496478fc30714ebf8b4384c1d9a538ae3a800aaf33` |
| Star-Picking-Pavilion-Setup-0.2.27.exe.blockmap | 106,194 | `d1168891e1164c7bbe14c80846a17ec7734b7ebaf1ff8196b07ee8040f7cc0cd` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `98548a3859713cdd6fe3ec3e369ae420446237725261750e793d689362b129f1` |

`SHA256SUMS.txt` 的安装器摘要与实际文件一致；`latest.yml` 的版本、文件名、尺寸与两处 SHA-512 均匹配实际安装器。CycloneDX 1.6 SBOM 包含 41 项生产依赖组件，不含开发依赖，第三方声明与源码声明在归一化换行后一致。

公开安装器 PE 产品／文件版本均为 0.2.27，产品名称“摘星阁”，签名状态 NotSigned。以只读方式提取其 `resources/app.asar`，SVG 原稿与静态第一帧逐字节匹配源码，原始六条动画轨道完整；DOM 动效控制、应用接线、HTML 和 CSS 在归一化 Git 换行后与发布源码一致，未在本机执行安装器。

应用更新日志匿名实网同步于 2026-10-07T07:17:16.884Z 成功：55 条正式版本记录，最新 v0.2.27，正文和发布时间与公开 Release 一致；随后离线缓存恢复通过。

正式证据包括 `main-ci-final.log`、`main-ci-verified.json`、`release-ci-first.log`、`release-ci-final.log`、`release-ci-verified.json`、`public-verification.json`、`public-pe-verification.json`、`public-packaged-logo.json` 和 `release-sync-verification.json`，均保存在 `work/v0227/`。
