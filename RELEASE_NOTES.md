# 摘星阁 v0.2.30

调整更新图标的动效与进度显示。

- 更新按钮出现后，中间箭头持续旋转，无需鼠标悬停；鼠标移入或键盘聚焦时，中间切换为实时下载百分比，移出后恢复旋转。
- 外圈始终显示真实下载进度，与中间百分比使用同一份进度数据；悬停、聚焦与移出不重置外圈。尚未取得下载进度时显示等待动效，不显示虚构百分比；下载完成后外圈填满，悬停提示 100% 和重启。
- 浅色、深色主题与四档界面缩放均适用，保留系统减少动态效果和窗口失焦时的动效降级，以及下载失败重试与重启安装入口。
- 应用、安装器、更新元数据与内置日志统一为 0.2.30，无新增运行依赖；已有情报、星标、归档、模型密钥与设置保留。

验证记录见 [v0.2.30 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0230-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.30.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者；可用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.30.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
