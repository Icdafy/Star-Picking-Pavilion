# v0.2.17 实现与发布验证

验证日期：2026-10-06。目标仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.17。[v0.2.17](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.17) 已发布为最新正式版，完整门禁及六项公开附件核验完成。

## 实现与设计依据

更新珠将基准直径 44px 增至 52px，外环描边 2.2 增至 3.4（约 55%），内芯独立承载图标／百分比及状态。使用外观色相生成浅／深前景色，近实底色和镜面高光保证壁纸、流体及兼容材质上的层次；修复旧渐变变量嵌入颜色参数的无效声明。主题切换立即更新前景，避免旧浅色墨色在新浅色背景上短暂不可读。原更新状态节点、进度数字、IPC 与重启安装语义保持。

在原 DomUtils 动效引擎内增加当前视觉帧接续、语义文字编排、裁切展开、一次布局提交后的邻项 FLIP；新方法均经依赖注入，保持动画可取消、失焦终止、CSS 恢复及明确的资源寿命。跟手复用原解析弹簧与单个按需 RAF，外环不随内芯偏移。导航／工具图标提供轻微跟随，页头星轨提供独立入场与弹簧视差，五维条形图用 scaleX 展开；原生 details、dialog 和 popover 的键盘与焦点语义继续适用。

参考 [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) 的主题层次、[Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast) 的原生交互细节、[Fluent 2](https://fluent2.microsoft.design/motion) 的运动节奏、[Motion 弹簧](https://motion.dev/docs/spring-value)与[错峰](https://motion.dev/docs/stagger)、[Apple Motion 指南](https://developer.apple.com/design/human-interface-guidelines/motion)及 [Vercel Spinner](https://vercel.com/geist/spinner) 的状态提示原则。实现没有复制外部源码，没有引入新依赖。

性能边界沿用：样式合计 292 KiB、27 脚本标签、20 关键帧、10 处玻璃滤镜；没有新增常驻交互循环。追光最多两个表面及两个控件，展开最多八个可见邻项，文字最多六层，设置滚入只观察九个静态章节。减少动画直接落定，lite 关闭跟手与追光；后台及销毁取消动画、移除装饰层并恢复 translate／transform／opacity／clipPath。

## 本地候选验证

- 更新入口原专项通过 1／1，8.22 秒，原 32 组宽窄窗口／缩放／主题、真实 IPC 进度、键盘安装、循环边界、低功耗、减少动画和高对比度保持。
- 新增动效专项通过 1／1，15.53 秒，96 组配色／材质／缩放的文字对比度 ≥4.5、外环对比度 ≥3，尺寸和轨道宽度符合设计；实际 native Electron 验证跟手内芯、命中范围稳定、星轨视差、中文完整文字入场、五维裁切与条形填充、快速开合、Enter、Escape、命令面板焦点、原生导出下拉、设置章节和后台清理。
- 四项引擎单元覆盖视觉帧接续与 CSS 恢复、FLIP 单次提交和八项上限、静态状态立即生效、lite 时长及后台裁切／条形动画释放。性能护栏保持通过。

首轮新专项发现主题切换期间墨色过渡造成短暂低对比；去掉按钮前景色插值后，所有配色通过。第二轮发现组合选择器按 DOM 顺序选到外环 SVG，改为明确优先内芯后，真实跟随通过；测试的离开位置原先落在另一张卡片，修正到空白处，保留“离开后无装饰层”和固定命中范围断言。原始失败日志保留，不降低断言或发布门禁。

第一次完整本地门禁为 912 项单元中 911 通过，发布文案顺序断言未适配本版；改为分别核对减少动画、双主题及未签名披露，随后完整单元 912／912，19.24 秒。桌面首轮为 23／24，251.49 秒：新增 popover 离散 display 退场令菜单在 Escape 后仍短暂可见，原报告测试的立即关闭断言失败。取消菜单的离散 display／overlay 退场，保持入场过渡、原生及时关闭和原断言；报告专项原样补验 1／1，31.48 秒。第三轮完整桌面 24／24 通过，259.68 秒；fail／cancelled／skip／todo 均为 0，原 160 布局、48 刊期和 32 更新入口及新增 96 配色检查保持。

第二轮完整桌面为 23／24，288.11 秒，新增动效、更新及报告全部通过；原 v028 滚动条拖动的 scrollTop>100 等待超时。原因未定位，原样单独补验 1／1，7.38 秒；没有修改原测试、断言、超时或启动代码。失败保存在 electron-final.log，补验为 scrollbar-isolated.log；后续通过不代表这次超时的根因已经修复。

生产依赖审计为 0 漏洞；第三方声明 47 项，应用内日志 45 条。信源严格复查为 185／186 返回内容、0 空结果，泰伯网·空天资讯 fetch failed，严格复查未通过；原因未定位，采集与信源逻辑未改动。样式 CRLF 口径 297,048 B，约 290.09 KiB，原 292 KiB（299,008 B）预算不变；27 脚本、20 关键帧、9 处滤镜。96 组检查中的最低文字对比度 7.1333、最低环形前景对比度 3.8986。

最终本地候选构建与版本／更新元数据通过：ASAR 1,274 项，13,634,278 B；安装器 99,593,228 B，PE 产品／文件版本均为 0.2.17，NotSigned，SHA-256 为 `fe884803e3f2c3dbfd05991edd89ea72dd0fc8815442f82fdf866ff3e25083d0`。本机未运行安装器。

原始证据保存在 work/v0217：update-baseline.log、motion-unit.log、motion-e2e-first.log、motion-e2e-second.log、motion-e2e-diagnostic.log、motion-e2e-third.log、motion-e2e-fourth.log、unit-first.log、unit-final.log、release-contract.log、electron-first.log、journal-fixed.log、electron-final.log、scrollbar-isolated.log、electron-complete.log、runtime-audit.log、sources-audit.log／sources-summary.json、build.log、package-audit.log、candidate-installer.json、performance-budget.json，以及 motion/ 的十二套配色截图和 theme-contrast.json。状态推送采用隔离测试 IPC，不作为真实公网下载证明；未在本机运行安装器。

## 发布状态

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37458997929) 与 [Release](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37460245395) 对提交 `96fd539f97cf9e8777491576e0aacd6cf2d43b99` 完整通过：912 单元、24 真实 Electron、0 生产漏洞、47 项第三方声明、1,274 包边界，以及一次性 Windows 安装／启动／单实例／退出／卸载，用户数据保留。工作流、原断言及超时保持。

发布时间 2026-10-06T12:10:31Z，Release 非 draft、非 prerelease且为最新正式版。六项公开附件重新下载并核验 GitHub SHA-256 摘要、校验清单、PE 产品／文件版本、latest.yml 两处 SHA-512、文件名及尺寸、SBOM 和第三方声明。安装器 99,591,501 B、0.2.17、NotSigned，SHA-256 为 `663087341156b8f4933031c10effe113c272a7445b29656b2b2a10f1f5d3779a`。应用匿名实网同步 45 条更新日志，正文与公开发布一致，离线缓存恢复通过。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `9b824ad177045f4c9cca2c988724dc236f838c46d992d6e6ef79ff75dc37bd2b` |
| sbom.cdx.json | 81,352 | `6edcb7926b34f3b7ba68382635377dde502adbbac8659dec372b491f43968742` |
| SHA256SUMS.txt | 106 | `c24314a7c1ef605e2510d76a168e363bc5f1db4ad022428ed55e1ea3cca1224c` |
| Star-Picking-Pavilion-Setup-0.2.17.exe | 99,591,501 | `663087341156b8f4933031c10effe113c272a7445b29656b2b2a10f1f5d3779a` |
| Star-Picking-Pavilion-Setup-0.2.17.exe.blockmap | 105,976 | `d3aafa632c828b5a1a92929dcbee944421873ad7513a025bd59fbc85d9a7aa5e` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `f69bfbe6f9c62f13ca7b7cf5e99bb626ed97f1fa3f33cc0110e1e2ee05f0d0a1` |

发布证据保存在 work/v0217：main-ci.log／result.json／verified.json、release.log／result.json／verified.json、release.json、latest-release.json、published-verification.json、published-installer.json、published-sync-verification.json、published-assets 六份原件及 tag-verification.txt。安装器没有在本机运行。收尾仅修改文档，应用代码保持与发布 tag 一致。
