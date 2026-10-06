# v0.2.18 实现与发布验证

验证日期：2026-10-06。目标仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.18。[v0.2.18](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.18) 已发布为最新正式版，完整门禁及六项公开附件核验完成。

## 实现

更新入口在初始化及未发现更新的检查过程中隐藏。接收到 available、downloading、downloaded 或 installing 后保留入口，下载／安装错误及重试检查继续可见，current 清除待更新状态并隐藏。下载 100% 与安装完成分开处理，保留用户主动重启安装的语义；隐藏期间不触发更新珠文字与图标的入场动画。

报告日期导航改为标题下方独立的网格行，左右方向标和日期共用导航组并居中对齐。标题与导航间保留 .25rem 的行间距；周报括号内范围使用主日期的 65% 字号，避免特大缩放换行挤压。窄窗口的日期组限定在统计区上方，横幅高度保持。

检索框的内部 input:focus-visible 用组件选择器覆盖后加载 intel.css 的通用输入描边，焦点反馈沿外层圆角搜索条绘制。高对比度模式额外保留外层 outline，词库及清除按钮的键盘焦点样式保留。

## 验证

完整单元 913／913 通过，18.86 秒，fail／cancelled／skip／todo 均为 0。更新状态专项 8／8，涵盖启动、后台检查、未发现版本、下载 100%、下载完成、失败重试、主动安装、确认最新及未来新版本再次出现。真实 IPC 更新专项与 96 组主题／材质／缩放动效专项保持通过。

日报／周报／月报、宽窄窗口、四档缩放、双主题的 48 组报告检查通过；横幅高度保持原基线，左右箭头与日期同轴居中，全部导航位于标题下方且留有间距。原生复制、Markdown／Word 下载、菜单 Enter／Tab／Escape 和重新生成继续通过，专项耗时 31.23 秒。

另用真实 Electron 检查 48 组报告几何以及各 16 组鼠标／键盘聚焦搜索。最小标题间距 4.97px，宽窗口标准缩放的日期中心下移 18.64px。检索框内部 outline 均为 none，外层圆角与焦点反馈存在；高对比度的外层 outline 为 solid、圆角 99px，词库按钮焦点可见。截图逐项检查无标题重叠、日期裁切或统计区挤压。

最初两轮仅给绝对定位导航增加顶部留白，分别暴露小缩放间距不足、特大周报两行日期受挤压；改为标题与日期分行并分层呈现周报范围。第三轮因标题原有下边距与新增行间距叠加，使窄窗口横幅增加约 3px；去掉重复下边距后，第四轮 48 组布局和完整导出专项通过。失败日志保留，没有放宽原横幅高度基线、字号下限、对齐、导出或键盘断言。

完整桌面回归 24／24 通过，261.61 秒，fail／cancelled／skip／todo 均为 0，原 160 组布局、48 组刊期、32 组更新入口及 96 组配色检查保留。最后将未发现更新时的读屏错误提示改为“更新检查暂时不可用”，避免提示点击隐藏的重试按钮；更新状态单元 8／8 补验通过。

生产依赖审计 0 漏洞，第三方声明 47 项，内置更新日志 46 条。CSS 按 CRLF 计算 297,159 B，低于原 299,008 B 预算，27 脚本、20 关键帧、9 处滤镜。信源严格复查 184／186 返回内容、0 空结果；国家航天局·官网与泰伯网·空天资讯 fetch failed，严格复查退出 1，本版未修改采集与信源逻辑。

本地候选构建及包边界、版本、PE 和更新元数据检查通过：ASAR 1,274 项、13,636,854 B；安装器 99,593,589 B，产品／文件版本 0.2.18，NotSigned，SHA-256 为 `1b5bc55ab6a6808088c009e819d297786fc9e732cf06d21dfd50d3717de0a842`。latest.yml 版本、文件名、尺寸及两处 SHA-512 与候选安装器一致。

安装／启动／单实例／退出／卸载烟测在一次性 Windows CI 完成，本机没有运行安装器。

本地证据位于 work/v0218：update-unit.log、update-unit-final.log、focused-electron.log、journal-second.log、journal-third.log、journal-fourth.log、unit-first.log、unit-final.log、electron-complete.log、runtime-audit.log、sources-audit.log／sources-summary.json、performance-budget.json、inspect-ui.log、inspect-final.log、build.log、package-audit.log、artifact-version.log、candidate-installer.json、candidate-update-metadata.json，及 final-ui/、motion/、update-button/、native-exports/ 的截图、几何、配色与导出文件。状态推送使用隔离测试 IPC，不作为真实公网下载证明。

首轮匿名实网同步未成功，保留本机更新日志；原 8 秒上限下重试成功，当前正文、发布时间及离线缓存恢复一致。首轮失败保存在 published-sync.log，重试保存在 published-sync-final.log，后续通过不代表首轮失败原因已定位。

## 发布状态

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37465193386) 与 [Release](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37466542088) 对提交 `10952bca2554481729f1acb23003e4006dc1c287` 完整通过：913 项单元、24 项真实桌面、0 生产漏洞、47 项第三方声明、1,274 项包边界及一次性 Windows 安装／启动／单实例／退出／卸载，用户数据保留。工作流和发布门禁保持。

发布时间 2026-10-06T13:01:48Z，Release 非 draft、非 prerelease 且为最新正式版。六项公开附件重新下载并核验 GitHub SHA-256 摘要、校验清单、PE 产品／文件版本、latest.yml 两处 SHA-512、文件名及尺寸、SBOM 和第三方声明。正式安装器 99,591,790 B、0.2.18、NotSigned，SHA-256 为 `e6426e2d55d72c23e15a997dadaef430132a372faf845ff641122759d3f3330a`。应用匿名实网同步 46 条更新日志，当前正文和发布时间与公开 Release 一致，离线缓存恢复通过。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `24529821bb75afd893c7bbe60b62a66d09981c8ec28a03fb1e8c1b97e5c2563e` |
| sbom.cdx.json | 81,352 | `3bca5a946651aaf50039e5ff4c20bd0c41e06f3a0fadbf6585d4306fafb295e3` |
| SHA256SUMS.txt | 106 | `892354ce0897b3a7ab0c806494a14a1e5b111a62d1fe77d562d990a1999e7024` |
| Star-Picking-Pavilion-Setup-0.2.18.exe | 99,591,790 | `e6426e2d55d72c23e15a997dadaef430132a372faf845ff641122759d3f3330a` |
| Star-Picking-Pavilion-Setup-0.2.18.exe.blockmap | 105,841 | `e2e4698dbbdb5fe83c67902c43357599b800c2b5df1be1e575360c3add0bde1b` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `a09998b9813aa1157da262a17f314e1d65db9ccf084ffe0136252956decbfcb5` |

发布证据保存在 work/v0218：main-ci.log／result.json／verified.json、release.log／result.json／verified.json、release.json、latest-release.json、published-verification.json、published-installer.json、published-sync-verification.json、published-assets/ 六份原件及 tag-verification.txt。收尾仅修改发布验证文档，应用代码保持与发布 tag 一致。
