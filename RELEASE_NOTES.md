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

## 发布验证

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37412899916) 与 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37413400871) 均完整通过：886／886 单元、19／19 真实桌面（112 布局组合）、0 生产漏洞、47 项声明和 1271 包边界，fail／cancelled／skip／todo 为 0。一次性 Windows 安装、启动、单实例、退出与卸载成功，用户数据保留。

六项正式附件重新下载核验，尺寸与 GitHub SHA-256 摘要全部匹配。正式安装器 99,544,789 B，PE 产品／文件版本 0.2.11，签名 NotSigned；SHA-256 为 914b5a02ce5a88e0e79a51a0c439255bb3025567ba991df7f01b5a67d8951392。latest.yml 的版本、文件名、尺寸及两处 SHA-512 均与实际安装器匹配，SBOM 为 CycloneDX 1.6、产品 0.2.11，第三方声明与提交一致。
