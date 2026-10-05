# 摘星阁 v0.2.8

本版统一新用户的原始设置，并修正右侧滚动条的标题栏边界和主题配色。已有用户升级保留本地设置、数据库与已保存的密钥。

- **新用户原始状态**：以维护者指定的本机设置为准，浅色主题、标准字号、背景效果／星鲸／星空关闭，精选首页、实时更新开启、关闭时退出，默认网址分类“督办计划”、收藏为空；采集间隔 60 分钟。
- **老用户设置保留**：完整本地配置优先，旧版本缺省字段继续沿用旧默认值；浏览器设置可迁入桌面配置，关闭开关、数值 0 和空收藏都保留。加载不重写原配置文件。
- **滚动条边界**：主轨道和滑块从标题栏下方 4px 开始，内部列表保持自身边界；14px 轨道、8px 胶囊，悬停和拖拽增强反馈。
- **滚动条配色**：随流动背景的当前色相和深浅主题调整，壁纸及关闭背景使用中性色，系统强制颜色模式使用系统色；保留原生拖拽、滚轮、键盘与吸顶阅读行为。
- **功能与数据**：继续支持原有玻璃、星空、星鲸和减少动画设置；没有新增依赖或打包个人数据。既有用户已开启的背景效果保持原样。

设计参考、配置迁移与验证过程见 [v0.2.8 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v028-validation.md)。

本地与正式发布验证：874 项单元、14 项真实桌面测试（含原有 112 种布局组合）全绿；生产依赖审计 0 漏洞，1,270 项包边界检查通过。精确发布提交的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37317993152) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37319279803) 全部成功，一次性 Windows CI 完成安装、启动、单实例、关闭、卸载及用户数据保留检查。

在线严格信源复查为 40 成功／150 失败，东财相关性检索返回空响应；采集器沿用旧版，该外部接口问题未在本版修复。旧桌面重启测试曾有一次未定位的启动退出，原样诊断与最终完整回归通过，详细失败记录保留。

## 安装与校验

安装包为 `Star-Picking-Pavilion-Setup-0.2.8.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。下载后核对 `SHA256SUMS.txt`；正式资产仍由既有 GitHub Actions 完整门禁生成并发布，安装／启动／单实例／卸载烟测在一次性 Windows CI 执行。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.8.exe
Get-Content .\SHA256SUMS.txt
```

正式 [v0.2.8 Release](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.8) 为最新非 draft／非 prerelease 版本。配套发布 blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 和第三方声明，六项附件已重新下载核对尺寸与 GitHub 摘要，更新元数据的实际 SHA-512 匹配。

正式安装器 99,541,704 字节，PE 产品／文件版本 0.2.8，SHA-256：`174a914d0bf54250877cd03644b2b8a5c7b8913c245215db13a8471174d9c2d4`。

---

## 历史发布记录

# 摘星阁 v0.2.7

本版让导航、信息流和快捷操作更及时，并修复主题快速连点的状态覆盖。玻璃、星空、星鲸和双主题沿用，升级保留全部本地数据和设置。

- **主题按最后意图生效**：20/21/30次快速点击按奇偶立即落定，DOM、原生窗口与持久化一致；按钮140ms反馈，颜色短过渡可取消。
- **导航与内容衔接**：同一面板只保留最新入场；导航选中立即反馈，转场260ms。滚动复位先于控制器内容写入，减少首次显示的同步布局。
- **阅读不中断**：检索、筛选与分页保留正确请求上下文；后台增量保留旧节点、滚动和焦点。阅读中用工具栏下的浮层提示新情报，点击后加载，避免通知推移正文。仅可见新行错峰，最多八行，总延迟175ms。
- **快捷操作与焦点**：星标/复制提供等待与完成反馈；Toast可打断；命令面板、词库和确认框Esc归焦，第二次确认不会继承上次OK。
- **运行中降载**：减少动画、静态档、隐藏和失焦及时清理有限动画；真实前台恢复可继续交互。外观关闭设置可持久化。

技术验证：869项单元/集成、12项真实桌面回归（原112布局组合）全绿，fail/skip/todo均0；生产审计0漏洞、47项第三方声明零差异、1270项包边界检查通过。一次性Windows CI验证安装、启动、单实例、关闭、卸载及用户数据保留。本机没有运行安装器。

同机真实前台、full档、1440×920、DPR1、144Hz、相同90条样本/30张卡片，三次导航rAF间隔P95中位数为旧版13.9ms→本版7.4ms，均满足≤20ms与同机基线110%；超过50ms长任务中位数0→0。该结果是调度采样，不代表所有GPU或慢CPU设备；绘制总成本有小幅增加。六条交互的双主题/双尺寸前后连续帧回放、红→绿与完整限制见[验证报告](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v027-validation.md)。实际体验Linear、Rauno和Lusion的映射见[交互计划](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v027-motion-plan.md)。

验证过程保留两类未定位风险：一次本地恢复动画的即时观测失败，以及多次Windows CI中不同原有桌面测试在取得首个窗口前遇到进程关闭。原样本机诊断未复现；最终main与release完整门禁均通过。失败与成功分别记录于验证报告，没有放宽断言、增加测试内重试或更改发布工作流。

正式[v0.2.7 Release](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.7)已发布，当时为最新非draft/非prerelease版本，六项资产完整。安装器SHA-256：`bc1faf325fa6980c4c64b3f62c0afee06d363f81cf4666c6947fb6a03dc75610`，新目录下载已与SHA256SUMS.txt和GitHub摘要复核；PE产品版本0.2.7、更新SHA-512匹配。完整[发布工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37307161572/attempts/3)成功。

## v0.2.7 安装包与发布策略

安装器为 Star-Picking-Pavilion-Setup-0.2.7.exe。沿用未签名策略，签名状态为NotSigned；Windows SmartScreen可能提示未知发布者。正式资产仅通过既有GitHub Actions门禁发布，安装前核对SHA256SUMS.txt。安装/启动/单实例/卸载仅在一次性Windows CI中验证，本机不运行安装烟测。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.7.exe
Get-Content .\SHA256SUMS.txt
```

配套资产须包含blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM和第三方声明。公开网址策略及原有SmartScreen说明保留，未增加依赖或更改发布工作流。

## 上版正式发布记录

### 摘星阁 v0.2.6

仓库瘦身与完整发布版。全部应用功能沿用 v0.2.5，升级保留本地数据库、星标、日报与周月报、备忘、界面偏好、壁纸、研究归档和已保存的模型提供商密钥。

- **仓库瘦身**：移除 47 个无运行、测试或构建引用的文件，共 8,220,844 字节（约 7.84 MiB），包括旧视觉截图、临时差异及审阅文件、旧代码副本、一次性截图脚本、IDE 配置、已完成的设计提示词与早期实施草稿。
- **完整保留**：运行代码、221 个内置信源、行业包与提示词、全部中文字体、图标及其生成脚本、测试、构建与发布流程、许可证和第三方声明均保留。精选、热点、一级市场、检索、模型设置、日报／周报／月报、自动更新和本地数据治理继续可用。
- **防止再次堆积**：build/ 只跟踪 icon.ico、icon.png、make-icon.py；截图、差异文件、临时工作目录、安装验证目录和下载的参考源码通过 Git 忽略规则留在本机。
- **说明集中**：README 提供当前版本安装与使用说明；历史版本说明集中在 CHANGELOG，并移除重复的 v0.2.5 记录。

清理针对当前源码文件，历史 Git 提交与已发布版本保留以便追溯和回退。安装包仍完整包含 Electron 运行时与内置字体；本次减少的是仓库冗余，未精简运行功能。

**公众号限制**：商业航天发展三个用户提供链接仍要求微信环境验证，保留入口并标为受限，不能声称采集成功。

发布前本地验证：865 项单元／集成测试及 8 项真实 Electron 测试全部通过，生产依赖审计为 0 个漏洞。实时复查 190 个启用信源，187 个返回内容、0 个请求失败；「东财检索·沃飞长空」「东财检索·傲势科技」「东财检索·腾盾科技」本轮返回 0 条，因此 `audit:sources --strict` 未通过全非空门槛。这三条入口继续保留，未将空结果视为成功。

### v0.2.6 历史下载与校验

安装包：`Star-Picking-Pavilion-Setup-0.2.6.exe`。此版本尚未代码签名，Windows SmartScreen 可能提示未知发布者；签名状态预期为 NotSigned。请核对 SHA256SUMS.txt 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.6.exe
Get-Content .\SHA256SUMS.txt
```

附带 blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明。GitHub Actions 完成完整测试、包检查与安装／启动／单实例／卸载验证后发布；卸载保留用户数据。
