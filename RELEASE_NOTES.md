# 摘星阁 v0.2.40

修复 Windows 更新弹窗仍显示旧 Logo 的问题，并为自动清理增加可随时开启或关闭的开关。

- 统一最新图标：安装器、卸载器、应用窗口、托盘与系统更新通知使用当前的摘星阁 Logo。旧图标的原因是 Windows 图标生成链仍读取 v0.2.26 的 PNG；现改为从应用内最新静态 SVG 生成，构建时检查图标一致性。
- 更新通知：明确显示“已下载，选择重启安装完成更新”，点击通知打开摘星阁，由使用者决定何时安装。
- 自动清理开关：“设置 → 存储与清理 → 自动清理”新增开关，修改立即保存，重启后仍保留。关闭后不再定时清理过期情报；“立即清理”仍可使用。开启时沿用每天 08:25 随自动采集运行的安排，未开启自动采集时会明确提示。
- 升级保留原有清理设置与运行习惯，旧版本默认保持自动清理开启；星标、备忘、归档、密钥与已有设置均保留，没有新增运行依赖。
- 版本、安装器、更新元数据与内置日志统一为 0.2.40。

实现、测试与限制见 [v0.2.40 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0240-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.40.exe`。安装包仍未签名，Windows SmartScreen 可能提示未知发布者；可以用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.40.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
