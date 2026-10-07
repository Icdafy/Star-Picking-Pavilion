# v0.2.29 验证记录

日期：2026-10-07（北京时间）。本版修复设置中“存储治理”与“每日新闻资料库”的左上角光晕，统一西文、数字与符号字体覆盖。

## 原因与修复

两张卡片的专属 `::before` 将普通 `.glass::before` 的 2px 顶部高光改为 15rem／18rem 圆环，同时保留后者的 `left: 3%` 和 `--glass-specular` 背景。`left`、`right` 与固定宽度同时存在时，左侧定位仍生效，圆环和多层扩散阴影因而出现在左上角，两个主题都有问题。本版删除两处专属伪元素规则，恢复普通设置卡片的共同背景、顶部高光与玻璃材质。

主界面的原有字体栈已将 Times New Roman 放在首位，但原生表单与代码标签的浏览器默认字体不会继承 `body`，两张恢复页面还单独写死微软雅黑 UI。本机修复前实测：普通控件为 Arial，日期输入为默认等宽字体，恢复页面西文为 Microsoft YaHei UI。

本版将字体令牌集中到 `renderer/typography.css`，供主界面、页面恢复和通过本机文件加载的后端启动失败页面共用；显式覆盖表单、选项、代码与快捷键标签的字体，保留组件字号、字重及原生编辑行为。中文继续使用内置思源黑体。Times New Roman 不包含的汉字、全角中文标点与特殊字形按字体栈回退，不替换正文，也不分发系统字体文件。

## 验证

新增真实 Electron 检查覆盖两种主题、氛围开关与四档缩放，直接比较两张卡片与普通设置卡片的背景及伪元素；逐一检查十个主视图的有效字体，并通过 Chromium 实际字形来源核验西文、数字、常用符号、粗体、斜体、表单内部文字、代码、快捷键和恢复页面。

| 检查 | 本机结果 |
| --- | --- |
| 完整单元与集成 | 1029／1029，零失败、零跳过，19.12 秒 |
| 完整真实 Electron 桌面矩阵 | 33／33，零失败、零跳过，356.89 秒 |
| 新增真实 Electron 检查 | 2／2，17.86 秒；16 组卡片材质组合、十个主视图、15 类实际西文／数字／符号样本及两张恢复页面全部通过 |
| 生产依赖审计 | 0 漏洞，无新增依赖 |
| 内置日志与声明 | 57 份版本说明，当前正文一致；47 项依赖声明 |
| 本机包边界与源码 | 1292 项 ASAR 路径通过；24 个关键文件与源码相符，内置字体表齐全 |
| 本机版本与签名 | 应用、安装器 PE 和 latest.yml 均为 0.2.29；NotSigned |

本机候选 `app.asar` 为 14,930,542 B，安装器为 100,454,001 B，安装器 SHA-256 为 `f61ccf9bb38ece37238d6d82a61b7be69d5de3d2bbd926f1a4caff03ee1e7a54`。这是本机候选摘要；正式资产由 Windows CI 构建，需从公开链接另行下载核验。

新增检查首轮使用了不存在的氛围开关选择器；改为真实 `setAquaEnabled` 按钮与 `aria-pressed` 状态后 2／2 通过，产品代码及断言未放宽。修复前字形来源、两主题截图、16 组材质数据和最终字形来源保存在被忽略的 `work/v0229/`。

额外实网信源审计首轮 199／201：国家航天局官网一次 `fetch failed`，东财“穿越者”检索返回空结果。完整复核为 200／201、零网络失败、零跳过；该检索仍为空，严格审计按既有规则返回 1。这两次结果保存在 `source-audit.log` 与 `source-audit-retry.json`，不能表述为严格审计通过。本版现有 main／Release 工作流继续执行全部既定门禁。

本机不运行安装器，安装、启动、单实例、退出与卸载烟测由一次性 Windows CI 执行。

## main CI 与正式发布

精确提交 `8df9e2c73a75b641e7946d1a352ae966a23525dc` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37610699762) 和 [tag Release](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37611994911) 全部通过。main 为 1029／1029 单元与集成（31.07 秒）、33／33 真实 Electron（485.88 秒）；Release 独立再验 1029／1029（41.84 秒）和 33／33（418.94 秒），均零失败、零跳过。版本检查、生产依赖审计、声明、构建、包边界及一次性 Windows 安装／启动／单实例／退出／卸载均通过；Release 另通过摘要与 CycloneDX 验证。

注释标签 `v0.2.29` 指向上述提交；发布完成后的收尾仅补齐验证文档，保留已发布标签与资产。

## 公开下载复核

[摘星阁 v0.2.29](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.29) 于 2026-10-07 19:17:47（北京时间）公开发布，为最新正式版、非草稿、非预发布。六项附件从不带认证的公开链接重新下载，逐项比对 GitHub SHA-256、实际文件大小与安装器校验清单；正文与 `RELEASE_NOTES.md` 一致。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 374 | `cbea320a143b8c12791bc0b38978f3a657ec75fef5e2389863335601914d1c0b` |
| sbom.cdx.json | 81,352 | `9c4ec4108adbb4e834f8cfe9cbe38951e51d08a4cb9d0698428c3b46a6170498` |
| SHA256SUMS.txt | 106 | `9066a9637a0c56e3675cb4e5284ef7b5d8ad240d417b980ba89092f83c7fc3d0` |
| Star-Picking-Pavilion-Setup-0.2.29.exe | 100,451,881 | `6dc54b93ba7b17f2b7ef6b1d1d74a99740806a0ca41316c16d69c2db3304bb1d` |
| Star-Picking-Pavilion-Setup-0.2.29.exe.blockmap | 106,166 | `c57f2cc455cfefa07d5bcca648756a4a7efe674749f81fc2feb58a2b6892254c` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `c097dab26ae6ee28889c342939c74f0e721577b0fec977808dacffe5ddf5dc98` |

公开安装器的 PE 产品名称为“摘星阁”，产品／文件版本均为 `0.2.29`，签名状态为 `NotSigned`。`latest.yml` 的版本、文件名、大小和两处 SHA-512 均与实际安装器一致：`Wzxxf7/Bus7oObx4hqFyrtE089QnhKhMoOJKzQwD8fXkPp/F/38yNltZ6OhqnlBbA50gpQfMyZfyLoct5AZRcA==`。

CycloneDX 1.6 SBOM 包含 41 项生产组件，均映射到 lockfile；第三方声明与仓库相符。只读解包得到 `app.asar` 14,943,440 B，1292 项再次通过包边界与秘密检查，24 个关键文件与发布源码相符，包括共享字体表、两张恢复页面及卡片样式。核验未执行本机安装器。

公开元数据、六项下载文件、摘要结果、PE 信息与包内源码核验保存在被忽略的 `work/v0229/public-assets/` 及同级记录。
