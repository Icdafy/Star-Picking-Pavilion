# 摘星阁｜研究工作台浅色版 v2 提示词

Use case: ui-mockup

Asset type: one high-fidelity 16:9 desktop application screenshot, light theme, shippable B2B research workstation.

Input images: Image 1 is the visual-quality and brand-style reference. Rebuild the screen as a UX-correct v2; preserve its premium warm-white palette, typography, icon language, jade/indigo/gold accents and overall product identity, but do not preserve its inefficient layout literally.

Primary request: Redesign “摘星阁” as a normal, highly usable research workstation rather than a decorative command-center dashboard. Represent every real repository function through clear information architecture and contextual entry points, while keeping only high-frequency research and action states on the overview screen.

### Layout

- Full-screen, straight-on 16:9 desktop UI, no browser chrome or device frame.
- Warm pearl canvas, white matte surfaces, deep ink text, quiet gray borders.
- Left rail with six primary destinations only: “总览”, “情报”, “日报与归档”, “信源”, “工作台”, “设置”. Selected: “总览”.
- Bottom of rail: compact “桌面守护” block with “后台驻留 · 开”, “登录启动 · 开”, “v0.0.15”; trust copy “核心数据本地保存 · 凭据由 Windows 加密”.
- Header: “情报总览”, “2026年8月4日”, badge “演示数据”.
- Global search exact placeholder: “检索标题、摘要与实体”. Include “Ctrl K” and a compact adjacent tool button “词库 207”.
- Clear on/off toggle labeled “持续监测”; primary action “立即采集分析”.

### Runtime summary

Use one very light, single-line operational summary instead of five boxed status cards:

“AI研判 · 已配置” · “采集调度 · 每30分钟” · “界面自动刷新 · 开启” · “上次分析 · 2分钟前” · “7个信源需关注” · “下次归档 · 明日08:00”

No undefined “storage healthy” claim and no eight-stage live telemetry.

### KPI

Preserve an integrated, compact funnel with exact demonstration data:

“今日捕获 1,284” → “相关情报 86” → “今日精选 12”

Secondary values: “待分析 18”, “监控信源 103 / 113”, “星标 24”. Keep the “演示数据” badge visible.

### Main research workspace

Use a 7/5 content split.

Left panel title “情报”. Page-level tabs: “精选 12”, “热点”, “全部动态”, “星标 24”. Place scope controls inside this panel, not in the global header:

- segmented domain control “全部领域”, “低空经济”, “商业航天”;
- category dropdown “全部分类”;
- compact button “6 条新情报”;
- “复制列表” and “导出 ▾”. The export menu concept contains Markdown and plain text.

Show four scannable intelligence items. First item is selected but remains in summary state, using a jade left accent rather than a full warning-colored border.

First item exact content:

- Title: “可回收火箭完成海上垂直回收验证”.
- Metadata: “国家航天局·官网 · T1 · 4源印证 · 21:42”.
- Badges: “商业航天”, “发射与任务”, “AI研判”, “技术突破 +10”.
- Scores: “质量 94”, “热度 98°”; render heat in amber/gold, not error red.
- Summary: “完成关键技术验证，多源报道一致，后续关注复用周期与商业发射节奏。”
- Analysis label and copy: “情报研判” / “验证结果提升可复用路线可信度，短期看发射节奏，中期看成本曲线。”
- Actions: “关联报道 4”, “复制”, “星标”, “展开研判详情”.
- Do not show five score bars, entity chips or an atomic-event row until expanded.

Three compact items below:

1. “eVTOL 型号取得生产许可证，量产节点前移” · “低空经济” · “政策法规” · “AI研判” · “质量 91” · “热度 95°”.
2. “卫星互联网星座启动新一轮组网发射” · “商业航天” · “发射与任务” · “本地规则” · “质量 89” · “热度 92°”.
3. “低空空域改革试点扩大至六个城市” · “低空经济” · “政策法规” · “待分析”.

### Right rail

Card “当前热点”: three ranked items with amber heat values and a clear hover/click arrow. Keep “多源印证”.

Replace the decorative source-health donut with an action-first card titled “信源状态”:

- “103 / 113 正在监控”
- “7 个需关注”
- Row 1: “虎嗅 · 连续失败 5 次 · 暂停至 23:40” with action “解除退避”.
- Row 2: “RSSHub·SpaceNews · 未配置实例”.
- Row 3: “Google News·商业航天 · 已停用”.
- Footer action “查看全部信源”.
- Use red only for genuine failure, amber for paused/degraded, gray for disabled.

Card “研究归档”:

- Status “已排程”.
- “最近成功 · 8月4日 08:00”.
- “下次归档 · 8月5日 08:00”.
- “待补存 · 0”.
- Green continuity line “后台保障已开启”.
- File summary “Markdown · JSONL · 校验清单”.
- Actions “保存最近一期” and “管理归档”.

Do not show the eight-stage pipeline on the overview. Give the released vertical space to the fourth intelligence item and more breathing room.

### Product rules and states

- Normal product UI, content-first, progressive disclosure, strong provenance and action affordances.
- Heat and technical breakthroughs are amber; quality is jade; low-altitude is teal; commercial-space is indigo; red is reserved for errors.
- The six primary destinations cover all functions through nested pages: 情报 contains four views; 日报与归档 contains history/export/archive; 信源 contains management/health; 工作台 contains core lexicon/common links/memo; 设置 contains AI/credentials, collection/RSSHub, retention/storage, tray/autostart, theme/scale/shortcuts and updates.
- Do not render all secondary settings on the overview.
- Exact Simplified Chinese, no random glyphs, no lorem ipsum, no invented extra copy.
- No global map, flight paths, entity graph, opportunity/risk scores, AI chat, predictions, team collaboration, cloud sync, stock widgets, browser frame, excessive glassmorphism, cyberpunk neon, 3D or watermark.

Output intent: a premium light-mode intelligence research product that feels calm, rigorous, trustworthy and immediately usable at 1440×920, with a credible responsive path down to 800×600.

