# 摘星阁 v0.2.10

本版更新左上角的版本标识，并让高频操作的运动更连贯、反馈更及时。

- **自动版本标识**：名称旁的 INTEL 替换为 `v0.2.10`，直接读取当前应用版本；以后更新自动显示新版本，网页预览同样读取服务端元数据。
- **导航连续改向**：选择块从实际运动位置继续滑动，快速切换不会积压动画；指示块尺寸一次落定，通过平移和缩放过渡。
- **筛选滑动选择块**：领域、分类、热点、一级市场分区与日报周期统一采用连续的弹簧运动，键盘操作同步生效。
- **触压光波与回弹**：鼠标按下和键盘触发都有短反馈，按钮光波有数量上限，结束后及时释放。
- **卡片局部追光**：情报卡与常用网址卡的柔光跟随鼠标，指针停止时暂停计算；正文和点击区域保持稳定。
- **主题与减少动画**：双主题、缩放和原有功能沿用；运行中开启减少动画会即时清理动效，低功耗关闭追光，隐藏窗口释放运动。原有数据、设置与字体保留，无新增依赖。

参考 [Apple 流畅交互设计](https://developer.apple.com/videos/play/wwdc2018/803/)、[Motion 动画性能指南](https://motion.dev/docs/performance/) 与 [Linear 官方设计说明](https://linear.app/now/behind-the-latest-design-refresh)，设计选择及实际验证详见 [v0.2.10 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0210-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.10.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.10.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
