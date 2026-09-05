# 摘星阁 v0.1.4

本版增强图文情报与事件时间核验，并统一内部、安装包与公开版本为 0.1.4。

- 常规预筛、图文识别与结构化使用 deepseek-v4-flash-vision-exp；复杂多事件、首飞适航、重大政策、融资事故使用 deepseek-v4-pro 思考模式。
- 补取正文并分析最多 4 张有效图片，火箭、卫星、零部件、图纸与图表可附于新闻下方，注明 AI 解读和原文来源。
- 原子事件新增日期、完成/计划/失败状态与逐字证据。官方一手原站或两个独立媒体的一致日期证据才能确认，无法确认显示待核实；明确转载与聚合入口不能重复计票。
- 右上角提示事件日期与报道日期的时差（北京时间自然日）；已确认日期用于排序与热度，迟报仍进入采集日归档。
- 新增 18 路产业链检索。公众号安全采集支持公开文章及公开 RSSHub/Wechat2RSS 订阅，限定双行业、限速、遵守 robots，遇登录验证暂停。公众号订阅需自行配置实例，内置接入位默认关闭。
- 移除 v0.1.3 一次性更新桥，package.json、安装器、tag 与 latest.yml 均为 0.1.4。旧 v0.1.2 内部同号客户端可手动安装本版。旧数据、星标、密钥和既有归档保留，升级后最近30天内最多200条已采纳消息会渐进重判，其余未经本版分析的历史条目标记待核实。

## 下载与校验

本版本尚未代码签名，Windows SmartScreen 可能提示未知发布者。请从本项目 Release 下载，核对 SHA256SUMS.txt 后安装。

安装包：`Star-Picking-Pavilion-Setup-0.1.4.exe`

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.1.4.exe
Get-Content .\SHA256SUMS.txt
```

附带 blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明。
