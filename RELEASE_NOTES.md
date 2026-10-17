# 摘星阁 v0.2.41

按本次上传的原始 PNG 统一摘星阁静态 Logo，保留白色圆角底、金色星星与紫色弧线；主页面左上角原有 Logo 动效保持不变。

- 统一静态图标：桌面快捷方式、任务栏、应用窗口、托盘、系统更新通知、安装器、卸载器、网页页签与系统更新页均使用本次上传的图案。
- 保留主页面动效：左上角继续使用原有 SVG 文件、悬停播放与首帧回退图，主题适配和播放行为保持不变。
- 图标来源明确：多尺寸 Windows ICO 从上传 PNG 生成，构建与包校验继续检查图标一致性。
- 星标、备忘、归档、密钥、已有情报与全部设置均保留，没有依赖变更。
- 版本、安装器、更新元数据与内置日志统一为 0.2.41。

实现、测试与限制见 [v0.2.41 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0241-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.41.exe`。安装包仍未签名，Windows SmartScreen 可能提示未知发布者；可以用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.41.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
