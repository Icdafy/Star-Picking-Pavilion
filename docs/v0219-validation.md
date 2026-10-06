# v0.2.19 实现与发布验证

验证日期：2026-10-06。目标仓库 Icdafy/Star-Picking-Pavilion，目标版本 0.2.19。

## 实现

本版仅调整报告概况日期网格的垂直对齐。`.daily-date-controls` 使用 `align-self: start`，日期及两侧方向标整体稍微上移；标题、字号、横幅尺寸和三项统计保持。日报、周报、月报共用样式，无新增依赖。

## 本地验证

真实 Electron 48 组几何复核覆盖宽窄窗口、四档缩放、双主题及三种刊期。1440 宽、标准缩放日期中心相对 v0.2.18 上移 7.984375px，800 宽、标准缩放上移 1.15625px。48 组横幅高度变化均为 0，标题与导航最小间距 3.5px。截图已复核。

完整单元 913／913 通过，22.44 秒，fail／cancelled／skipped／todo 均为 0。生产依赖审计 0 漏洞，第三方声明 47 项，内置更新日志 47 条。

本地候选构建及包边界、版本、PE 和更新元数据检查通过：ASAR 1,274 项、13,638,484 B；安装器 99,593,707 B，产品／文件版本 0.2.19，NotSigned，SHA-256 为 `997334878a213b64c44be5b1f27ea95879f676a28587701e267a5984db17b161`。latest.yml 的版本、文件名、尺寸及两处 SHA-512 与候选安装器一致。

完整桌面回归 24／24 通过，263.18 秒，fail／cancelled／skipped／todo 均为 0。既有 160 组布局、48 组刊期、32 组更新入口及 96 组配色检查保留；复制、文件导出、菜单键盘操作与重新生成专项通过。安装／启动／单实例／退出／卸载烟测仅在一次性 Windows CI 执行。

本地证据位于 `work/v0219`：`final-ui/inspect-geometry.json`、截图、position-verification.json、unit.log、electron-complete.log、runtime-audit.log、build.log、package-audit.log、artifact-version.log、candidate-installer.json、candidate-update-metadata.json。

## 发布状态

尚未推送本版 tag；main CI 完整通过后触发原 Release 工作流，再核验六项公开附件。

main 首轮为 913／913 单元、22／24 桌面：原有 layout 矩阵在主题绑定阶段出现 Electron 主进程执行上下文销毁，原有 v0211 动效采样没有观察到核心层领先光晕层超过 5px 的瞬态。日期导航及报告导出专项通过。两项原样本地补验 2／2 通过，43.56 秒。同一提交重跑为 913／913 单元、23／24 桌面，layout 通过，仍仅有旧动效采样失败。两轮失败日志、结果和补验记录均保留；首轮窗口执行上下文失败的原因尚未定位。

两轮动效失败各只捕获四帧，后续间隔约 125ms。隔离复现将观察器的首次采样延迟 450ms，后续采样间隔设为 125ms：原实现漏掉瞬态而失败。测试现在先取得首帧，再执行第二次真实原生鼠标移动，采样上限由 300ms 延至 1000ms；正常及同一粗粒度观察器验证通过，核心领先光晕 >5px、核心与轮廓差 <0.1px、正文与命中区不移动等原断言及 90 秒用例时限均保留。应用代码仍只修改日期对齐，动效引擎未更改。

采样复现证据为 slow-before.log、slow-after.log、motion-sampling.log；两轮 CI 证据为 main-ci-first.log／result.json、main-ci-second.log／result.json，原样本地补验为 failed-checks-local.log。修正后的完整动效文件 5／5 通过，32.58 秒；新提交 CI 验证进行中。原始帧位置记录保存在 layer-frames.json。
