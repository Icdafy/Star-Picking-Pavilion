# v0.2.41 验证记录 · 静态 Logo 统一更新

## 范围与原因

- 本版按用户要求将静态图标统一为本次上传的原始 PNG，保留白色圆角底、金色星星与紫色弧线。桌面快捷方式、任务栏、应用窗口、托盘、系统更新通知、安装器、卸载器、网页页签和系统更新页均在范围内。
- 唯一保留项为主页面左上角 Logo：`renderer/logo.svg` 的原有动效和 `renderer/logo-still.svg` 首帧回退图保持原样，主题适配及悬停播放行为保持不变。
- 静态 Windows 图标生成链以上传 PNG 为源，多尺寸 ICO 的一致性继续接受构建及实际 PE 资源校验。
- 版本统一为 0.2.41；不调整依赖、用户数据、采集或分析业务。

## 验证状态

v0.2.41 已正式发布，独立 main CI、tag Release 及六项公开附件重新下载复核均已完成。

| 项目 | 状态 |
| --- | --- |
| 上传原始 PNG 与仓库静态源一致 | 原文件逐字节复制；1254 × 1254，1,741,335 B，SHA-256 `a6f35181efefa063fb674ad5b7a31c3c825765f5d29a635136c7309a394dab21` |
| 左上角 SVG 动效及首帧回退图与上版完全相同 | `logo.svg`、`logo-still.svg`、`dom-utils.js` 与品牌 CSS 对 v0.2.40 无差异 |
| 单元与集成 | 1165 / 1165 通过 |
| 真实 Electron 与静态更新页图标 | 首轮 38 / 42；四项失败在代码和测试均不改动的单独复验中 4 / 4 通过。原 Logo 动效及新静态图标两项均首轮通过，浅深主题截图已目检 |
| 依赖审计与第三方声明 | 生产依赖与完整工具链均为 0 漏洞；47 项第三方声明 |
| 图标生成与多尺寸 ICO 一致性 | 四项图标测试及生成器 `--check` 通过，覆盖七种 ICO 尺寸的像素与透明度、PNG 不改写、动画资源独立及旧派生图拒绝 |
| 实网信源巡检 | 201 个：199 有内容、2 空结果、0 请求失败、0 跳过；严格模式因空结果未通过 |
| 构建、包边界、PE 图标及版本元数据 | 1303 项 ASAR 条目通过；应用 EXE、更新安装器七尺寸与 ICO 逐帧匹配，托盘/通知文件字节一致；本地安装器 101,884,380 B，ASAR 15,864,756 B，产品/文件/更新版本 0.2.41，NotSigned |
| main CI 与一次性 Windows 安装/卸载烟测 | 精确提交 `f1380c955e27ced0293b3402db704c488707f865` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39033079909) 全部通过：1165 / 1165 单元与集成、42 / 42 真实 Electron、两项依赖审计、图标一致性、1303 项包边界、一次性 Windows 安装/启动/单实例/退出/卸载烟测 |
| tag Release 工作流与六项公开附件复核 | `v0.2.41` 指向同一精确提交，[Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/39034000227) 全部通过：1165 / 1165 单元与集成、42 / 42 真实 Electron、依赖审计、构建、版本、包边界与安装卸载烟测；六项附件已下载复核 |

## 限制

- 本地首轮四项失败分别是 `layout.test.js:157` 点击已激活设置页等待稳定超时、`v0210-motion.test.js:286` 恢复窗口后等待焦点超时、`v0230-update.test.js:129` 悬停透明度未及时变化，以及 `v0231-pointer.test.js:117` 滚动控件等待稳定超时。四项单独串行复验均通过，未修改产品或断言；尚未确认首次失败根因，不将焦点或指针干扰写成确定事实。原始日志为被忽略的 `work/v0241/e2e.log` 与 `e2e-recheck.log`，独立 Windows CI 结果另列。
- 信源巡检的两个空检索结果为“东财检索·迅蚁科技”“东财检索·九天微星”；原始结果保存在被忽略的 `work/v0241/sources.json`。本版不更改采集逻辑，该情况单独披露，不计为严格审计通过。
- 安装包继续采用已接受的未签名策略，预期签名状态为 `NotSigned`；Windows SmartScreen 可能提示未知发布者，README 与发布说明保留校验指引。
- 正在运行的旧版本仍读取旧包资源，安装并重启新版后才使用新图标。Windows 可能缓存桌面或任务栏图标。
- 安装、启动、单实例、退出和卸载烟测仅在一次性 Windows CI 进行；本机不运行安装器。

## 正式发布与附件复核

[v0.2.41](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.41) 于 2026-10-17 21:00:11（北京时间）发布为最新正式版，非 draft、非 prerelease。main 与 tag Release 均验证精确提交 `f1380c955e27ced0293b3402db704c488707f865`，工作流生成并上传了以下六项资产：

- `Star-Picking-Pavilion-Setup-0.2.41.exe`
- `Star-Picking-Pavilion-Setup-0.2.41.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

六项公开附件均已重新下载，文件尺寸及 SHA-256 与 GitHub 提供的摘要逐项一致。正式安装器为 101,881,789 B，产品版本和文件版本均为 0.2.41，签名状态为 NotSigned；SHA-256 为 `c7fc411e01a196f5f96c898f15540d8155eefe021fa16bb5775b72ef2a479bbe`，与 SHA256SUMS.txt 一致。latest.yml 的版本、两处文件名、文件尺寸及两处 SHA-512 均与安装器相符；实际安装器的七种尺寸图标帧与当前 ICO 完全相同。SBOM 为 CycloneDX 1.6，根版本为 0.2.41，包含实际 Electron 42.11.11；第三方声明及发布正文与本版源码一致。

元数据、六项附件、PE 检查与复核结果分别保存在被忽略的 `work/v0241/published.json`、`published/`、`published-pe.json`、`published-verification.json`。复核脚本为 `work/v0241/verify-release.cjs`；main 与 Release 原始日志为同目录的 `main-ci-success.log`、`release-success.log`。
