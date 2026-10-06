# v0.2.11 设计与验证记录

## 设计依据

2026-10-06 查阅以下第一方资料，并结合摘星阁的阅读场景与现有原生 JS / WAAPI 架构实现。

- [Olivier Larose · Magnetic Button](https://blog.olivierlarose.com/tutorials/magnetic-button)：磁吸运动随输入偏移并在离开时恢复。这里将偏移限制为水平 3px、垂直 2px，作用于光晕装饰。
- [Apple · Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/)：弹簧支持运动中的目标变化与速度衔接。这里用解析阻尼弹簧预采样选择块轨迹，改向保留当前弹簧速度。
- [Motion · Cursor](https://motion.dev/docs/cursor)：指针反馈可以用不同运动响应形成交互层次。这里用贴近指针的近光和较缓的远光营造深度，保留系统指针。
- [Linear · A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)：保持视觉层级与日常阅读秩序。这里固定文字和命中区域，强调局部光感。

上述为本项目对资料的设计转化，没有复制第三方运行时或引入新依赖，不把参考产品的流畅度当成本机实测。

## 实现与边界

DomUtils.createMotion.retargetIndicator 使用解析阻尼弹簧生成 11 个 transform 样本，交给 WAAPI 播放。新目标取当前视觉矩形和旧动画播放时刻的弹簧速度，尺寸一次提交；仍沿用 300ms（lite 180ms）运动与 50ms 清理余量，延迟完成回调不会锁住选中状态。

createInteractionMotion 为卡片创建近光、缓随远光与遮罩边缘高光，为常用按钮创建磁吸光晕。颜色跟随低空经济、商业航天和精选，深浅主题分别调整强度；文字、卡片内容和点击区域不随指针移动。

每类最多保留两个装饰目标（当前与淡出），退出淡出最长 240ms；按压光波仍最多四个、最长 500ms。委托事件不逐卡安装监听，指针事件合并到一条 RAF，先读取当前两个目标的几何，再写 transform / opacity。静止后停止 RAF。只在装饰存在时监听节点移除与按钮禁用，每次最多检查四个目标，不扫描内容树。

full 启用增强，lite 关闭追光和磁吸，static／减少动画直接落终态。强制颜色关闭指针装饰；滚动、窗口尺寸变化、触摸取消、隐藏／失焦、目标移除和 dispose 清理节点、计时器、帧回调与对应监听。双主题、键盘和缩放沿用原功能。用户数据、设置、内置字体与应用身份沿用，安装器继续未签名。

## 验证进度

选择运动单元 6／6 通过，包含新增的运动中改向速度衔接。两项新增真实 Electron 专项已通过：近光／远光响应差异、边缘与近光同步、正文和按钮几何稳定、双主题截图、磁吸边界、24 次快速扫动的节点上限、静止后零样式写入、滚动、强制颜色、运行中减少动画、lite、稳定后的目标移除及 dispose。

首轮新增桌面测试失败的原因包括：测试误把导航显示名“热点”写成“当前热点”；滚轮发往侧边导航，正文没有滚动，80ms 时淡出尚未结束。修正为当前真实显示名与正文原生滚动。随后一次卡片光层断言失败，初步按实时刷新／布局变化处理；另一次移除目标后底下的卡片接收指针，生成了有效的新追光。隔离偏好设置为 realtime=false，使专项聚焦指针运动；目标移除断言改为核对被移除节点的装饰和类名确实释放，同时限制新目标数量。生产代码增加装饰存在期间的有界节点移除／禁用观察，防止稳定后替换目标留下引用。

双主题截图已人工查看，位于 work/v0211/e2e/v0211-{light,dark}-light.png。首轮完整单元为 882 项、881 通过、1 失败：发布说明完整性测试按既定顺序查找“光波”之后的“追光”，新版说明先介绍追光，降级段落则没有再次写明关闭追光。补充与实际行为一致的降级表述后重新执行完整单元。

完整复验为 **882／882 单元、19／19 真实桌面通过**，fail／cancelled／skip／todo 均为 0。桌面耗时 185.59 秒，包含既有 112 种窗口／缩放／核心视图布局、主题、持久化、导出、安全、键盘与原生滚动验证。生产依赖审计为 0 漏洞，47 项第三方声明已随版本生成。

初轮本地候选包构建成功，1271 项 ASAR 包边界通过；app.asar 为 13,412,866 B，安装器为 99,546,165 B，版本／PE 文件版本／PE 产品版本与更新元数据均为 0.2.11，签名 NotSigned。候选安装器 SHA-256 为 `6bfbe2410eda8c39b347b61e16dd36e39944bbe1ce00e8df128f7f710e92eda2`。本机未运行安装器，安装／启动／单实例／退出／卸载由既有一次性 Windows CI 执行。

原始本地结果在 work/v0211/unit.log、unit-final.log、e2e.log、build.log、candidate-metadata.json；精确提交 CI 与正式发布结果待补录。

## 首次 CI 失败与修正

精确提交 fad97cf46e62b265e0ec383f326172c9ac6b6413 的 [首次 main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37404771652) 为 882／882 单元通过、桌面 17／19：新增专项分别在初始光层读取与静止零写入断言失败，后续审计／构建／安装步骤未执行，没有创建 tag 或正式 Release。原始日志与元数据在 work/v0211/main-failed-attempt1.{log,json}。

补充指针／焦点／档位／字体／几何诊断后，本地再现了光层缺失。诊断记录显示，在指定卡片坐标后出现了另一组连续的原生鼠标坐标，目标移至 hero 区域，追光因正常离开卡片而清理。测试窗口增加 setIgnoreMouseEvents(true)，隔离系统鼠标移动，CDP 仍驱动真实渲染器，窗口焦点、显隐和原生生命周期照常验证；断言、超时与 CI 门禁保持原有要求。启动坐标测量前等待真实字体与统计／横幅就绪，静止检查先确认光层已落终态，再验证零写入。

生产弹簧同时改用解析解按实际墙钟前进，避免截断长帧时间造成进度拖慢。新增 280ms 延迟 RAF 的故障注入，要求近光在实际目标 3px 内收敛；正常静止、减少动画、滚动与清理继续核验。修正后动效专项 5／5、运动单元 10／10 通过。原始诊断与复验在 work/v0211/motion-fixed.log、motion-isolated.log 和各 profile 的 motion-state.json，最终完整回归及新的精确提交 CI 待补录。

修正后完整复验为 **882／882 单元、19／19 桌面**，fail／cancelled／skip／todo 为 0；桌面耗时 199.53 秒，原始日志在 unit-fixed-final.log 与 e2e-fixed-final.log。最终候选包重新构建并通过 1271 项包边界：app.asar 为 13,413,266 B，安装器为 99,546,251 B，PE 产品／文件版本 0.2.11，NotSigned，SHA-256 为 `9b63f5eb933196c1972da2b2e108f0fe3909ce2751e70618fd794abc9a12a8d1`。新构建日志与 PE 记录在 build-fixed-final.log 和 candidate-fixed-metadata.json。

## 第二次 CI 失败与测试环境修正

精确提交 11f32aa28f82463bea74af144b82b84ba6c1cd7a 的 [第二次 main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37406649675) 为 882／882 单元通过、桌面 16／19。两项指针专项失败时，诊断记录均为 focused=true、hidden=false、tier=lite，指针位于正确卡片；另一项既有滚动条测试在 Playwright electronApplication.firstWindow 阶段报告窗口／上下文已关闭，没有留下足以确认应用启动失败原因的原生日志。后续审计／构建／安装步骤未执行，尚未打发布标签。证据在 work/v0211/main-failed-fixed.{json,log}。

应用只在启动和减少动画偏好变化时推导档位。专项原本先手动指定 full，再等待字体／统计；CI 低核心数设备上的异步偏好通知随后将档位写回 lite。测试改为在应用的同一 MediaQueryList 上注册后置监听，并在真实字体／统计就绪后启用 full 功能档位；减少动画仍由应用进入 static，手动 lite、显隐、滚动和 dispose 验证保留。这是明确的完整档位功能覆盖，不用于宣称低配设备默认开启增强或达到某一帧率，生产档位策略未变。

两项 v028 界面测试改用与既有 v027 专项相同的原生 Electron 启动协议：独立 profile 中的 IPC 包装器加载真实 electron/main.js，通过 CDP 连接真实窗口；后端、preload、HTTP、数据库、安装行为与界面断言均未替换。包装器记录原生进程输出，启动失败立即报错，不重试、不跳过测试。此前 firstWindow 错误的具体根因仍未确认，不把协议更换写成生产启动问题已经修复。

针对上述改动的 7 项桌面复验全部通过（50.79 秒，fail／cancelled／skip／todo=0），日志在 work/v0211/motion-native-third.log；随后执行完整桌面回归并等待新的精确提交 CI。

本轮完整桌面复验 **19／19 通过**（191.06 秒，fail／cancelled／skip／todo=0），日志在 work/v0211/e2e-third-final.log。本轮只修改桌面测试环境与验证记录，生产文件和候选包与上一轮已验证结果一致，单元／审计／包边界沿用前述本地结果，并由新精确提交的 GitHub CI 全量复核。

## 第三次 CI 失败与冷启动修正

精确提交 3e07ea90cc9c53211106eb687894bf4b7c7c8923 的 [第三次 main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37408523279) 为 882／882 单元、17／19 桌面。完整档位与分层光感专项均通过；清理专项失败时正文 scrollTop=0，150ms 固定等待尚未等到真实滚动，断言改为等待原生滚动位置变化后立即核对清理，原有零节点要求保留。既有滚动条测试的原生日志明确记录“后端启动握手超时”，随后才输出 186 个种子信源同步与 server:ready。后续发布门禁未执行，没有打 tag；原始记录在 work/v0211/main-failed-third.{json,log}。

冷启动原本为建表／兼容补列、186 个信源和 78 家公司逐条提交。现在结构迁移与两个种子同步分别做原子批次，减少磁盘同步放大；不更改 PRAGMA 同步／外键／WAL 策略、15 秒启动握手上限、20 秒测试启动等待或工作流。嵌套批次使用 savepoint，不提交调用者事务；版本标记与种子同批提交，公司种子只在外层事务已提交时缓存成功，失败后可重试。默认目录与迁移内容、历史文章、星标、用户启停／别名／备注不变。批量写入依据见 [SQLite 官方说明](https://www.sqlite.org/faq.html#q19)，事务状态 API 自 Node 22.16／24.0 支持，符合项目 Node ≥22.19 要求，见 [Node SQLite 文档](https://nodejs.org/api/sqlite.html#databaseistransaction)。

本机 Node 24.19 对每版三个全新隔离 profile 实测：初始化均值由 346.88ms 降至 187.35ms，数据库结构阶段由 67.51ms 降至 17.20ms，信源同步由 77.96ms 降至 3.03ms。两版均为 186 信源／78 公司、foreign_key_check=0、quick_check=ok。记录在 work/v0211/startup-{baseline,batched}.json。该数据只代表本机，不据此宣称 CI 主机的底层磁盘延迟原因已定位或启动超时已根治。

新增四项真实数据库验证：结构初始化故障完整回滚并重试、嵌套批次不提交外层、信源同步失败连同迁移／移除／版本回滚，以及公司同步故障／外层回滚后可重试且用户状态保留。专项初轮为 30／31，通过修正公司测试样本脚本的字符串语法后 31／31 通过，日志在 startup-atomic-tests.log 与 startup-atomic-tests-fixed.log。完整单元为 **886／886 通过**（13.82 秒，fail／cancelled／skip／todo=0），原始日志在 work/v0211/unit-startup-final.log。完整桌面与新候选包正在复验。

本轮完整桌面 **19／19 通过**（134.91 秒，fail／cancelled／skip／todo=0），原始日志 e2e-startup-final.log；生产审计 0 漏洞，47 项第三方声明再生成无 Git 差异。候选包重建、版本与 1271 项包边界通过：app.asar 13,413,951 B，安装器 99,546,559 B，PE 产品／文件版本 0.2.11，NotSigned，SHA-256 `b0c11d77ae3c7a23df06bb650d3305d3d652ce8ee35dcfbf5cc40f5b866f22c5`。五项本轮生产文件逐字节与 ASAR 核对一致，包装版本为 0.2.11；本机未运行安装器。记录在 build-startup-final.log、candidate-startup-metadata.json、audit-startup-final.log、notices-startup-final.log。新的精确提交 CI 与正式发布结果待补录。

## 正式工作流首轮取样失败

精确产品提交 24de27941a1fc8c7980c4172b6a81f4b9387099a 的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37410191348) 完整通过，886／886 单元、19／19 桌面、0 漏洞、47 项声明、1271 包边界与一次性装卸检查成功。注释 tag v0.2.11 已固定到该提交。

同一 tag 的 [Release 首轮](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37410913107/attempts/1) 为 886／886 单元、18／19 桌面：分层光感在 120ms 固定等待后的 CDP 读取中得到 core=210、halo=210.25406、rim=210，未满足暂态差大于 5px 的要求；目标为 210，读取时两层已到或接近目标。该记录支持“读取错过暂态”的解释，但没有原始帧时刻，因此不宣称已经量到准确延迟。其余新清理专项与既有桌面通过，构建和上传步骤未执行，没有正式 Release。失败记录在 work/v0211/release-failed-attempt1.{json,log}。

对原 tag／精确产品提交完整复跑既有 Release 工作流，断言、测试、默认超时与门禁不变。主分支后续测试改为在实际 pointermove 后，于真实渲染器 RAF 内连续记录最多 12 帧／300ms，再核对暂态近光更快及各帧边缘同步；保留差值和同步精度要求。该测试改动不进入正式产品 tag 或安装包，发布后的主分支回归另行验证。

帧内取样改动的本地动效专项 **5／5 通过**（32.62 秒，fail／cancelled／skip／todo=0），记录在 work/v0211/motion-frame-sampling.log。该后续提交只更新测试与失败记录，生产目录和版本文件相对 v0.2.11 tag 无差异；主分支完整 CI 结果另行补录。
