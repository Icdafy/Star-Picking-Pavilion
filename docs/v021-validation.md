# v0.2.1 发布验证

2026-09-29 本地候选版本验证：

- `npm test`：823 项通过。
- `npm run test:e2e`：4 项通过，包含重启、单实例、4 档窗口与 4 档缩放、核心视图布局、企业搜索、深浅下拉选项及氛围开关持久化。
- `npm run audit:sources -- --strict`：168 条默认启用来源全部返回条目，0 空、0 请求失败。种子共 199 条，31 条按配置停用。条目返回不代表每条均为相关融资，后续仍需行业预筛和事实抽取。
- `npm run audit:runtime`：0 漏洞。
- `npm run dist`、`verify:package`、`verify:version -- --tag v0.2.1 --artifacts`：通过；候选 ASAR 13,142,533 字节，安装包 99,489,846 字节。CI 产物可能因构建环境不同而有字节差异，以 Release 校验值为准。
- 安装器签名状态：NotSigned。
- 本地历史数据库使用 SQLite 在线备份复制到独立目录后验证：升级前后 3319 篇文章不变，完整性检查 ok，迁移幂等；原库未改动。此副本尚无融资行，融资与别名历史合并另有合成记录测试覆盖。

发布由 `.github/workflows/release.yml` 对精确 tag 提交重新执行测试、构建、包检查、临时 Windows runner 安装／启动／单实例／卸载烟测，再生成 SHA-256、SBOM 和 Release。

已知边界见 [AIHOT 核对](aihot-integration-audit.md) 与 [公众号及信源实测](v021-sources.md)。不将受限公众号或未移植功能描述为已完成。
