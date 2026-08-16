# 摘星阁 v0.1.0.1

v0.1.0.1 从视觉底座解决标题栏与 Aqua 界面割裂的问题，并将 v0.1.0 的近似动态背景替换为 DSH Transparent UI Plugin 1.1.0 的实际图形实现。数据库、HTTP API、用户数据目录、情报处理、壁纸资产和业务设置保持兼容，可直接覆盖升级。

## DSH Aqua 1.1.0 复刻

- 流体背景改用插件 1.1.0 的 WebGL 反馈着色器，不再以二维 Canvas 近似；扰动、旋涡、反馈衰减、呼吸光和深浅调色板均来自插件实现契约。
- 星鲸改用插件 1.1.0 的粒子引擎，保留其骨架、粒子连线、尾迹、指针响应与主题配色。
- Aqua Glass Lab 默认值同步插件：模糊 2、磨砂 20、流体色相 316、明暗 50、壁纸模糊/磨砂 0、星鲸开启。
- 玻璃渐变、深浅色亮度方向和 DSH 数据属性完成对齐；低功耗、页面不可见与系统“减少动态效果”场景继续安全降级。
- DSH 复用代码作为独立可审计模块打包，来源、MIT 许可和 John Wu 版权信息已写入第三方声明。

## 标题栏与界面一体化

- Electron 原生窗口采用与 DeepSeek Harness 官方桌面外壳一致的隐藏叠加标题栏方案。
- 标题栏背景透明叠加在 Aqua 画布上，深色按钮使用浅色符号、浅色按钮使用深色符号；切换主题时由主进程同步更新窗口背景、覆盖层和系统主题。
- 主页面、启动失败页和运行失败页均使用 `env(titlebar-area-*)` 预留安全区和拖拽区，内容不会被窗口控制按钮遮挡。
- 深色窗口基色锁定为官方 Harness 的 `#151517`，浅色为 `#ffffff`，从启动到页面就绪不再闪现异色标题带。

## 兼容性

- 公开 tag、Release 标题、安装包名与 Windows 文件版本为 `0.1.0.1`。
- npm 和 electron-updater 内部版本为 SemVer `0.1.1`，使已安装的 v0.1.0 能正确识别本次更新；`latest.yml` 继续符合 electron-updater 规范。
- 数据库表结构、HTTP API、用户数据目录、信源、星标、日报、研究归档、加密 API Key 与壁纸资产格式均未改变。
- 缺少新 Aqua 参数的旧偏好会按 DSH 1.1.0 默认值补齐；已有主题、缩放、视图与业务筛选继续保留。

## 只读参照边界

- `F:\AI\DeepSeek Harness 官方` 仅用于只读分析窗口主题、标题栏安全区和主题同步机制。
- 本版本未修改、复制打包或发布该目录中的用户数据、缓存、日志及其他文件。
- DSH Transparent UI Plugin 1.1.0 的复用范围和许可信息可在 `THIRD_PARTY_NOTICES.txt` 中审计。

## 验证

- 单元、集成、窗口主题契约、响应式布局及真实 Electron E2E 全部纳入发布门禁。
- 深色实机窗口已核验原生标题栏与流体背景连续融合；浅色、四档缩放和 800×600 至 1920×1080 由自动化布局矩阵覆盖。
- 发布包继续执行 ASAR 白名单、生产依赖、敏感文件、许可资源、SHA-256 与 CycloneDX SBOM 检查。

## 下载与校验

本版本尚未进行代码签名，因此 Windows SmartScreen 可能显示“Windows 已保护你的电脑”或“未知发布者”。请只从本项目 GitHub Release 下载：

- `Star-Picking-Pavilion-Setup-0.1.0.1.exe`
- `SHA256SUMS.txt`

下载后在 PowerShell 中执行：

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.1.0.1.exe
Get-Content .\SHA256SUMS.txt
```

确认两处 SHA-256 完全一致后再安装。校验值不一致时请停止安装，并重新从本项目 Release 页面下载。
