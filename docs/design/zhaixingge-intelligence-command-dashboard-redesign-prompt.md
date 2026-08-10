# 摘星阁｜情报指挥总览重设计图提示词

Use case: ui-mockup

Asset type: one high-fidelity desktop web application dashboard concept image, 16:9 landscape, straight-on full-screen product screenshot, suitable for a 4K design presentation.

Primary request: Design a world-class, production-ready Chinese intelligence operations dashboard for “摘星阁 / STAR-PICKING PAVILION”. Base the interface strictly on the repository’s real functions, while completely reimagining the information architecture and visual system. Do not imitate the existing frontend or the older concept image.

Product truth: 摘星阁 is a local-first Windows intelligence workstation for two domains only: 低空经济 and 商业航天. Its real workflow is multi-source collection, cleaning and deduplication, relevance filtering, optional AI five-dimensional scoring, entity and atomic-event extraction, event clustering, semantic merging, selected/hot feeds, search, lexicon lookup, star/copy/export, daily brief, local 08:00 research archive, source health, and storage governance.

Visual direction: elite mission-control clarity blended with premium editorial intelligence software. Deep midnight ink background (#070A12), matte blue-black panels (#0D1421), hairline borders (#202A3A), crisp off-white text (#F4F7FB), calm muted text (#8894A8). Use restrained accents only: jade teal (#4FD8B5) for 低空经济, orbital indigo (#7386FF) for 商业航天, solar amber (#F3B85B) for 技术突破 and selected intelligence, muted coral (#EF6A6A) for failures. Subtle constellation-grid texture at under 3% opacity; no literal space photo. Very restrained ambient glow, mostly flat matte surfaces. Precise 12-column grid, 8-point spacing system, generous negative space, 14–18 px corner radii, elegant 1 px separators, strong alignment. Large tabular numerals and highly legible Simplified Chinese grotesk typography. Dense but calm, authoritative, and immediately usable.

Composition and hierarchy:

1. Left navigation rail, about 230 px wide.
   - Original small star-orbit emblem and brand “摘星阁”, with subtle English subtitle “STAR-PICKING PAVILION”.
   - Selected item: “总览”.
   - Group “情报”: “精选”, “热点”, “全部动态”, “星标”.
   - Group “研究”: “情报日报”, “研究归档”, “信源监控”, “核心词库”.
   - Group “工作台”: “常用网址”, “情报备忘”.
   - Group “系统”: “存储治理”, “设置”.
   - Bottom trust label: “仅存本机 · v0.0.15”.

2. Top command bar.
   - Page title “情报总览” and date “2026年8月4日”.
   - Small quiet badge “演示数据”.
   - Wide global search field with exact placeholder “检索核心词、实体与事件” and shortcut capsule “Ctrl K”.
   - Domain segmented control: “全部”, “低空经济”, “商业航天”.
   - Green live status “实时捕捉”.
   - Primary button “立即采集分析”.

3. One slim continuity/status ribbon directly below the command bar, with five evenly spaced states and tiny precise icons:
   - “本地服务 · 正常”
   - “AI研判 · 已配置”
   - “实时采集 · 开启”
   - “下次归档 · 8月5日 08:00”
   - “存储状态 · 健康”
   This ribbon must feel like an operational trust chain, not a row of oversized cards.

4. A compact KPI strip using one integrated information funnel plus three secondary counters.
   - Integrated funnel: “今日捕获 1,284” → “相关情报 86” → “今日精选 12”. Use progressively brighter hierarchy, not a chart invented from unsupported historical data.
   - Secondary counters: “待分析 18”, “监控信源 103 / 113”, “星标 24”.
   - Include tiny, tasteful context labels, but no trend percentages and no fabricated forecasting.

5. Main content uses a 7/5 split.

   Left, large “精选情报” workspace:
   - Header tabs: “精选 12”, “热点”, “全部动态”, “星标 24”.
   - Small filter chips: “全部分类”, “政策法规”, “技术研发”, “发射与任务”, plus actions “复制列表” and “导出 .md”.
   - The first intelligence item is selected and expanded as the focal card. Exact title: “可回收火箭完成海上垂直回收验证”.
   - Metadata: “官方一手 · T1 · 4 源印证 · 21:42”.
   - Badges: “商业航天”, “发射与任务”, “技术突破 +10”.
   - Score capsules: “质量 94” and “热度 98°”.
   - Exact summary: “完成关键技术验证，多源报道一致，后续关注复用周期与商业发射节奏。”
   - Exact analysis label and copy: “情报研判” / “验证结果提升可复用路线可信度，短期看发射节奏，中期看成本曲线。”
   - Five explainable score bars with exact labels and values: “重要性 96”, “新颖度 88”, “可信度 94”, “行业影响 92”, “时效性 97”.
   - Entity chips: “可回收火箭”, “海上回收平台”, “推进系统”.
   - Atomic event row: “原子事件  可回收火箭 · 完成验证 · 海上垂直回收”.
   - Footer actions: “关联报道 4”, “复制”, “星标”.
   - Below it, two compact but readable intelligence rows:
     - “eVTOL 型号取得生产许可证，量产节点前移” with badges “低空经济”, “政策法规”, scores “质量 91”, “热度 95°”.
     - “卫星互联网星座启动新一轮组网发射” with badges “商业航天”, “发射与任务”, scores “质量 89”, “热度 92°”.

   Right operational rail:
   - Card “当前热点”, ranked 01–03 with heat values 98°, 95°, 92° and concise versions of the three titles above. Show a small “多源印证” cue, not a social-media trending metaphor.
   - Card “信源健康” with a clean segmented ring or horizontal distribution and exact values: “正常 96”, “退避 4”, “连续失败 3”, “停用 10”. Add secondary line “103 个信源正在监控” and a subtle action “查看信源”.
   - Card “研究归档” with green state “已启用”, “最近成功 8月4日 08:00”, “下次归档 8月5日 08:00”, “待补存 0”. Show three small file pills: “新闻简报.md”, “news.jsonl”, “manifest.json”, plus button “立即保存”.

6. Full-width bottom pipeline strip, elegant and compact, titled “八段式处理管线”. Show a connected sequence with completed checks and one small status “本轮完成”:
   “结构化” → “清洗” → “预筛” → “标注” → “实体提取” → “原子事件” → “聚类” → “语义合并”.
   Do not show fabricated per-stage timing, percentages, pausing, cancelling, or task orchestration.

Interaction language: polished desktop-product UI with clear selected, hover-ready, toggle, badge, chip, button, and status states. The interface should look shippable, responsive, and accessible, not like a mood board or concept art.

Text requirements: Render all visible Simplified Chinese exactly as specified, with crisp legible characters. Use no lorem ipsum, no random Chinese-like glyphs, no extra headings, and no repeated labels. If dense copy conflicts with legibility, preserve the key headings, scores, navigation, and article titles and simplify secondary copy; never invent text.

Constraints: one coherent full-screen dashboard only; no browser chrome; no device frame; no perspective; no people; no photographs; no watermark; no third-party logos; no decorative globe; no global map; no geographic nodes or flight paths; no enterprise relationship graph; no opportunity score; no risk score or risk-alert center; no monitoring-task builder; no standalone AI chat; no model-confidence percentage; no prediction or investment advice; no user accounts, team collaboration, cloud sync, or approval workflow; no stock market widgets; no orbit visualization; no excessive glassmorphism; no neon cyberpunk; no giant gradients; no oversized empty hero area; no tiny unreadable text; no visual clutter.

