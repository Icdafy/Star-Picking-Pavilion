# 摘星阁 v0.2.11

本版进一步提升跟手动效：版本标识、导航与筛选继续同步当前状态，卡片和控件的光感更有层次。

- **分层追光**：卡片加入贴近指针的柔光、缓随远光与沿边缘亮起的高光，快速扫过时柔和交接；领域颜色与双主题同步。
- **磁吸光晕**：导航、筛选和操作按钮的光晕轻微随指针偏移，文字与点击区域保持稳定。
- **连续弹簧**：选择块从实际视觉位置改向，并继承当前弹簧速度；玻璃高光与轻回弹让连续切换更自然。
- **触压光波**：鼠标与键盘触发柔和光环，反馈有数量和寿命上限。
- **主题与减少动画**：双主题、缩放与原有数据设置沿用。静止后停止逐帧计算；低功耗、强制颜色和减少动画关闭追光与磁吸，滚动、隐藏与失焦及时清理。
- **冷启动优化**：合并数据库结构、默认信源和公司种子的初始化写入，减少磁盘同步；失败回滚，历史数据、星标和用户备注保持原有语义。

参考 [Olivier Larose 磁吸按钮](https://blog.olivierlarose.com/tutorials/magnetic-button)、[Apple 弹簧动画](https://developer.apple.com/videos/play/wwdc2023/10158/)、[Motion 指针反馈](https://motion.dev/docs/cursor)与 [Linear 界面设计](https://linear.app/now/behind-the-latest-design-refresh)，在现有原生 JS / WAAPI 架构中实现，无新增依赖。具体实现和验证见 [v0.2.11 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0211-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.11.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.11.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
