# 摘星阁 v0.2.31

新增三种经过打磨的跟手动效，让每位使用者选择适合自己的风格。

- 设置 → 显示与排版 → 跟手动效，保留范围柔光，新增流星拖尾、星尘粒子与弹性光环。流星为连续渐细的短光带；星尘稀疏散开、漂移并消散；光环带少许惯性与轻柔回弹，快速移动时适度舒展。
- 每种风格独立保存尺寸，可选任意六位颜色、八组配色预设与 10—100% 动效强度；修改立即生效并自动保存，重启后恢复。已有柔光选择、尺寸和颜色保留。
- 按帧合并鼠标输入，复用光点，限制轨迹与粒子数量；闲置后停止绘制，低性能档自动降低负担。四种样式持续掉帧时自动减少背景玻璃的合成开销，柔光保留主要光晕并减少次要装饰，保持跟手刷新。保留减少动态效果、高对比度、失焦和后台暂停，原生鼠标、表单、滚动与弹层操作保持可用。
- 应用、安装器、更新元数据与内置日志统一为 0.2.31，无新增运行依赖；已有情报、星标、归档、模型密钥与设置保留。

验证记录见 [v0.2.31 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0231-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.31.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者；可用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.31.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
