# 摘星阁 v0.2.35

设置页新增核心功能“新闻推送”：绑定飞书、钉钉或 QQ 机器人后，摘星阁按你定的时间把新入选的情报推到手机。

- 三种机器人：飞书和钉钉群机器人用 Webhook 和加签密钥；QQ 走 OneBot v11（NapCat、Lagrange、LLOneBot），因为 QQ 官方机器人从 2025 年 4 月起停止了主动推送。飞书发消息卡片，钉钉发 Markdown，QQ 发纯文本，内容太长时按条目拆成几条发。
- 验证码绑定：填好连接信息后，摘星阁先向机器人发一个 6 位验证码。你在设置页输入手机上收到的验证码，绑定才算完成。验证码 10 分钟内有效，最多输错 5 次。Webhook、密钥、Token 和 QQ 号都经 Windows safeStorage 加密保存，界面和接口只显示掩码。
- 推送时间自己定：可以每 15 分钟到每天一次（按起始时刻对齐，例如每小时整点），也可以每天最多 12 个固定时刻；可选推送日和跨午夜的免打扰时段。应用关闭期间错过的推送，下次启动后 24 小时内只补一次。
- 推送内容：精选情报或全部相关动态；可选低空、航天或两者都要；可设每次条数和最低热度。按热度排序，每个机器人各自去重，同一事件只推一次。没有新情报时默认不发。
- 推送前可以预览本期内容，也能立即推送或发测试消息。最近推送、累计送达和每次结果都有记录。遇到限流或网络问题会自动退避重试两次，平台返回的错误码会转成具体的中文处理建议，例如关键词、签名、IP 白名单或 Token 设置不对。
- 推送由本机直接发给机器人平台，不经过第三方服务器。外部标题里的 Markdown 符号会被中和，链接只允许 http(s)，消息体按平台上限截断。
- 版本、安装器、更新元数据和内置日志统一为 0.2.35，没有新增运行依赖。已有情报、星标、归档、模型密钥和设置都会保留，推送默认关闭。

实现、测试与限制见 [v0.2.35 验证记录](https://github.com/Icdafy/Star-Picking-Pavilion/blob/main/docs/v0235-validation.md)。

## 安装与校验

下载 `Star-Picking-Pavilion-Setup-0.2.35.exe`。安装包仍未签名，Windows SmartScreen 可能提示未知发布者；可以用附件 `SHA256SUMS.txt` 核对安装包。

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.2.35.exe
Get-Content .\SHA256SUMS.txt
```

安装器、blockmap、latest.yml、SHA256SUMS.txt、CycloneDX SBOM 与第三方声明由 GitHub Actions 完整门禁生成；安装、启动、单实例、退出和卸载烟测在一次性 Windows CI 执行。
