# Security Policy

## Supported versions

安全修复只面向最新发布版本。当前支持系列为 `0.0.x`。

## Reporting a vulnerability

请通过 GitHub 仓库的 **Security → Report a vulnerability**（Private vulnerability reporting / Security Advisories）私下提交报告。不要在公开 Issue、讨论区或社交媒体中披露尚未修复的漏洞。

报告请包含受影响版本、可复现步骤、影响范围、必要的日志或最小化样例，以及你建议的缓解方式。请移除 API Key、内部网址、数据库内容和其他个人或组织敏感数据。

维护者会尽快确认收到报告，并在完成复现与影响评估后协调修复及披露时间。请在修复发布前给予合理处理窗口。

## Security boundaries

摘星阁只把本地 API 暴露在随机 `127.0.0.1` 端口，并使用每次启动随机令牌。AI Key 由 Electron `safeStorage` 加密。应用仍会主动访问用户启用的资讯源、模型服务、常用网址和 GitHub 更新服务；这些外部服务不属于本项目的安全边界。
