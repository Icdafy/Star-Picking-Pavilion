# 摘星阁 v0.2.9

本版修复标题栏与右侧滚动条的重合，并检查、更新及清理资讯信源。已有设置、数据库、星标、日报、模型密钥和研究归档保留。

- **标题栏延展**：背景完整铺到窗口右边，正文从标题栏下方独立滚动，滚动条顶部不再进入标题栏。侧栏、工具栏与日期分组继续吸顶；回顶、实时更新阅读位置、原生拖拽、滚轮与键盘已接入新的滚动视口。
- **信源清理**：删除 35 个监控入口，包括全部 31 个原停用项及 4 个持续空结果或不可达项。保留 186 个信源，最终严格复查为 **186 成功、0 空结果、0 失败**。
- **检索更新**：东财搜索对齐官网高亮参数，同主机串行限速，200 空正文只重试一次；空响应、错误码及异常结构明确报错。
- **升级保留**：首次升级清理旧库停用入口，历史文章和来源归属保留。后续手工停用仍可启用，停用项也可从列表移除；明确提报同地址可恢复原来源。主题、减少动画及 v0.2.8 原始设置沿用，无新增依赖。

信源实测、布局与发布检查详见 [v0.2.9 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v029-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.9.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者。请核对 `SHA256SUMS.txt` 后安装。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.9.exe
Get-Content .\SHA256SUMS.txt
```

正式安装包、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由既有 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。

## 发布验证

[main CI](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37328372503) 和 [Release 工作流](https://github.com/Icdafy/Star-Picking-Pavilion/actions/runs/37329530254) 均通过：876 项单元测试、14 项真实桌面测试（含 112 种布局组合）、0 生产依赖漏洞、1,271 项包边界检查，以及安装／启动／单实例／退出／卸载检查。六项正式附件已重新下载，尺寸和 GitHub 摘要全部匹配；安装包 PE 版本与更新元数据均为 0.2.9。

正式安装包为 99,540,524 字节，SHA-256：

```text
6437810808cecd72daa51e80e6c7d4d1cec0aaca038ddcfe1ee6f7f337e11769
```
