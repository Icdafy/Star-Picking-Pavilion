# 摘星阁 v0.2.4

DeepSeek V4.1 Flash 与键盘优先的命令面板版，保留数据库、星标、备忘、偏好与已保存的各提供商密钥；旧设置里选中的退役 DeepSeek 模型在首次启动时自动改指 V4.1 Flash。

- **DeepSeek V4.1 Flash**：DeepSeek 于 2026-09-10 发布 V4.1 Flash，官方模型 ID 是 `deepseek-flash`（不叫 v4.1-flash）。此前设置 → 模型里找不到它，是因为 DeepSeek 内置目录仍只登记了已退役的 `deepseek-v4-flash-vision-exp`。现在内置目录与 DeepSeek `/models` 的实际返回一致：`deepseek-flash`（DeepSeek V4.1 Flash，原生图文，默认分析模型）与 `deepseek-v4-pro`（文本）。已用真实密钥验证 `/models`、图片理解与文本推理。
- **退役模型自动迁移**：V4 Flash 与 V4 Flash Vision Exp 已退役，旧名目前只是官方的临时兼容路由。设置里的 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-chat`、`deepseek-reasoner` 启动时自动改指 V4.1 Flash，免得兼容路由关闭那天精选链突然失效。
- **命令面板（Ctrl+K）**：参照 Linear、Raycast、Vercel 的 ⌘K 范式，跳转视图、执行操作（采集、实时开关、主题、词库、复制／导出、提报信源、收录公司、缩放、回顶）与检索情报库共用一个入口。中文名、拼音全拼、拼音首字母与英文别名都能命中——`rb` 到情报日报、`yjsc` 到一级市场、`model` 到设置；没有命中时回车即在情报库中检索该词；最近用过的命令排在最前。输入框里也能唤起，屏幕阅读器按 combobox 朗读。
- **键盘优先**：先按 `G` 再按字母跳转视图（`G F` 精选、`G H` 热点、`G C` 一级市场、`G D` 日报、`G ,` 设置……）；`J / K` 在卡片与热点事件间逐条移动，`O` 打开原文、`S` 星标、`C` 复制、`E` 展开关联报道；`?` 打开面板。侧栏悬停提示和设置页速查表同步列出全部快捷键。
- **性能**：样式预算、脚本数、关键帧数都没有上调——命令面板复用既有对话框材质与开合过渡，腾挪空间来自字体分片索引的无损压缩。

**公众号限制**：商业航天发展三个用户提供链接仍要求微信环境验证，保留入口并标为受限，不能声称采集成功。

## 下载与校验

安装包：`Star-Picking-Pavilion-Setup-0.2.4.exe`。此版本尚未代码签名，Windows SmartScreen 可能提示未知发布者；签名状态预期为 NotSigned。请核对 SHA256SUMS.txt 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.4.exe
Get-Content .\SHA256SUMS.txt
```

附带 blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明。GitHub Actions 完成测试、包检查与安装／卸载烟测后发布。
