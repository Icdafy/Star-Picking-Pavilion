# v0.2.15 实现与发布验证

验证日期：2026-10-06。目标仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.15。正式发布使用现有 main CI 与 tag release 工作流，以下记录随验证更新。

## 实现

- 报告概况日期独立居中，字号由 1.25rem 增至 1.875rem。横幅沿用 v0.2.14 实测尺寸：1440 与 800 宽度、四档缩放的高度变化不超过 1px，主题及刊期同步验证；“生成于”时间从界面删除。
- 三种刊期共享复制、导出与重新生成。所选报告日期／期号由视图控制器提供，加载期间禁止操作；刷新完成只重载仍被选中的报告。
- 原生 Popover 下拉提供 .md 和 .doc，键盘、Escape、外部点击关闭由浏览器实现；切换刊期关闭旧菜单。
- 三种导出和复制共用完整报告内容，包括导语、热点、分类精选、资本事件及投资方、关注公司动态、公司声量和技术突破，安全 HTTP(S) 原文链接保留。
- .doc 按微软 [MS-DOC](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/) 和 [MS-CFB](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/) 存储 Unicode 文本、piece table、样式与 A4 节属性，输出真正的二进制文档。空白样式由本机 Word 生成并裁去作者、修订列表、文档属性、主题和时间；不包含宏、对象、域或外部关系。Office 仅用于开发阶段验证，用户导出无需 Office。
- 无新增依赖、脚本标签或关键帧。清理既有样式说明的重复文字，继续遵守原 292 KiB 样式预算，不修改工作流与安装烟测范围。

## 本地验证

- 单元与真实接口：903／903 通过，fail／cancelled／skip／todo 均为 0；最后完整运行 15.74 秒。覆盖三种刊期、全部导出格式、冻结期刊显式刷新、非法期号与鉴权、异步切换和渲染失败后的操作边界，以及多 FAT 扇区和 Unicode 文档读取。
- 真实 Electron：22／22 完整通过，238.23 秒，原 160 组布局保留。新刊期验收覆盖 48 组窗口／主题／缩放／刊期，实际剪贴板复制、格式选择、键盘、Escape、外部关闭、切换清理、六个下载文件及三种重新生成均通过；最终专项复验 1／1 通过，30.47 秒。
- 48 组日期中心的水平与垂直最大偏差均为 0.0078125px。标准字号宽屏高度 111.109375px（旧 111.125px）、窄屏 174.09375px（与旧版相同），双主题一致；其余缩放与旧高度差不超过 1px，无横向溢出和“生成于”文字。
- 实际下载的三份 v0.2.15 .doc 均由本机 Word 打开，SaveFormat 为 0（Word 97–2003），中文、emoji、原文链接及版本声明逐项匹配，另生成 PDF 供本地检查。用户导出不调用 Office。
- Windows CRLF 口径总 CSS 为 298,896 B，原上限 299,008 B；脚本 27、关键帧 20。0 个生产依赖漏洞，47 项第三方声明，43 个内置版本记录及本版正文同步通过。
- 本地候选包：1,274 项 ASAR 边界通过，app.asar 13,616,979 B；安装器 99,590,062 B，PE 文件／产品版本均为 0.2.15，NotSigned，SHA-256 为 f2fb8a6d521b5a8aa2c7873387aa31d4fd15206f8f03811518b9ff11c6114a45。版本与自动更新元数据核验通过，本机没有运行安装器。
- 实网信源复查：184／186 返回内容，东财检索·穿越者为空、泰伯网·空天资讯请求失败，严格检查退出 1，与上版已记录的两项异常一致。本版没有修改信源及采集逻辑，未将严格检查记为通过。

早期问题及修正：原型 Word 文档被 Office 拒绝，改用经 Word 验证的空白格式默认值；新接口对业务层非法期号最初返回 500，已将其映射为 400；新增测试清理数据库时的锁定顺序已修正。桌面首轮发现 Windows 剪贴板将 LF 转成 CRLF，断言按平台换行归一；日报夹具补齐真实缓存的 windowVersion／edition 字段。原始日志保留在 work/v0215，不放宽旧有发布门禁。

补验功能断言全部通过后，新增桌面测试的目录清理曾报 Windows EPERM；仅对自建临时目录清理加上 maxRetries=10、retryDelay=100 的有界重试，最终完整专项通过，产品与功能断言不变。失败与最终日志分别为 journal-confirmed.log、journal-final-cleanup.log。保留 Word 原型、report-exports-first.log、native-first.log 及最终单元／桌面／包审计原始日志。

## 发布状态

main 首轮 `37439295522` 在提交 `7c759b6594979b29e734f8119a529738ff44a8ee` 上为 903／903 单元、21／22 桌面：旧工作区验收的截图及几何记录已移至本版目录，但末尾动效记录漏改，仍写入不存在的 work/v0214，干净 CI 报 ENOENT。本地旧目录存在，未暴露该问题。动效断言及本版情报日志专项通过；仅修正记录路径，修正后本地工作区专项 1／1 通过，44.49 秒，完整门禁重新执行，首轮日志保留。

Release [首轮](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37441759863/attempts/1) 为 903／903 单元、21／22 桌面，旧 v0210-motion 测试等待初始 #feedList .card[data-id] 超时 30 秒；本版情报日志专项和同提交 main CI 通过。本地原样专项 1／1 通过，5.97 秒，原因未定位。同一提交的第 2 次完整发布门禁通过，没有修改产品、断言、超时或门禁；后续通过不代表首轮根因已修复。首轮及最终日志均保留。

[v0.2.15](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.15) 已发布为最新正式版。情报日志日期居中放大并移除生成时间，保持原报告概况尺寸；日报、周报、月报共享复制、重新生成与 .md／原生 .doc 文件导出。

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37440510862) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37441759863/attempts/2) 对产品提交 `06f0f52ecb163d28ff1fddf33851dcaf347eea3d` 全部通过：903 单元、22 真实桌面（原 160 布局与新增 48 刊期组合）、0 生产漏洞、47 项声明、1274 包边界及一次性 Windows 安装／启动／单实例／退出／卸载，用户数据保留。

注释 tag 对象为 `c05459701f163c4ed28c94151e5f467d85279820`，远端解引用与上述提交一致。发布时间为 2026-10-06T09:35:41Z。最终两套 CI 的 fail／cancelled／skip／todo 均为 0；工作流、阈值、超时与安装烟测范围沿用既有门禁。

六项附件已重新下载并核验 GitHub 摘要、PE 版本与更新元数据。安装器 99,588,593 B、0.2.15、NotSigned，SHA-256 为 `6550007db2d5c2717a282f10a658d5c3957bdbf46755fadc5af7a00bfbfdb58c`。发布后应用匿名实网同步 43 条版本记录、当前正文及离线缓存恢复一致。

| 公开附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `6eeec831bd0fc29c068745cc465086dd346a14e158b81635e29092ad082cca2f` |
| sbom.cdx.json | 81,352 | `0db7b866042d9004223765474d83954ce1a973c790a67ede9bf2cb3140f1911c` |
| SHA256SUMS.txt | 106 | `b1bd271ff492d4597906cc5a68ea782b5b1d860800d1ac916a2063e3ce3e2289` |
| Star-Picking-Pavilion-Setup-0.2.15.exe | 99,588,593 | `6550007db2d5c2717a282f10a658d5c3957bdbf46755fadc5af7a00bfbfdb58c` |
| Star-Picking-Pavilion-Setup-0.2.15.exe.blockmap | 106,011 | `93d6fa498b7d1f144970b34215b864fee20c0483a53ec97b50429bcf63e88f33` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `d507d6b2e4b442fa4d0bb8fdc3d5a36888a1654836399322b68edb4d8e953e72` |

latest.yml 的版本、文件名、尺寸和两处 SHA-512 与下载的安装器一致；SBOM 为 CycloneDX 1.6、产品 0.2.15；第三方声明与提交逐字匹配（仅归一换行），公开 Release 与内置本版正文一致。用户安装器未在本机运行。

原始证据保存在 work/v0215：main-ci-attempt1.log、main-ci-attempt1.json、workspace-path-fix.log、main-ci.log、main-ci-result.json、main-ci-verified.json、release-attempt1.log、release-attempt1.json、release-motion-isolated.log、release.log、release-result.json、release-verified.json、release.json、latest-release.json、published-verification.json、published-installer.json、published-sync-verification.json，以及 published-assets 六份原件。收尾仅更新文档，产品代码与发布 tag 保持一致。
