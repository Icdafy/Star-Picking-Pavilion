# v0.2.8 验证记录

## 原始设置

2026-10-05 用户明确指定“以我当前本机的设置为原始设置”。取已安装应用的有效偏好，并仅提取公开设置；源码开发目录中的旧设置不作为基准。

| 项目 | 新用户原始值 |
| --- | --- |
| 主题／字号 | light／md（浅色／标准） |
| 模式／模糊／磨砂 | mica／2／20 |
| 背景类型／色相／亮度 | fluid／40／42 |
| 背景效果／星鲸／星空 | false／false／false |
| 壁纸模糊／磨砂 | 0／0 |
| 启动页面／领域／分类／日报日期 | featured／空／空／null |
| 网址分类／收藏 | 督办计划／空数组 |
| 实时／关闭到托盘 | true／false |
| 采集间隔／日报时间 | 60 分钟／08:00 |

`renderer/ui-preference-schema.js` 的不可变定义为原始偏好的唯一来源，Electron 配置、浏览器初始化和外观恢复默认共用。已有 `ui-preferences.json` 优先；加载不写盘。旧版未保存过的字段使用 v0.2.7 的缺省值。没有原生文件但有浏览器设置时，现代 JSON 优先于旧键迁入，保留 false、0 与空数组。原生文件存在时不让浏览器缓存盖过它。

`settings.json` 仍逐字段保留有效值，已有文件的采集间隔缺省值保持 10，新用户为 60。应用 ID、用户数据目录与卸载保留设置不变。API 密钥、数据库、历史内容、个人壁纸和归档路径未作为原始状态发布。

## 设计参考与实现

- [Radix Scroll Area](https://www.radix-ui.com/primitives/docs/components/scroll-area)：保留浏览器原生滚动与键盘语义，借鉴胶囊滑块与悬停反馈。
- [Mantine ScrollArea](https://mantine.dev/core/scroll-area/)：轨道尺寸、内容间隔与滚动区域分工明确。
- [Chromium 官方滚动条样式说明](https://developer.chrome.com/docs/css-ui/scrollbar-styling)：避免非 auto 的标准滚动条属性覆盖伪元素定制。
- [MDN scrollbar-color](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-color)、[scrollbar-gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter)：主题颜色与稳定占位。

这是依据上述官方资料做出的本项目设计选择，未引入 React 组件或滚动模拟库，也未声称存在客观“最顶级”排名。

主滚动轨道在 html 与 body 上同时留出标题栏高度加 4px，底部留 4px；Chromium 的实际窗口滚动条会从 body 取样式。内部列表不留此空白。14px 轨道内 8px 胶囊，悬停／拖拽 10px；流动背景使用当前目标色相，深浅主题使用不同明度，壁纸及关闭背景时用中性色；强制颜色模式使用 Canvas／CanvasText／Highlight。

不改变 window 的滚动容器。拖拽、滚轮、Ctrl+Home／End、吸顶导航与阅读位置保留逻辑继续工作。没有新增依赖、脚本标签、关键帧或滤镜，性能预算不变。

## 验证与修正

- 新增 4 项配置回归：准确的新用户默认状态；完整旧配置的全部字段和文件字节保留；部分旧配置的隐含默认值；现代浏览器偏好迁移与首次绘制主题。
- 新增 2 项真实 Electron 测试：新目录启动、原生窗口主题、服务端默认采集间隔、保存后重启；12 组配色、主轨道和内部列表边界、真实拖拽、滚轮、键盘回顶／到底、关闭背景及强制颜色模式。
- 对标题栏边界进行真实截图像素检查，防止只检查 CSS 计算值而漏掉实际滑块越界。图像留在被忽略的 `work/v028/screenshots/`，不进入运行包。
- 初始测试曾在页面脚本初始化前取值、将原生颜色的大小写当差异，或将系统悬停色限定为黑色；已修正测试取值时机与颜色语义，没有更改应用以满足这些错误假设。
- 第一版仅限定 html，截图显示滑块仍从顶部开始；实际修复 body 的窗口滚动轨道，加入像素断言。测试资源清理顺序和重复关闭句柄也已修正。失败日志保留在 `work/v028/`。
- 针对新功能的最终桌面测试：2/2 通过，fail／skip／todo 均 0。完整门禁及发布结果在下方记录。

## 发布记录

本地完整回归：874/874 单元、14/14 桌面测试，fail／skip／todo 均 0；原有 112 个布局组合仍完整运行。生产依赖审计 0 漏洞，47 项第三方声明已随版本更新，1,270 项包边界检查通过。CSS 总量 294,122 B，预算 299,008 B 未变。

本地候选包：app.asar 13,393,797 B，安装器 99,543,364 B；PE 产品版本与 latest.yml 均为 0.2.8，签名状态 NotSigned，安装器 SHA-256 `65ad0fc5d16255ea9e6e1471176dfe2a264fd7943e783224a69e050a9292a58c`。本机只构建与检查，没有运行安装器。正式 CI 构建的哈希以 Release 资产为准。

完整矩阵初次失败于旧测试对默认网址分类“全部”的假设；该测试改为先明确选择“全部”，仍验证原来的 14 项目录，没有减少断言。随后一次旧桌面重启测试在第二个窗口前遇到进程关闭，与 v0.2.7 的未定位启动风险相符；原样单测诊断 1/1 通过（关闭 284／375 ms），最终完整矩阵 14/14 通过（关闭 292／270 ms）。未给测试增加重试、延长超时或放宽断言；该风险未宣称根治。

2026-10-05 在线信源严格复查：190 条启用信源，40 成功、0 空结果、150 失败，均报 `Unexpected end of JSON input`。相同东财相关性请求直接探测返回 0 字节，故严格复查不通过；保留失败记录，不将接口故障计为采集成功。信源与采集器未在此版本修改。这项在线可用性检查不在既有 CI／Release 工作流内，正式发布仍必须通过所有既有门禁。

2026-10-05 正式 [Release v0.2.8](https://github.com/Icdafy/Star-Picking-Pavilion/releases/tag/v0.2.8) 已发布并设为最新正式版，draft=false、prerelease=false。注释 tag 对象 `78e5a64007ee6d5f7909ad334844957bfb6a0c9e` 解引用为 `befc8a4c77c2381fd86cd24416c6d21f127aa9e6`，与发布源提交一致；该精确提交的 [main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37317993152) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37319279803) 全部成功。

正式 Release 门禁：874/874 单元、14/14 真实桌面测试，fail／cancelled／skip／todo 均 0；生产依赖审计 0 漏洞、47 项第三方声明无差异、1,270 项包边界检查通过。一次性 Windows runner 完成安装、启动、单实例、关闭、卸载检查，并确认用户数据保留。没有更改既有工作流或绕过门禁。

六项正式附件下载到新隔离目录 `work/v028/published-37319279803/`，尺寸及 GitHub SHA-256 摘要全部匹配。正式安装器 99,541,704 B，SHA-256 为 `174a914d0bf54250877cd03644b2b8a5c7b8913c245215db13a8471174d9c2d4`，与 SHA256SUMS.txt 一致；PE 产品／文件版本均为 0.2.8，签名状态 NotSigned。latest.yml 的版本、文件名、尺寸与实际 SHA-512 一致；SBOM 为 CycloneDX 1.6，主组件版本 0.2.8；第三方声明版本匹配。正式 CI 的 app.asar 为 13,401,894 B，其字节数与本地候选包不同，正式安装器校验值以上述公开附件为准。

原始证据保留在被忽略的 `work/v028/`：`main-ci.log`、`release-ci.log`、隔离下载目录中的发布／最新版本元数据、`verification.json` 与 `pe-metadata.json`。发布后仅补文档和 Release 说明，产品代码、tag 与六项附件保持已经验证的版本。
