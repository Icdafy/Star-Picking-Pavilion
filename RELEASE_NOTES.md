# 摘星阁 v0.2.2

一级市场深化与免费信源扩容版，保留数据库、星标、备忘与偏好；升级时一次性合并历史重复融资并补全转载出版方。

- **AIHOT 同步**：对照上游至 885b736，移植 Atom XHTML 标题摘要、无时区列表日期按信源时区、周报月报迟到资料归属与事件关系评测工具（`npm run eval:relations`）；合入外部内容导入入口。
- **一级市场**新增默认分区「**市场概览**」：五项指标，融资阶段、金额量级、月度节奏、热门赛道、大额融资、上市进程与活跃机构；融资动态支持阶段、事件性质、排序筛选与 CSV／Markdown 导出。
- 上市公司定增、债权与融资租赁、合资设立单独归类，不再混入一级市场统计；同一笔融资的全称、简称与母品牌写法合并，“未披露”轮次由后续报道补全。公司库新增 13 家近期有真实融资报道的公司。
- **交易所上市进程**：接入上交所科创板、深交所创业板／主板 IPO 审核项目公开接口，每次审核状态变化生成一条资料（首轮含中科宇航、蓝箭航天、微纳星空、腾盾科创）。
- **免费信源扩容 24 个**：11 条带资本守卫的一级市场检索线、投中网融资、泰伯网、无人机网与 5 个海外航天／eVTOL RSS，均于 2026-09-30 实测可用。
- **当前热点**更准：同一批次开出的重复事件自动合并；东方财富转载按“文章来源”计真实出版方，不再把检索线重复计为独立信源。日报、周报、月报的融资按入库时间归属，旧报道补抽的融资不再漏计。
- 信源监控台新增搜索、状态／类型／领域筛选与运行统计。两次独立评分、事件归组、刊期继续使用 deepseek-v4-flash-vision-exp。

[AIHOT 整合审计](https://github.com/Icdafy/Star-Picking-Pavilion/blob/v0.2.2/docs/aihot-integration-audit.md)：本地为核心流程的桌面适配，并非上游全部云端功能整仓移植。[v0.2.2 信源实测](https://github.com/Icdafy/Star-Picking-Pavilion/blob/v0.2.2/docs/v022-sources.md)。

**公众号限制**：商业航天发展三个用户提供链接仍要求微信环境验证，保留入口并标为受限，不能声称采集成功。Crunchbase News、SpaceNews、Payload、DroneLife 等海外 RSS 对应用请求返回 403，未接入。

## 下载与校验

安装包：`Star-Picking-Pavilion-Setup-0.2.2.exe`。此版本尚未代码签名，Windows SmartScreen 可能提示未知发布者；签名状态预期为 NotSigned。请核对 SHA256SUMS.txt 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.2.exe
Get-Content .\SHA256SUMS.txt
```

附带 blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明。GitHub Actions 完成测试、包检查与安装／卸载烟测后发布。
