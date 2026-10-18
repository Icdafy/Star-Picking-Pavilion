# 摘星阁 v0.2.43

适配 DeepSeek-V4.1-Flash-1017，并新增显示器刷新率自动匹配与 60 / 70 / 120 / 144Hz 四档动效设置。

- 最新 Flash 模型：内置模型统一使用 `deepseek-flash`，设置页显示 DeepSeek V4.1 Flash 1017；旧 Flash 模型名在配置迁移、获取模型、连接测试和实际请求中统一归一，原生图文能力继续可用。官方于 2026-10-17 更新该别名对应的模型，调用方式与价格保持不变，详见 [DeepSeek 官方更新日志](https://api-docs.deepseek.com/zh-cn/updates/)。
- 自动匹配本机：默认“自动（推荐）”，优先读取窗口所在显示器的系统刷新率，跨屏移动、显示器增减、恢复前台与刷新率变化后重新匹配；系统未提供有效值时使用前台帧间隔测量。
- 四档手动设置：在“设置 → 氛围与动效”中选择 60Hz、70Hz、120Hz 或 144Hz，查看检测值、应用值与检测来源，也可重新检测。仅保存个人选择，每台电脑独立检测硬件；手动选择不会改变显示器设置，应用值不超过检测到的屏幕刷新率。
- 动效节奏一致：导航、分段选择、跟手反馈与流体动画按实际经过的时间推进，采样密度匹配刷新率；支持 59.94 / 119.88 等分数频率，保留其他常见刷新率的自动识别。减少动态效果、后台暂停与低功耗降级继续生效。
- 旧版 Flash 结果缓存按本次模型版本隔离，后续分析可使用新版模型；已有情报、星标、备忘、归档、密钥及其他设置保留，无依赖变更。
- 版本、安装器、更新元数据与内置日志统一为 0.2.43。

实现、测试与限制见 [v0.2.43 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0243-validation.md)。适配覆盖四档的逻辑与实际桌面交互；不同电脑的 GPU、负载和驱动仍影响实际帧率，60Hz 屏幕的物理帧数保持为 60Hz。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.43.exe`。安装包仍未签名，Windows SmartScreen 可能提示未知发布者；可以用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.43.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
