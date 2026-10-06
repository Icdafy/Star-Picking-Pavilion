# v0.2.13 发布状态

候选已实现工作区八个页头横幅、文字与星轨动效、情报日志统一工具栏及其下方独立报告概况。版本和发布说明、41 条内置日志及第三方声明已同步为 0.2.13。完整本地回归为 892／892 单元、21／21 真实 Electron（160 布局组合），无失败、取消或跳过；36 张双主题／宽窄截图已复核。生产依赖审计 0 漏洞。

本地 Windows 候选包构建及 1273 包边界通过，十二项生产文件与 ASAR 逐字节一致，PE／包内／更新版本均为 0.2.13、NotSigned。ASAR 13,590,704 B，安装器 99,582,467 B，SHA-256 为 `22fed2504ac3bc112d8d593f78d6fe0aaf045671b6aac623b1f942b75542ffac`。即将进入既有 CI／tag 发布门禁，尚未创建正式 Release。本机不运行安装器。实网信源 183／186 返回内容，1 空、2 请求失败，未修改采集逻辑，具体证据与发布状态见 [docs/v0213-validation.md](docs/v0213-validation.md)。

分支 CI 首轮单元 892 全过、桌面 20／21，新横幅测试未观察到标题位移，后续发布门禁未执行。测试改为原生 click 边界采样、明确 no-preference 场景和真实焦点，产品实现及原断言不变；本地专项采到 73 帧／58 个不同位置并通过。正在以修正后的测试重跑完整 CI，失败日志与原因未确定的事实继续保留。

---

# v0.2.12 发布状态

[v0.2.12](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.12) 已作为最新正式版发布。四项需求已完成：工作区按十项顺序排列，更新日志收录 39 个历史正式版本及本版并自动同步，分类再次点击取消且清理选择块，设置九章快捷目录支持定位、滚动高亮、键盘及宽窄窗口。

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37419711923) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37420427051/attempts/2) 对产品提交 `e8c5ca1d99efccae32c3de34c73c58c00ad728c8` 最终全部通过：892／892 单元、20／20 真实桌面（128 布局组合）、0 生产漏洞、47 项声明与 1273 包边界；一次性 Windows 安装、启动、单实例、退出和卸载成功，用户数据保留。

六项正式附件已重新下载，尺寸与 GitHub SHA-256 摘要全部匹配。安装器 99,577,316 B，PE 产品／文件版本 0.2.12，NotSigned，SHA-256 为 `c561619a7ad8691e4b22cf501c78f963eda0ee5d1608b654f4447f312482d92b`；更新元数据、SBOM、第三方声明及 Release／应用内本版正文一致，发布后实网同步与离线缓存恢复通过。

无发布阻塞。实网信源复查 184／186 返回内容，东财检索·穿越者为空、泰伯网·空天资讯请求失败，本次未更改信源或采集逻辑。完整证据见 [docs/v0212-validation.md](docs/v0212-validation.md)。

Release 首轮为 19／20 桌面通过，旧卡片光效的瞬态差值断言失败；原样本地动效复查 5／5，原因未定位。正式门禁第 2 次完整执行通过，失败日志继续保留，没有修改光效实现、阈值、超时或验收门禁；后续通过不代表首轮根因已修复。

---

# v0.2.11 发布状态

无发布阻塞。[v0.2.11](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.11) 已作为最新正式版发布；分层卡片追光、局部边缘高光、按钮磁吸光晕与带速度衔接的选择弹簧已接入双主题、减少动画、低功耗和生命周期清理。冷启动写入已合并为原子批次，并通过回滚／重试验证，原握手上限保留。

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37412899916) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37413400871) 均完整通过：886／886 单元、19／19 真实桌面（112 布局组合）、0 生产漏洞、47 项声明和 1271 包边界，fail／cancelled／skip／todo 为 0。一次性 Windows 安装、启动、单实例、退出与卸载成功，用户数据保留。

六项正式附件重新下载核验，尺寸与 GitHub SHA-256 摘要全部匹配。正式安装器 99,544,789 B，PE 产品／文件版本 0.2.11，签名 NotSigned；SHA-256 为 914b5a02ce5a88e0e79a51a0c439255bb3025567ba991df7f01b5a67d8951392。latest.yml 的版本、文件名、尺寸及两处 SHA-512 均与实际安装器匹配，SBOM 为 CycloneDX 1.6、产品 0.2.11，第三方声明与提交一致。 完整记录及此前失败见 [docs/v0211-validation.md](docs/v0211-validation.md)。

---

# v0.2.10 发布状态

无发布阻塞。[v0.2.10](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.10) 已作为最新正式版发布；版本徽标自动读取应用版本，导航／筛选连续改向、触压光波与卡片追光已接入减少动画、低功耗和生命周期清理。

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37344672306) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37345837754) 均完整通过：881／881 单元、17／17 真实桌面（112 布局组合）、0 生产漏洞、47 项声明和 1271 包边界，fail／cancelled／skip／todo 为 0。一次性 Windows 安装、启动、单实例、退出与卸载检查成功，用户数据保留。

六项正式附件重新下载核验，尺寸与 GitHub SHA-256 摘要全部匹配。正式安装器 99,543,243 B，PE 产品／文件版本 0.2.10，签名 NotSigned；SHA-256 为 `a678eadbe6cb2d9c5006ba403c2419dc115adbfbf52e59a829cf2a4fee0fe946`。latest.yml 的版本、文件名、尺寸及两处 SHA-512 均与实际安装器匹配，SBOM 为 CycloneDX 1.6、产品 0.2.10，第三方声明与提交一致。 完整记录及此前失败见 [docs/v0210-validation.md](docs/v0210-validation.md)。

---

# v0.2.9 当前状态

标题栏已延展至窗口右边，正文在标题栏下方独立滚动；已清理 35 个信源入口，保留 186 个且严格复查全有内容、0 空结果、0 失败。旧库升级移除停用入口，保留历史文章及来源归属。最新正式版 [v0.2.9](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.9) 已发布：精确提交 `a3c8152a8b6a957963b4190d1c2e686d2299b10d` 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37328372503) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37329530254) 首次执行全部通过，均为 876 单元、14 桌面（112 布局）、0 漏洞、1271 包边界；一次性 Windows 安装／启动／单实例／退出／卸载成功，用户数据保留。六项正式附件重新下载校验一致，安装器 99,540,524 B、PE 版本 0.2.9、NotSigned，更新元数据匹配。详见 [验证记录](docs/v029-validation.md)。

---

# v0.2.8 历史状态

新用户原始设置与主题滚动条已实现并发布为最新正式版 [v0.2.8](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.8)。用户授权按本机配置设定默认值；只提取公开设置，已有用户配置优先。精确提交 `befc8a4c77c2381fd86cd24416c6d21f127aa9e6` 的 main CI 与 Release 全部成功：874/874 单元、14/14 真实桌面、生产审计 0 漏洞、1270 项包边界和一次性 Windows 安装／卸载检查通过，用户数据保留。六项附件已在新目录下载，GitHub 摘要、校验文件、PE 版本及更新元数据全部匹配。在线信源严格复查为 40 成功、150 失败，东财接口空响应及旧启动退出风险如实保留。证据见 [docs/v028-validation.md](docs/v028-validation.md)。下方保留历史版本记录。

---

# v0.2.7 执行进度

## 当前交付状态（2026-10-05）

用户最后明确取消按原任务书继续执行，要求直接推送本地v0.2.7并更新GitHub Releases。执行范围据此改为直接完成发布；当时在运行的既有release工作流随后成功，采用其已生成的同版本资产，没有追加实现或验收轮次。

正式[Release v0.2.7](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.7)已发布，当时为最新正式版，draft=false、prerelease=false。注释tag对象c313093672c44642a51e9f0b25f968dd5fc85f61解引用为`9a3ca396011409c482cb36f17c8aad8ca4ec442d`；该SHA的[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37303971624/attempts/2)与[release](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37307161572/attempts/3)全部成功。Release第三次完整执行9m31s，869/869单元、12/12桌面、fail/cancelled/skip/todo0；审计0、47项声明零差异、1270项包边界、一次性Windows安装/启动/单实例/关闭/卸载成功，用户数据保留。

六项正式资产已下载到新隔离目录`F:\摘星阁\work\v027\release-download-20261005T123712739-af43c12b\assets`，文件尺寸与GitHub SHA-256摘要全部匹配。安装器`Star-Picking-Pavilion-Setup-0.2.7.exe`为99541227字节，SHA-256为`bc1faf325fa6980c4c64b3f62c0afee06d363f81cf4666c6947fb6a03dc75610`，与SHA256SUMS.txt一致；PE文件/产品版本0.2.7、NotSigned，latest.yml的版本/文件名/尺寸/实际SHA-512匹配。SBOM为CycloneDX1.6、41个组件，既有工作流Schema验证成功；第三方声明与注释tag内容一致。

原始结果：work/v027/v027-release-attempt3.log/result.json/verified.json、v027-main-ci-3-debug.log/result.json/verified.json、v027-release-download-result.json与fresh目录中的release/latest/CI/PE元数据和verification.log。收尾提交只补发布记录与说明，产品、版本及验收内容与发布tag一致。

- [x] 六条交互链、本地0.2.7版本和候选包、869/12本地回归已完成。
- [x] 三件参考作品实际体验及六链双主题/双尺寸连续帧证据完成；compare-v2.html包含前后4096/4063实际呈现帧。
- [x] 同机真实前台full三次导航P95中位13.9→7.4ms、长任务0→0，静态预算与降载/焦点/阅读位置检查完成。
- [x] main/tag推送、正式Release六资产上传、新目录下载校验和最新正式版确认完成。
- [x] 无发布硬阻塞。保留风险：一次本地恢复动画即时观测失败及多次Windows CI旧测试首窗口前进程退出，原因未定位；本地原样诊断未复现，最终main与release完整验证均通过。所有原始失败与成功分别留存，后续通过不等于根因修复。启动诊断提案仅在work/v027/，未应用到旧测试。

## 续跑及发布过程记录（以下为当时状态）

### 发布执行阶段记录

- 发布第二次验收失败：[37307161572 / attempt2](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37307161572/attempts/2)，6m55s；精确SHA9a3ca39、869单元通过、桌面11/12、fail1/skip/todo0，旧v021在firstWindow前Target closed（16.06s），external-ingest本次通过，原112布局与新4项通过。后续全部发布门禁未执行，没有Release/资产；v027-release-attempt2-failed.log/result.json/watch.log完整保留。Actions调试日志仍未提供旧测试的进程stderr，原因未定位；将对原tag/同一SHA做第三次完整验收，若再失败按任务书停止该验收并如实未完成。
- 原样本地外部导入诊断通过：仅开启Playwright现有pw:browser日志，`node --test test/e2e/external-ingest.test.js`为1/1、fail/cancelled/skip/todo0、10.36s；实际子进程正常退出0，v027-release-external-ingest-diagnostic.log保留。未修改旧测试、被测功能或超时；未复现CI退出，原因未定位。将对同一tag/精确SHA以Actions调试日志执行第二次完整release验收。
- 发布首次验收失败：[release37307161572 / attempt1](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37307161572/attempts/1)、精确SHA9a3ca39，7m30s。869单元通过、桌面10/12、fail2/skip/todo0；原有external-ingest与v021均在app.firstWindow前进程关闭，原112布局、新4项和v024通过。后续审计/构建/安装/SBOM/发布全部未运行，没有Release或资产。v027-release-failed.log/result.json/watch.log保留。两次main启动失败和这次release原因仍未定位；不修改旧测试/启动超时或绕门禁。补做原样外部导入诊断后，对同一tag开启Actions调试日志完整复验。
- [x] 精确SHA9a3ca39通过main CI后已推注释tag v0.2.7：tag对象c313093672c44642a51e9f0b25f968dd5fc85f61，解引用为9a3ca396011409c482cb36f17c8aad8ca4ec442d，远端已核对。既有[release run37307161572](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37307161572)由tag push触发，精确headSha匹配，正在执行完整门禁；未手动创建Release，正式发布及六资产核验仍待成功。
- [x] 最终main精确SHA9a3ca396011409c482cb36f17c8aad8ca4ec442d的第三次完整验证通过：[run37303971624 / attempt2](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37303971624/attempts/2)，8m18s；869/869单元、12/12桌面、fail/cancelled/skip/todo0，原112布局与新4项通过；审计0、47项声明零差异、构建、1270包边界和一次性Windows安装/启动/单实例/关闭/卸载通过，用户数据保留。v027-main-ci-3-debug.log/result.json/verified.json直接核验。未改产品、旧测试、超时、工作流或判据；两次启动失败原因仍未定位，历史原始输出继续保留。注释tag及release/下载核验待执行。
- main第二次CI历史失败：提交9a3ca396011409c482cb36f17c8aad8ca4ec442d、run37303971624/attempt1，869单元通过、桌面11/12、fail1/skip/todo0。此次旧v021通过，旧v024-ui在app.firstWindow前报相同Target page/context/browser closed；原112布局和新增4项通过。后续门禁未执行，原始v027-main-ci-2-failed.log/result.json保留。原样本地`node --test test/e2e/v024-ui.test.js`为1/1通过、fail/cancelled/skip/todo0，7.74s；日志v027-main-v024-diagnostic.log。两个失败CI和已通过开发分支CI使用相同runner镜像，原因仍未定位，不将本地通过当作修复。第三次同一SHA启用Actions调试日志完整复跑已成功，见上述最终结果；不改旧测试、启动超时、工作流或验收判据。
- 正式main首次CI失败：提交65b3f8d9eaafc7fcf9f66a3500945332286baa7b、run37302344612，869单元通过、桌面11/12、skip/todo0。原有v021-ui在app.firstWindow前报Target page/context/browser closed；原112布局与新增4项全部通过。后续审计/构建/安装门禁未执行，没有推tag。原始v027-main-ci-failed.log/result.json保留；产品/测试/构建相对已通过CI的5e04d43零差异。原因未定位，按原样诊断后以包含失败记录的最终main提交重新执行完整CI，不能用旧成功替代。
- 原样本地诊断`node --test test/e2e/v021-ui.test.js`为1/1通过、fail/skip/todo0，原始v027-main-v021-diagnostic.log保留。没有修改该只读旧测试、启动程序、超时或CI流程；本地未复现不等于已定位或修复，后续完整main CI必须直接通过。
- [x] 技术候选5e04d436c940a45fadbec0346ac15a0759d4e320已推指定开发分支，现有CI [37292639190](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37292639190)全部成功：869单元、12桌面（原112布局组合）、fail/skip/todo均0；生产审计0、47项声明零差异、构建、1270项包边界、一次性Windows安装/启动/单实例/关闭/卸载通过，用户数据标记保留。原始v027-final-ci.log/result.json/watch.log齐全，10m12s。CI ASAR13,399,011B、安装器99,541,227B；本地与CI分别记录，不混用产物。
- [x] 最新本地全部命令通过，冻结full性能三次导航中位7.4ms≤15.29且≤20、长任务0/0/0，闲置7.1ms；真实原生与页面前台。当前本地未签名包0.2.7、SHA256=8bb0a04be11f250d27dcee7c2c6b2f0050efe84f721aead357b39d3ba73ebfeb，UI桥与更新元数据一致；不是正式Release资产。
- [x] 同数据六链前后各52段连续呈现帧回放4096/4063帧，另补阅读通知四组合8截图，滚动600→600、焦点保留、工具栏避让、点击命中；静态预算293065/299008、脚本27/27、关键帧20/20、滤镜护栏9/10，源码边界审计通过。
- [x] 参考作品实际体验3/3：Codex浏览器实际操作Linear导航展开/Esc关闭/入口归焦、Rauno Flashlight Tabs的Deployments→Home局部选中切换、Lusion动态3D与菜单展开/关闭；实际截图及页面状态确认，访问日期2026-10-05。docs/v027-motion-plan.md逐项记录链接、触发—运动—反馈、具体实现映射及观测限制；未复制品牌/素材/代码，没有虚构作品时长。早前URL识别停止记录保留，没有绕过检查。
- [ ] 正式发布执行中：最终main精确SHA9a3ca39的完整CI已通过，其注释tag已推、既有release run37307161572进行中；产品与验收相对5e04d43不变。工作流全部成功后下载核验六资产，推tag本身不算发布成功。
- 风险保留：一次本地恢复后即时动画断言失败未复现；三次真实状态诊断、本地完整复跑和当前WindowsCI均绿，不据此声称已定位原因。最初CI10/12、delta59→0以及无效失焦性能记录均保留，没有放宽或静默重试。
- CI后产品与验收文件未再变动；本次补齐参考体验并整理正式发布文档，最终main发布前须验证包含这些文档的精确SHA。早前报告文档提交7890bf4保留。
- [x] 发布准备文档8/8通过，fail/skip/todo0；47项声明再生成零差异，v0.2.7 artifact版本一致；相对5e04d43产品/测试/构建/版本/声明Git差异0。日志v027-publication-{document-gates,notices,version}.log。此前收尾32路径/凭证模式0审计记录保留，当前提交对象审计随后执行。

### 本轮过程记录（以下由新到旧，待办表述为当时状态）

- 开发分支CI run37292639190、精确SHA5e04d436c940a45fadbec0346ac15a0759d4e320：单元、真实桌面、生产审计、声明门禁已全部成功，目前构建安装器；包边界和一次性安装/启动/单实例/卸载待完成。
- 候选已提交并推指定分支：5e04d436c940a45fadbec0346ac15a0759d4e320，现有CI run37292639190进行中。审计仍32个授权路径、package/lock仅版本、4个旧测试逐字版本替换、凭证模式0、无用户数据/二进制；v027-final-commit-audit.log。当前静态预算CSS293065≤299008、脚本27/27、关键帧20/20、滤镜护栏9/10。尚未推main/tag/Release。
- 最新渲染诊断：Layout中位总成本199.131→170.986ms、Paint130.187→132.524ms、Style516.719→412.501ms；CPU4单次lite P95229→138.7ms/长任务28→23，static104.1→41.6ms/长任务19→6，有限动画0。绘制小幅增加、附加诊断不适用full20ms阈值，不宣称所有成本或所有慢设备改善；旧混合结果仍保留。
- [x] 最新冻结性能口径完整三次通过：闲置7.1/7.2/7.1ms，中位7.1≤7.92；导航8.2/7.2/7.4ms，中位7.4≤15.29且≤20；长任务0/0/0。原生每50ms、页面逐帧真实前台全成立，full/1440×920/DPR1/144Hz/同90样本。v027-final-measure-foreground.log、after-v2/；首次失焦无效目录after-v2-invalid-focus-1/和日志保留，不关闭断言。
- 最新性能重测首次退出1：原生50ms轮询发现测试窗口失焦，整次无效，未产生三次中位数。v027-final-measure.log保留；不把旧通过样本冒充最新结果、不关闭焦点断言。待原样重测，避免采样期间其他操作。
- [x] 当前包重建成功：1270项ASAR，13,389,299B；安装器99,542,963B，PE文件/产品0.2.7、NotSigned、SHA256=8bb0a04be11f250d27dcee7c2c6b2f0050efe84f721aead357b39d3ba73ebfeb。界面桥0.2.7与latest.yml真实SHA512/版本/文件名/尺寸匹配；8项文档发布断言绿。v027-final-{dist,package,artifact-version,installer,ui-and-update-version,document-gates}证据齐全，没有本机安装烟测。
- 对最新CSS再跑冻结full性能口径；此前通过样本完整移动封存after-v2-pre-reading-fix/，不会覆盖旧结果或改变20ms/110%/长任务阈值。
- [x] 当前完整桌面12/12、单元869/869绿，fail/skip/todo均0：v027-final-e2e-observed.log、v027-final-unit-visible.log；生产审计0、47项声明重复生成Git差异0。上次11/12失败仍保留，独立诊断与本次绿不等同已定位原因。
- [x] 新通知四组合取证全部通过：scrollY600→600、焦点保持、通知在工具栏下约8px、实际点击命中newFlash、背景图层有效、无横向溢出；实际截图文字与控件可读。evidence/reading-banner-visible/observations.json与v027-reading-banner-visible.log；遮挡的旧截图不覆盖。正在重新打包。
- 最新完整回归首次11/12：阅读位置和确认取消绿，恢复后即时动画断言一次失败，原始日志v027-final-e2e.log保留。两次原速及一次4倍CPU的真实状态诊断均full/前台/260ms运行中，尚未复现，不声称已定位；验收仅增加失败时的档位、焦点与动画诊断文本，原运行中判据不变。完整回归正在再验证。
- 阅读通知双主题双尺寸的实际截图与坐标取证均600→600、焦点保持；截图发现旧定位被粘顶工具栏遮挡，已复用--stack-top并修正背景图层，新增工具栏避让/点击命中取证待完成。原截图保留在evidence/reading-banner/。
- 首次指定开发分支CI d735815/run37287385385：869单元通过，12桌面中10通过，原8均通过；新确认取消返回null时观测过早、新阅读位置delta未通过，后续打包/安装烟测未执行。日志v027-ci-failed.log，未推main/tag。
- 4倍CPU/4核心实际诊断复现阅读600→659，字体loaded、焦点保留、通知显示；通知的59px流内高度触发滚动锚定。改成不占高度的sticky通知后600→600、delta0、焦点和通知均正确，诊断2/2绿。确认验收等待关闭后的Promise结果再按原false判据判断，不改变超时、滚动阈值或焦点要求；旧协议2封存，新哈希见协议文档。完整回归、候选重打包和CI待复跑。
- [x] 提交审计通过：相对bcf9beb共32个路径在原/续跑授权范围，包与lock仅版本字段变动，4个旧测试逐字等于版本替换，release-readiness保留原断言并增加说明检查；凭证模式0，无用户数据/二进制/日志。只推进指定开发分支的现有CI，main/tag/Release仍等参考作品体验完成。
- [x] 六链连续呈现帧完成：前后各52段，4096/4063帧，双主题双尺寸；compare-v2.html可按时间播放和逐帧对照，实际起始主题匹配。字体/控件抽查可读；不自评审美。界面桥0.2.7、安装器SHA512和latest.yml一致也已实测。
- 渲染/降载诊断照实披露：Layout中位总成本199.131→219.444ms，4倍CPU单次lite P95 229→270.9ms；Paint/Style及static P95下降，但不同指标不一律改善。full档明确数值门槛通过；详见报告，不推广成本下降或慢CPU流畅结论。
- [x] 本地v0.2.7包已构建并通过1270项ASAR边界检查与artifact版本校验：ASAR13,389,031B，安装器99,542,996B，PE文件/产品号0.2.7，签名NotSigned，SHA256=0e0463eb865484f6c94782ee2c86827aa29b634a2e8d4b24550104e5bb2ce5f8。latest.yml版本/路径/尺寸一致；本机没有运行安装烟测或伪设CI=true。日志v027-{dist,package,artifact-version}.log与v027-installer.json。
- [x] v0.2.7完整单元/集成869/869通过、fail/skip/todo均0；首次升级868/1的导出版本断言已按同样目标版本纠正，红日志 v027-unit.log / 绿日志 v027-unit-green.log。没有修改导出功能实现。
- [x] v0.2.7完整桌面回归12/12、fail/skip/todo均0，原8项和新增4项均绿，原112布局组合通过。真实隐藏/恢复和外观关闭持久化完整链已验证。生产审计0漏洞；声明保存后再生成Git差异0；v0.2.7版本校验通过。
- [x] 协议2性能通过：布局顺序调整后导航8.7/7.6/13.9ms，中位8.7ms（旧代码13.9ms，上限15.29ms），长任务0/0/0；闲置中位7.1ms。真实前台与同样本/窗口/显示器断言全部成立。失败的首轮协议2样本保存在 after-v2-pre-layout-fix/，日志 v2-after-measure.log；绿样本 after-v2/ 与 v2-after-layout-measure.log。
- [x] 版本字段升为0.2.7并生成47项声明，只有产品版本头变化。锁定旧版本还涉及branding/package-verifier/export-markdown/starred的版本断言，均只改目标版本，既有测试数量与行为判据不变；release-readiness保留历史断言并增加新说明检查。
- [x] 协议2在封存原代码4项红测全部复现；候选前三项及独立隐藏/恢复项绿。真实前台旧代码三次性能完成：闲置7.2ms、导航13.9ms、长任务中位0；见 docs/v027-protocol-2.md，下一步按完全相同口径验证候选。
- 用户在“需允许版本测试/声明更新、纠正验收环境口径并增加验证轮次”的报告后明确回复“继续”。按这项续跑指令执行上述必要调整；下文三轮停止及未授权记录是历史状态，保留原失败证据。
- 扩展仅涉及旧发布测试的目标版本、生成的第三方声明、新验收的颜色大小写及真实窗口环境；原 865/8 项测试不减少，20ms/110%/长任务不增加门槛、依赖与发布工作流不变。
- 新环境口径将以公开 connectOverCDP({ noDefaults: true }) 接入真实隔离 Electron，消除 Playwright 的焦点模拟；先验证原生与页面焦点，再用同一 90 条样本重测旧版/候选三次。旧 frozen-1 文件与失败样本封存，不覆盖。
- 必需项全绿后才发布。真实作品体验、窗口恢复、性能、新版打包与精确 SHA CI/Release仍待完成。

## 初始目标回执（2026-10-05，修改前）
1. 完成六条交互链并经既有工作流正式发布 v0.2.7。
2. 一个 agent，最多三轮实现—验证—打磨；目前为任务 0，尚未修改实现。
3. 先核对基线与边界，再建立并冻结同机取证脚本和新增验收口径。
4. 先保留主题连点失败证据，再修复并完成其他交互。
5. 功能/数据正确 > 流畅 > 清晰 > 装饰；沿用玻璃、星空、星鲸与双主题。
6. 最大风险：CSS 余量、前台性能与生命周期取证、精确 SHA 的 CI/Release。
7. 必需验收缺失时不发布、不宣称达标；受阻项写 BLOCKED.md。

## 已完成
- 已读取目标任务书、架构、前端契约和发布指南。
- Git 工作区干净；本地 main 与远端 main 均为 bcf9beb2ca13ca73214735c103185f9de103b6af。
- 远端为 https://github.com/Icdafy/Star-Picking-Pavilion.git；本地及远端没有 v0.2.7 tag。
- 已切换到用户指定分支 codex/v0.2.7-motion；work/v027/ 已由既有 /work/ 规则忽略。
- 用户已授权公开网址策略、未签名包、通过验证后自动推送 main/tag 与正式 Release。
- 已完成三轮，最终状态为“未完成、未发布”；正式版本/本地 main/远端 main 未改。docs/v027-validation.md 已写入全部实际命令、红→绿与保留失败、轨迹汇总及证据限制。
- 续跑复核：候选提交 db7a2c69be562efe941b349852912d5add0e4d3e 已保存；远端 main/最新 Release 未变化，冻结文件未变化。逐项完成条件审计见 docs/v027-completion-audit.md；同一版本/声明边界阻塞仍在，没有开启第四轮。

## 顺序与续跑
- [x] 任务 0：基线、契约、三次前台性能与新增红测已实跑；口径及 SHA-256 记录于 docs/v027-motion-plan.md，现已冻结。
- [ ] 任务 1：真实访问至少三个作品，记录触发—运动—反馈与应用映射。
- [x] 第一轮：六条交互实现已完成；新增四项单元绿，原单元出现三项契约回退；原 8 E2E 全绿，新 E2E 两项通过、两项存在冻结脚本的环境假设错误，详见 BLOCKED.md。
- [x] 第二轮：恢复三项旧契约，补齐窗口失焦清理；869 单元全绿，但导航性能退步，原始样本保存在 work/v027/after-round2/。
- [x] 第三轮：撤回旧列表保留/立即调和，869 单元全绿；导航 P95 仍失败（中位 13.9ms、长任务中位 1）。停止新增功能打磨，只完成对照取证、负控、回放和报告；不发布。
- [x] 取证已生成：六链前后回放、双主题双尺寸、112 布局组合、同机性能与负控；性能和两项新增 E2E 仍失败，不把证据齐全等同达标。
- [ ] 发布（受阻，未执行）：候选文档已更新；版本切换、全绿门禁、本地候选包、精确 SHA CI、正式 Release/六资产与下载核验未完成。

## 证据
- 文档收尾后 npm test 再次 869 pass / 0 fail / 0 skip / 0 todo，work/v027/final-unit.log。暂存 22 个路径全在白名单，115 个旧 test 文件未改、常见凭证模式 0、无数据库/日志/二进制或用户数据；cached diff check 通过。候选及报告保存到本地分支，不推 main/tag。
- 52 组前后对照已生成 work/v027/evidence/compare.html，以真实起始主题和尺寸配对，避免主题故障让外观链目录标签与实际主题不同；不改原 PNG 或 frames.json。
- 最终远端只读复核：main 为 bcf9beb2ca13ca73214735c103185f9de103b6af，v0.2.7 tag 不存在，最新非 draft/非 prerelease 为 v0.2.6。没有执行 main/tag 推送或候选 Release。
- 最终完整桌面回归：12 项，10 pass / 2 fail，原 8 项与新增导航/面板、信息流两项全绿，skip/todo 0；两个冻结错误未改。work/v027/round3-e2e.log。
- 前后回放各为 52 段/312 PNG，四主题尺寸组合；四组 20 连点原版翻转错误，候选均保持起始主题。截图耗时造成采样时刻漂移，所有实际时刻保留，不能当精确 0/80ms 录像。
- 不加载 Playwright 的原生隔离诊断确认 20/21/30 同步奇偶、终态、持久化及颜色；真实 hide 为 hidden=true/hasFocus=false/is-idle=true/有限动画0。恢复归焦超时，诊断整体失败，详见 BLOCKED.md。只将已走通的局部检查作为补充，不替代冻结门禁。
- 只读原代码当前对照三次导航均 13.9ms，长任务均 1；不能把第三轮相对冻结基线的退步直接归因为某项候选代码。正式基线与门槛不变，性能必需项仍失败。
- 负控通过：隔离副本 transition:all 退出 1（6 pass / 1 fail），恢复后 7 pass；关闭 motion 环境清理导致新测试退出 1（2 pass / 2 fail），恢复后 4 pass。旧/新测试文件逐字不变，日志 work/v027/negative-*.log。
- 生产依赖审计仍为 0 漏洞；主工作区 0.2.6 notices 生成 47 项且 Git 声明差异为 0；文档相关原 release-readiness 测试 8/8 通过。此处不是 0.2.7 发布通过。
- 第三轮性能：闲置 P95 7.1ms；导航 8.3/14.0/13.9ms，中位 13.9ms（上限 7.92ms），长任务中位 1（上限 0），退出 1；work/v027/round3-measure.log 与 work/v027/after/。冻结门槛仍未通过。
- 第三轮 npm test：869 pass / 0 fail / 0 skip / 0 todo；原 865 与新 4 项全绿，work/v027/round3-unit.log。
- 第二轮性能：闲置 P95 7.1ms；导航三次 7.3/13.8/41.8ms，中位 13.8ms，长任务中位 1，冻结比较失败。未删样本或放宽阈值；第三轮撤回自己的加载节奏改动。轨迹显示 Layout 中位总时长由 173.092ms 增为 218.791ms，原因尚不能单凭轨迹断言。
- 第一轮 npm test：869 项，866 pass / 3 fail；新增 4 项均通过。失败为无 motion 依赖时行壳快照变化，以及两项旧字面锚点；下一轮恢复增强层兼容性与真实调用形式。
- 第二轮 npm test：869 pass / 0 fail / 0 skip / 0 todo；原 865 项及新 4 项全部通过。三项旧契约回退已恢复。
- 第一轮 npm run test:e2e：12 项，10 pass / 2 fail；原 8 项（含 112 组合）均通过，新导航/面板/增量行为通过。主题连点已修复，但测试停在原生颜色大小写比较；本机隐藏窗口没有触发 document.hidden。复核纠正归因：主进程未显式设置 backgroundThrottling，详见 BLOCKED.md。
- 修改实现前的回放已完成：六条链、四种主题/尺寸组合、52 段序列、312 张 PNG，work/v027/evidence/before/replay.html。
- 索引修正后的正式前台基线：闲置 P95 三次 7.2/7.1/7.1ms（中位 7.1ms），导航 7.2/7.5/7.2ms（中位 7.2ms），长任务中位数 0。冻结比较上限分别 7.81ms、7.92ms，另有 20ms 绝对上限。
- 隔离 0.2.7 版本冲突实证：node --test test/release-readiness.test.js 返回 1，4 pass / 4 fail；npm run notices 生成 47 项，仅产品版本头变为 0.2.7。未改真实工作区版本/声明。
- 发布边界冲突已确认：只读 test/release-readiness.test.js 硬编码 0.2.6，且不允许修改的第三方声明头随版本生成。详见 BLOCKED.md；不放宽测试、不带旧声明发布。
- 冻结前纠正取证样本准备：文章与 articles_fts 原子双写（直接 INSERT 原不会建立检索索引）；未改被测服务器实现或行为断言。按修正后的同一 90 条样本重新跑三次基线和前置回放。
- 新增行为红测：主题 20 连点 light ≠ dark、同面板 5 个同时入场、运行中 reduced-motion 仍有有限运动；原始日志 work/v027/red-e2e-indexed.log。
- 基线：npm test 865 pass / 0 fail / 0 skip / 0 todo；npm run test:e2e 8 pass / 0 fail / 0 skip / 0 todo（含原 112 组合）。
- npm run audit:runtime：found 0 vulnerabilities；npm run verify:version -- --tag v0.2.6：Verified v0.2.6。
- 原始输出：work/v027/baseline-{unit,e2e,audit,version}.log。
- 原始 leader 取证仅用于理解；新口径会按本机前台三次中位数重新建立。
- 所有临时样本、脚本、原始日志、截图/录屏只存 work/v027/。
- 后续每完成一项即更新本文；未完成项不重复声称完成。
