# 摘星阁（Star-Picking-Pavilion）

摘星阁是一款面向低空经济与商业航天信息的 Windows 桌面情报站。它在本机聚合信源、检索与聚类文章，并可选择使用用户自己配置的 OpenAI 兼容模型进行五维评分和情报研判。

## 系统要求与安装

- Windows 10/11 x64
- 无需另行安装 Node.js、数据库或浏览器

从 [GitHub Releases](https://github.com/Icdafy/Star-Picking-Pavilion/releases) 下载 `Star-Picking-Pavilion-Setup-0.0.5.exe`，双击并按向导安装。v0.0.5 尚未进行代码签名，因此 Windows SmartScreen 可能显示“Windows 已保护你的电脑”；请先核对校验值，再选择“更多信息 → 仍要运行”。

下载 `SHA256SUMS.txt` 后，可以在 PowerShell 中验证安装包：

```powershell
Get-FileHash -Algorithm SHA256 .\Star-Picking-Pavilion-Setup-0.0.5.exe
Get-Content .\SHA256SUMS.txt
```

两处 SHA-256 必须完全一致。自动更新只从本项目的 GitHub Releases 检查；下载完成后，应用右上角会提示重启安装。

## 主要功能

- 精选、热点与全部动态信息流
- 低空经济、商业航天领域和分类筛选
- SQLite FTS5 全文检索与多源事件聚类
- 每日情报简报和实时增量提示
- RSS、网页、公开 API 与 RSSHub 信源管理
- 可选的 AI 五维评分、摘要与研判
- “云幄 · 常用网址”本地快捷入口与键盘焦点保持
- 深色和浅色主题
- 自动记住主题、最后视图、领域与分类、日报日期、常用网址分类与星标、实时更新开关
- 可选的关闭到系统托盘与 Windows 登录自动启动，两项默认关闭、可独立设置
- 数据保留策略与本地库体积视图，过期情报连同全文索引自动清理
- 失效信源自动退避重试，避免长期不可达的信源每轮空转

信源被“移出监控”时只会停用，既有信源记录和历史文章不会被删除。

## 桌面后台运行

「设置 → 桌面运行」提供两个相互独立的开关，升级后均保持关闭：

- 关闭主窗口后在后台运行：关闭窗口时继续采集，可从系统托盘选择“打开摘星阁”；要彻底结束应用和本地后端，请在托盘菜单选择“退出摘星阁”。
- 登录 Windows 时自动启动：仅正式安装的 Windows 版本支持。若同时开启后台运行，登录后会静默启动；否则照常显示主窗口。

托盘初始化失败时，摘星阁会保留可见主窗口并显示固定提示，避免应用在没有恢复入口时隐藏。登录启动状态以 Windows 系统设置的回读结果为准，不写入 `ui-preferences.json`。这两项设置不会改变凭据加密、网络访问、AI 分析、数据保留或信源策略。

## 数据保留与信源健康

摘星阁通常长期驻留运行，因此本地库需要有进有出。「设置 → 数据维护」可以看到库内情报数、实际占用空间与待清理条数，并调整两档保留天数：

- 情报保留天数：默认 180 天，可设 7 到 3650 天
- 无关内容保留天数：默认 21 天，用于被判为无关的噪声；该值不会超过情报保留天数

清理每天在日报之后 20 分钟自动执行，也可以随时手动触发。到期条目连同 FTS5 全文索引行一起删除，成员不足的事件簇随之收敛，清理结束后截断 WAL 让磁盘占用真正回落。日报是自包含快照，保留期独立且更长。

连续采集失败的信源会按指数拉长重试间隔（从一个采集周期起，上限 6 小时），成功后立即复位。信源页会显示暂停状态与连续失败次数，可点「立即重试」清除退避；点击右上角「立即采集分析」时始终忽略退避，全量重试一遍。

## AI 与隐私

默认的关键词启发式模式不调用 AI 服务。只有在设置页配置 API Key 后，摘星阁才会把待分析文章的标题、摘要等选定文本发送到你配置的模型服务；数据处理规则、费用和留存政策由该模型服务提供方决定。

API Key 不写入 `settings.json`，而是通过 Electron `safeStorage` 使用当前 Windows 用户的系统加密能力保存。更换电脑或 Windows 账户后，应重新输入 Key。

应用还会按功能需要访问用户启用的资讯信源、RSSHub、常用网址和 GitHub 更新服务。常用网址会交给系统默认浏览器打开；公开发行前必须确认其中不包含未经授权的内部链接。

## 本地数据、备份与卸载

正式安装版数据位于 `%APPDATA%\摘星阁`，主要文件包括：

- `star-picking-pavilion.db`：信源、文章、日报和反馈
- `settings.json`：不含 API Key 的普通设置
- `credentials.v1.json`：由 `safeStorage` 加密的 AI 凭据
- `ui-preferences.json`：版本化的界面选择，不含 API Key、搜索词或未提交表单
- `migration-v0.0.1.json`：旧版数据迁移记录，不含秘密

备份前请完全退出摘星阁，再复制 `%APPDATA%\摘星阁\star-picking-pavilion.db` 和需要的设置文件。恢复数据库时也应先退出应用。跨电脑恢复后，建议运行应用确认数据库完整性并重新配置 API Key。

超过保留天数的文章会被自动清理，若需要长期归档请提前备份，或把保留天数调高。

卸载程序会保留 `%APPDATA%\摘星阁` 中的用户数据，方便重装或升级。若确实不再需要这些数据，请在确认备份后由用户自行删除该目录。

旧版 `%APPDATA%\捕风司\windcatcher.db` 或旧“摘星阁”数据库会在首次启动时通过 SQLite 一致性备份迁移；原文件不会被覆盖或删除。

## 安全模型

- 桌面后端只监听 `127.0.0.1` 的随机端口，并由每次启动生成的随机令牌保护 API。
- 渲染进程启用 sandbox、上下文隔离和严格 CSP，默认拒绝摄像头、麦克风、定位等权限。
- 远程链接和图片只允许绝对 HTTP(S) URL，外链由系统浏览器打开。
- 请求体限制为 64 KiB，配置文件采用原子替换，数据库启动时运行完整性检查。
- 安装包使用严格文件白名单并扫描 ASAR，数据库、日志、工作树和本机配置不会被打包。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露尚未修复的漏洞。

## 从源码开发

需要 Node.js 22+ 与 npm 10+。

```powershell
npm ci
npm test
npm run test:e2e
npm run audit:runtime
npm start
```

常用维护命令：

```powershell
npm run server              # 独立开发服务器，默认 http://127.0.0.1:7644
npm run pipeline            # 手动采集、分析、聚类
npm run dist                # 生成 Windows 安装包，不发布
npm run verify:package      # 审计 ASAR、文件边界和体积
npm run verify:version -- --tag v0.0.5 --artifacts
npm run notices
```

桌面模式使用随机端口；上面的 7644 只用于显式运行独立开发服务器。发布步骤与隐私门禁见 [RELEASING.md](RELEASING.md)。

## 许可证与致谢

项目以 [MIT License](LICENSE) 发布。生产依赖许可见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。

信息筛选理念参考 [AIHOT](https://aihot.virxact.com/)；“云幄 · 常用网址”视图来源于原云幄工作流的本地整合。
