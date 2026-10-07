# 摘星阁 v0.2.29

修复设置卡片左上角光晕，统一全应用的西文、数字与符号字体。

- 删除“存储治理”和“每日新闻资料库”两张卡片的专属圆环与光晕装饰，恢复普通设置卡片的背景与玻璃材质，浅色、深色主题一致。
- 主界面、页面恢复和后端启动失败页面共用字体规则；西文、数字与符号优先采用 Times New Roman，原生表单、数字与日期输入、代码和快捷键文字采用相同字体。中文继续使用内置思源黑体。
- 应用、安装器、更新元数据与内置日志统一为 0.2.29，无新增运行依赖；已有情报、星标、归档、模型密钥与设置保留。

验证记录见 [v0.2.29 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0229-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.29.exe`。沿用未签名策略，Windows SmartScreen 可能提示未知发布者；可用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.29.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
