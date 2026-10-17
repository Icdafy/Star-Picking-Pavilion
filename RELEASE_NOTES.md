# 摘星阁 v0.2.42

修复打开应用后 Windows 任务栏仍显示 Electron 默认图标的问题。全部静态 Logo 继续采用本次上传的原始 PNG，保留白色圆角底、金色星星与紫色弧线；主页面左上角原有 Logo 动效保持不变。

- 修复任务栏身份：开发版与正式版使用独立应用身份；每个窗口明确设置应用标识、图标、重新启动命令和显示名称，避免旧的 Electron 快捷方式参与正式应用分组。
- 升级已有快捷方式：正式版启动时更新桌面、开始菜单和固定任务栏中目标严格指向本应用 EXE 的快捷方式，仅更新图标与应用标识，保留名称、启动参数和其它应用链接。
- 统一静态图标：桌面快捷方式、任务栏、应用窗口、托盘、系统更新通知、安装器、卸载器、网页页签与系统更新页均使用本次上传的图案。
- 保留主页面动效：左上角继续使用原有 SVG 文件、悬停播放与首帧回退图，主题适配和播放行为保持不变。
- 图标来源明确：多尺寸 Windows ICO 从上传 PNG 生成，使用带版本号的资源路径；窗口和通知显式读取 PNG，构建与包校验继续检查图标一致性。
- 星标、备忘、归档、密钥、已有情报与全部设置均保留，没有依赖变更。
- 版本、安装器、更新元数据与内置日志统一为 0.2.42。

实现、测试与限制见 [v0.2.42 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0242-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.42.exe`。安装包仍未签名，Windows SmartScreen 可能提示未知发布者；可以用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.42.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
