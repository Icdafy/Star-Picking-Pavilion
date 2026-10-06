# 摘星阁 v0.2.13

本版统一升级情报工作区页头横幅，重新整理情报日志的操作与报告概况，并加入轻柔的文字与星轨动效。现有情报、星标、归档、模型密钥与个人设置继续保留。

- **页头横幅**：精选、全部动态、星标、一级市场、更新日志、常用网址、信源和设置采用统一的栏目标识、主标题、说明与右侧状态或操作区。三种信息流各有对应的标题和文案；原有的公司收录、日志同步、网址计数与信源提报入口保留。宽窄窗口和浅色、深色主题同步适配，矮窗口也能看到页头。
- **文字与星轨动效**：切换页面时，栏目、标题与说明分层轻柔入场；背景星轨缓慢运行，栏目标识轻闪。动效由本地样式与已有运动引擎实现，无外部图片请求。低功耗模式停止持续星轨与轻闪，减少动画模式保留静态效果，失焦或后台暂停，高对比度模式隐藏装饰。
- **统一工具栏**：情报日志的日报、周报、月报切换与复制日报、导出 .md、重新生成合并为一条横幅。出刊节奏随周期切换；周报和月报继续保留原有操作范围，不显示日报专属操作。
- **报告概况**：独立横幅位于工具栏正下方，集中展示报告日期、状态、生成信息、日期切换与三项统计。日报展示精选情报、低空经济与商业航天数量，周报和月报展示精选情报、热点事件与资本事件；读取时清除旧统计，失败时显示重试提示，避免上一期数据残留。

设计参考 [Linear 的页头层次与界面重设计](https://linear.app/now/how-we-redesigned-the-linear-ui)、[shadcn/ui 的控制台布局](https://ui.shadcn.com/examples/dashboard)与 [Vercel 界面设计准则](https://vercel.com/design/guidelines)，结合摘星阁 Aqua 材质实现。无新增运行依赖、脚本标签或动画关键帧。实现和验证记录见 [v0.2.13 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0213-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.13.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.13.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
