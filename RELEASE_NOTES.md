# 摘星阁 v0.2.17

本版升级工作区更新按钮和整个前端的动效基础：主题更新珠、更清晰的外环，以及文字、跟手、下拉、展开和图形之间连贯的弹簧反馈。

- **主题更新珠**：更新按钮基准直径从 44px 增至 52px，外环与玻璃内芯分层，图标、百分比和状态文字加大。正常与完成状态跟随外观色相，浅色、深色主题各六套流体配色及云母／兼容材质共用清晰的前景与底色；错误保留明确的语义提示。修正旧背景将渐变变量当作颜色而失效的问题。
- **加粗环形下载进度**：SVG 外环描边从 2.2 增至 3.4，增加约 55%，同步加强轨道层次。真实下载进度平滑变化，未知进度保持连续旋转，检查、最新、下载、重试和重启的状态文字及图标连续过渡；下载完成后仍由用户点击重启安装。
- **弹簧跟手与图形**：更新内芯、导航图标和工具图标随鼠标轻微偏移，页头星轨提供弹簧视差，卡片保留多层追光与触压波纹。装饰层移动时按钮命中范围和正文保持稳定；鼠标离开后回弹并释放节点，没有常驻的交互动画循环。
- **文字与滚入**：页头眉题、标题和说明按语义层次错峰入场，星轨独立展开；设置章节进入视口时轻柔呈现。中文保持完整可选、可复制与读屏顺序。快速切换从当前视觉帧接续，选择块沿用携带速度的连续弹簧。
- **下拉与展开收起**：报告导出菜单及原生弹窗增加一致的入场反馈，菜单在 Escape、外点或切换刊期时立即关闭；核心词库、更新日志和模型详情通过裁切展开，卡片研判展开时相邻内容用 FLIP 平滑移位、五维条形图从左侧填充。状态立即生效，保留原生 Enter、Escape、焦点返回及键盘操作；展开高度一次提交，动画主要交给 transform／opacity。
- **动效与可访问性**：减少动画直接落定，低功耗设备缩短过渡并关闭追光与跟手，失焦或后台暂停并清理临时样式、动画和装饰节点。保留高对比度、进度语义和分段播报；已有情报、星标、归档、模型密钥、日期导航与设置保留。无新增运行依赖、脚本标签、动画关键帧或玻璃滤镜。

设计参考 [Linear 的主题与界面层次](https://linear.app/now/how-we-redesigned-the-linear-ui)、[Raycast 的原生交互实现](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)、[Fluent 2 动效](https://fluent2.microsoft.design/motion)、[Motion 弹簧跟随](https://motion.dev/docs/spring-value)与 [错峰编排](https://motion.dev/docs/stagger)。使用本项目原生 CSS、SVG 和 Web Animations 实现。实现与验证见 [v0.2.17 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0217-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.17.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.17.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
