# v0.2.21 实现与发布验证

验证日期：2026-10-07（Asia/Shanghai）。仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.21。信源名单、身份与栏目核验、候选排除依据、网络和翻译设计见 [信源梳理](v0221-sources.md)。

所有采集和数据库验证使用隔离目录，未读取用户数据库、设置或模型密钥；工作证据保存在被忽略的 work/v0221。未运行本机安装器，安装／卸载烟测由既有一次性 Windows CI 执行。main／tag 工作流与门禁保持。

## 信源与迁移验证

原有 186／186 在本次实网请求有内容，仍清理 5 个同关键词重复入口及 1 个网站身份不符的入口，并修正 11 个原有入口的新闻链接、标题、摘要、时间和融资分类。新增 21 个有效入口，最终 201 个，含 16 个海外源。首次全量严格审计 201／201，0 空、0 失败；投资界新增基金源进一步改为实测有 18 条的独立募资分类，最终再次严格审计 201／201、0 空／失败／跳过，完成于 2026-10-06T16:28:45.801Z。

旧库升级验证包括 v12 增量迁移、保留文章／星标／来源和采集统计、保留启停与自定义源、已移出旧地址不经迁移复活、幂等再次启动。网页解析使用真实页面结构夹具验证图片空链接、专门标题和摘要、明确日期、相对 URL、非新闻导航与无效协议过滤。正式候选全部通过现有输入验证。

首次 HTML 专项的一个断言把没有时区的日期预计为北京时间，但既有 looseDateIso 按 UTC 解析该格式；修正测试为既有正确口径，未为此改变产品日期规则。载人航天初次候选选择器对相对 URL 得到 0，修正绝对新闻 URL 过滤后有 15 条，两个结果保留。

补验发现旧海外资料已分析但待译时，词库计数仍包含被信息流暂时隐藏的条目，复现为 51 与实际 50 不符。计数补入同一待译排除条件，保留原 50 条断言及完整分页验证，修正后通过。证据为 pending-search-reproduction.log 与 unit-verified.log。

升级版本后的第一次全量单元为 960／962，两处失败来自实际迁移一致性规则：迁走的投资界旧地址被作为新 LP 源复用、历史迁移步骤仍含旧版国家航天局选择器。改用经网页栏目链接确认并实测的 /first/t77/，且使历史步骤指向当前选择器；保留原断言不变。迁移专项 17／17 通过，最终全量通过。旧失败日志为 unit-complete.log，修正后为 migration-final.log 与 unit-final.log。

## 网络与中文翻译验证

网络专项验证大陆不可达时不请求海外源、强制采集不能绕过网络判断、恢复后采集、国内源继续运行、跳过不累计失败或退避、没有海外源时不调用探针；并覆盖 CN 出口实际可访问、IP 查询失败、非 CN 但没有连通性、200 登录页／302 跳转、缓存／并发／强制刷新、检测超时、脱敏与环境／Windows 系统代理解析。

最后复核补齐历史海外资料的正文和配图等待：正文补抓从原始行关联到真实信源 intl 标记；不可达时零正文请求，国内正文照常，恢复后可补抓。分析入口同时避免海外配图请求，不把正文等待永久当作处理完成。新增专项通过后最终单元增至 963；产品补充提交另走完整 main CI，发布只采用最终通过提交。

翻译专项验证外文及中英混合待译、中文专名混排、中文与名称校验、缺项／错序／重复／未译／名称丢失拒绝、无模型与预算暂停保留队列、失败延迟、回执复用与预算只扣一次、事务写入中文和全文索引、原文及星标保留、旧外文展示字段与事件标题更新、海外导入走相同队列。真实模型 HTTP 路径使用隔离的本地兼容测试服务，未调用用户的付费密钥，不能据此宣称每家在线模型的语言质量已逐条实测。

真实 Electron 专项使用主入口、后端、预加载和原生 IPC，验证新信源 intl 提交、启停后仍保留标记、中性等待状态、待译数量、中文标题与摘要、名称保留、普通流隐藏未译内容且星标保留中文提示。双主题与 800／1440 宽度截图无横向溢出，并人工查看截图。未拦截应用 API 或伪造网络成功来通过桌面断言。

## 本地完整验证

- 单元与集成：963／963，21.14 秒（补齐海外正文／配图等待后的最终运行）。
- 真实 Electron：25／25，278.19 秒，含既有 160 组窗口／缩放／视图布局，以及主题、动效、三种刊期、设置、更新、凭据、重启和单实例验证。
- fail／cancelled／skipped／todo 全为 0。
- 生产依赖审计：0 漏洞；无新增依赖，第三方声明 47 项。
- 版本、短版本、构建版本、界面与更新元数据统一为 0.2.21，内置更新日志 49 条，本版正文与发布说明一致。
- 包边界：1,279 项 ASAR，13,686,376 B；最终候选安装器 99,604,002 B。
- 候选 PE 产品／文件版本 0.2.21、NotSigned；latest.yml 版本、文件名、尺寸及两处 SHA-512 与实际安装器一致。

最终本地候选 SHA-256：`25a2b4ead5e1560c45792c8188841362f31500205061b36f33119d576718cfed`。先前候选摘要保留在 candidate-pe.json 与 candidate-pe-final.json；最终候选信息为 candidate-pe-release.json。正式构建从 CI 发布提交生成，正式附件摘要以公开下载结果为准。

本地证据：sources-before.json、sources-after-first.json、sources-after.json、existing-content.json、candidate-sites.json、lp-probe.json、selector-fixes-initial.json／selector-fixes.json、focused-final.log、translation-upgrade-final.log、desktop-sources.log、unit-final.log、unit-verified.log、unit-release-candidate.log、electron-complete.log、electron-sources-final.log、runtime-audit.log、notices.log、releases-sync.log、build-release-candidate.log、package-verification-release.log、version-artifacts-release.log、candidate-pe-release.json、candidate-update-metadata.json 及 screenshots/。

最终提交首轮 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37496980200/attempts/1) 为 963／963 单元、24／25 桌面：原有 v0210 指针光效用例在移动后 250 毫秒取得相同 transform，两次均为 matrix(1, 0, 0, 1, 355.969, -63.7266)，原断言失败（test/e2e/v0210-motion.test.js:220）。记录显示指针事件到达、窗口聚焦、full 档位与光效节点存在，具体导致位置未及时变化的原因未定位。本地原样单项 1／1 通过、7.11 秒；同一提交重新执行完整门禁后通过，未修改产品动效、断言、超时、工作流或门禁。后续通过不代表首次原因已修复，原始日志和结果保存在 main-ci-final-first.log／result.json，单项为 ci-motion-local.log。

## 发布状态

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37496980200) 与 [Release](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37499508242) 对精确提交 `df8ea2d2cdd1e74e19c0af31f7b212e702f93e81` 完整通过：963／963 单元与集成、25／25 真实 Electron、生产依赖 0 漏洞、47 项第三方声明、1279 项包边界及一次性 Windows 安装／启动／单实例／退出／卸载，用户数据保留。工作流和门禁保持。

发布时间 2026-10-06T17:04:14Z，Release 非 draft、非 prerelease 且为最新正式版。六项公开附件重新下载并核验 GitHub SHA-256 摘要、校验清单、PE 产品／文件版本、latest.yml 文件名／尺寸／两处 SHA-512、CycloneDX 1.6 SBOM 和第三方声明。正式安装器 99,601,286 B、0.2.21、NotSigned，SHA-256 为 `8f65d8bf3aa3fdf582972ea1b832edac597e637bf7068dd8236b2b2131df219e`。应用匿名实网同步 49 条更新日志，本版正文与发布时间一致，离线缓存恢复通过。

正式包：ASAR 13,698,123 B，1279 项；安装器及各附件信息如下。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 373 | `11d11a5229ff1389eb0b7c80cdc56f4901b8cb30189943afc84042dd6ce7b471` |
| sbom.cdx.json | 81,352 | `2f37606548783a0089f40f31f3340a83d3bed2d93570153e121299d9a8ae695a` |
| SHA256SUMS.txt | 106 | `add51b043a19cd75cd4ab15567b904464b7e74036a2af767d23f36cf27c2936c` |
| Star-Picking-Pavilion-Setup-0.2.21.exe | 99,601,286 | `8f65d8bf3aa3fdf582972ea1b832edac597e637bf7068dd8236b2b2131df219e` |
| Star-Picking-Pavilion-Setup-0.2.21.exe.blockmap | 105,914 | `69e781806501b3405a786fdf5f54e36bedef10fbd8c8cb24395f93a35d5c449d` |
| THIRD_PARTY_NOTICES.txt | 6,347 | `3f844d31d4b83be8ce2db73b3f09216a9e2a12eb52a944b8c42b5b47e2cf4b6d` |

首轮 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37496350620) 对 `3dc5b0ed2dfcaea0f4f1d682cbe9c50ecc8c19db` 的 962 单元／25 桌面及安装烟测通过；随后补齐历史海外正文／配图等待，最终产品提交重新通过上述完整 main 与 Release，标签只指向最终提交。

发布证据位于 work/v0221：main-ci-final.log／result.json／verified.json、release.log／result.json／verified.json、tag-verification.txt、release.json、latest-release.json、published-assets/、published-verification.json、published-installer.json、published-sync-verification.json。源代码与标签一致；发布后收尾仅同步验证和状态文档。
