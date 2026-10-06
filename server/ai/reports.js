'use strict';
// 日报、周报、月报 —— AIHOT reports/compose.ts 的桌面版。
//
// 每一期都是同一个结构：导语 · 热点事件 · 分类精选（同一事件只出现一次）· 一级市场（融资事件、
// 公司热度、活跃机构）· 我的关注（关注 / 被投公司的动态）· 技术突破。
// 组稿纯代码完成，1 秒内出刊；导语先用代码写一版“事实型”导语，调度器在有 Key 时
// 再用 report-lead.md 让模型改写（只用本期输入里的事实），改写结果写回同一期。
// 读者打开日报不会触发模型调用。
//
// 刊期窗口按采集时间（fetched_at）归属：每条资料只属于一期，迟到的新闻不会永久漏掉。
// 周报 / 月报再进一步（AIHOT de46b70）：按“采集与归组完成两者较晚的时刻”归属——上期结束前采到、
// 结束后才判完的资料进入下一期，不会被已定稿的上一期和按采集时间计的下一期同时漏掉。
// 融资事件按入库（first_seen_at）归属：报道日期更早、本期才补抽出来的融资同样计入本期。
//   日报：前一日 08:00（不含）– 当日 08:00（含），与每日研究归档同一口径
//   周报：ISO 周，周一 00:00 – 下周一 00:00（本地时间）
//   月报：自然月
const { db, now } = require('../db');
const industry = require('../industry');
const { chat, extractJson } = require('./deepseek');
const { withReceipt } = require('./receipts');
const { modelFor } = require('./model-policy');
const { neutralize } = require('./editorial');
const { SECTION_ORDER } = require('../archive/daily-bundle');
const { localDateString } = require('../date-time');

const DOMAIN_LABEL = { lowaltitude: '低空经济', aerospace: '商业航天' };
const KINDS = new Set(['weekly', 'monthly']);

function pad(n) { return String(n).padStart(2, '0'); }

// ---------- 刊期 ----------
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400e3 + 1) / 7) };
}

function periodKeyOf(kind, date = new Date()) {
  if (kind === 'weekly') {
    const { year, week } = isoWeek(date);
    return `${year}-W${pad(week)}`;
  }
  if (kind === 'monthly') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  throw new Error(`未知刊期类型: ${kind}`);
}

function previousPeriodKey(kind, date = new Date()) {
  const d = new Date(date);
  if (kind === 'weekly') d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1, 1);
  return periodKeyOf(kind, d);
}

function resolvePeriod(kind, key) {
  if (kind === 'weekly') {
    const m = /^(\d{4})-W(\d{2})$/.exec(String(key || ''));
    if (!m) throw Object.assign(new Error('周报期号格式应为 YYYY-Www'), { status: 400 });
    const year = Number(m[1]);
    const week = Number(m[2]);
    if (week < 1 || week > 53) throw Object.assign(new Error('周报期号超出范围'), { status: 400 });
    // ISO 第 1 周包含 1 月 4 日
    const jan4 = new Date(year, 0, 4);
    const monday = new Date(year, 0, 4 - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    return { kind, key, start: monday.toISOString(), end: end.toISOString(),
      label: `${year} 年第 ${week} 周（${pad(monday.getMonth() + 1)}-${pad(monday.getDate())} 至 ${pad(last.getMonth() + 1)}-${pad(last.getDate())}）`,
      periodLabel: '周报' };
  }
  if (kind === 'monthly') {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw Object.assign(new Error('月报期号格式应为 YYYY-MM'), { status: 400 });
    const start = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    const end = new Date(Number(m[1]), Number(m[2]), 1);
    return { kind, key, start: start.toISOString(), end: end.toISOString(), label: `${m[1]} 年 ${Number(m[2])} 月`, periodLabel: '月报' };
  }
  throw Object.assign(new Error('未知刊期类型'), { status: 400 });
}

// ---------- 取数 ----------
function parseJson(raw, fallback) {
  try { const v = JSON.parse(raw || ''); return v ?? fallback; } catch { return fallback; }
}

function itemOf(row) {
  return {
    id: row.id,
    title: row.title_zh || row.title,
    originalTitle: row.title_zh && row.title_zh !== row.title ? row.title : null,
    url: row.url,
    summary: row.ai_summary || (row.summary_raw || '').slice(0, 140),
    reason: row.ai_reason || null,
    source: row.source_name,
    tier: row.tier,
    domain: row.domain,
    category: row.category,
    score: Number(row.attention_score ?? row.quality_score) || null,
    featured: Boolean(row.featured),
    storyId: row.cluster_id || null,
    storySize: row.cluster_size || null,
    breakthroughScore: Number(row.breakthrough_score) || 0,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at
  };
}

const ITEM_COLUMNS = `a.id, a.title, a.title_zh, a.url, a.ai_summary, a.ai_reason, a.summary_raw, a.domain, a.category,
  a.attention_score, a.quality_score, a.featured, a.cluster_id, a.breakthrough_score, a.published_at, a.fetched_at,
  s.name AS source_name, s.tier, cl.size AS cluster_size`;

// fetched：按采集时间；released：按 max(采集, 归组完成)，尚未归组的资料等归组后进入当期
function windowPredicate(basis = 'fetched') {
  return basis === 'released'
    ? 'a.grouped_at IS NOT NULL AND MAX(a.fetched_at, a.grouped_at) > ? AND MAX(a.fetched_at, a.grouped_at) <= ?'
    : 'a.fetched_at > ? AND a.fetched_at <= ?';
}

function windowRows(start, end, extra = '', basis = 'fetched') {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM articles a JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.relevant = 1 AND ${windowPredicate(basis)} ${extra}
    ORDER BY COALESCE(a.attention_score, a.quality_score) DESC, a.id DESC LIMIT 5000`).all(start, end);
}

// 同一事件只出现一次：取事件里分数最高的一篇
function foldByStory(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.storyId ? `s:${item.storyId}` : `a:${item.id}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function hotInWindow(start, end, limit) {
  const rows = db.prepare(`SELECT ss.story_id, COUNT(DISTINCT ss.participant_key) AS participants, COUNT(*) AS reports,
      GROUP_CONCAT(DISTINCT ss.participant_name) AS names
    FROM story_signals ss JOIN clusters c ON c.id = ss.story_id AND c.merged_into IS NULL
    WHERE ss.observed_at > ? AND ss.observed_at <= ?
    GROUP BY ss.story_id HAVING participants >= 2
    ORDER BY participants DESC, reports DESC LIMIT ?`).all(start, end, limit);
  return rows.map(row => {
    const story = db.prepare('SELECT * FROM clusters WHERE id = ?').get(row.story_id);
    const main = story ? db.prepare(`SELECT ${ITEM_COLUMNS} FROM articles a JOIN sources s ON s.id = a.source_id
      LEFT JOIN clusters cl ON cl.id = a.cluster_id WHERE a.id = ?`).get(story.main_article_id) : null;
    if (!story || !main) return null;
    return {
      storyId: story.id,
      title: story.title || main.title_zh || main.title,
      digest: story.digest || null,
      domain: story.domain || main.domain,
      category: story.category || main.category,
      participants: row.participants,
      reports: row.reports,
      sources: String(row.names || '').split(',').filter(Boolean).slice(0, 6),
      representative: itemOf(main)
    };
  }).filter(Boolean);
}

function dealsInWindow(start, end) {
  const { listDeals } = require('./deals');
  return listDeals({ seenWindow: [start, end], limit: 200 });
}

function companyBoard(start, end, limit = 15, basis = 'fetched') {
  return db.prepare(`SELECT c.id, c.name, c.domain, c.segment, c.status, c.watch,
      COUNT(DISTINCT a.id) AS reports, COUNT(DISTINCT COALESCE(a.participant_key, 'source:' || a.source_id)) AS participants,
      SUM(a.featured) AS featured
    FROM article_companies ac JOIN articles a ON a.id = ac.article_id JOIN companies c ON c.id = ac.company_id
    WHERE ac.role = 'primary' AND a.relevant = 1 AND ${windowPredicate(basis)}
    GROUP BY c.id ORDER BY participants DESC, reports DESC, featured DESC LIMIT ?`).all(start, end, limit)
    .map(r => ({ id: r.id, name: r.name, domain: r.domain, segment: r.segment, status: r.status, watch: r.watch,
      reports: r.reports, participants: r.participants, featured: r.featured || 0 }));
}

function investorsOf(deals, limit = 10) {
  const board = new Map();
  for (const deal of deals) {
    for (const name of deal.investors) {
      const e = board.get(name) || { name, deals: 0, leads: 0 };
      e.deals++;
      if (deal.leadInvestors.includes(name)) e.leads++;
      board.set(name, e);
    }
  }
  return [...board.values()].sort((a, b) => b.deals - a.deals || b.leads - a.leads).slice(0, limit);
}

function portfolioUpdates(start, end, basis = 'fetched') {
  const rows = db.prepare(`SELECT c.id AS company_id, c.name AS company_name, c.watch, ${ITEM_COLUMNS}
    FROM article_companies ac JOIN companies c ON c.id = ac.company_id AND c.watch > 0
    JOIN articles a ON a.id = ac.article_id JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.relevant = 1 AND ${windowPredicate(basis)}
    ORDER BY c.watch DESC, COALESCE(a.attention_score, a.quality_score) DESC`).all(start, end);
  const byCompany = new Map();
  for (const row of rows) {
    const entry = byCompany.get(row.company_id) || { id: row.company_id, name: row.company_name, watch: row.watch, items: [] };
    if (entry.items.length < 3 && !entry.items.some(i => i.storyId && i.storyId === row.cluster_id)) entry.items.push(itemOf(row));
    byCompany.set(row.company_id, entry);
  }
  return [...byCompany.values()];
}

// 事实型导语：没有 Key、或模型改写之前使用。只拼本期数据，不做判断。
function factualLead({ label, totals, hot, sections, deals }) {
  const parts = [`${label}共收录两行业相关情报 ${totals.relevant} 条，精选 ${totals.featured} 条。`];
  if (hot[0]) parts.push(`讨论最集中的事件是「${hot[0].title}」（${hot[0].participants} 个独立信源）。`);
  for (const domain of ['lowaltitude', 'aerospace']) {
    const top = sections.flatMap(s => s.items).filter(i => i.domain === domain).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (top) parts.push(`${DOMAIN_LABEL[domain]}方面，${top.title}。`);
  }
  if (deals.length) {
    const named = deals.slice(0, 3).map(d => `${d.companyName}${d.round !== '未披露' ? d.round : ''}`).join('、');
    parts.push(`一级市场记录融资与资本事件 ${deals.length} 起，包括${named}${deals.length > 3 ? '等' : ''}。`);
  }
  return parts.join('');
}

// 组稿：给定窗口，出一期的全部版块
function composeIssue({ start, end, label, periodLabel, perSection = 8, hotLimit = 8, basis = 'fetched' }) {
  const rows = windowRows(start, end, '', basis);
  const items = rows.map(itemOf);
  const featured = foldByStory(items.filter(i => i.featured));
  const sections = SECTION_ORDER.map(category => ({
    category,
    items: featured.filter(i => i.category === category).slice(0, perSection)
  })).filter(s => s.items.length);
  const hot = hotInWindow(start, end, hotLimit);
  const deals = dealsInWindow(start, end);
  const breakthroughs = foldByStory(items.filter(i => i.breakthroughScore >= 0.5))
    .sort((a, b) => b.breakthroughScore - a.breakthroughScore).slice(0, 8);
  const totals = {
    collected: db.prepare('SELECT COUNT(*) c FROM articles WHERE fetched_at > ? AND fetched_at <= ?').get(start, end).c,
    relevant: items.length,
    featured: items.filter(i => i.featured).length,
    stories: new Set(items.map(i => i.storyId).filter(Boolean)).size,
    deals: deals.length
  };
  const byDomain = {
    lowaltitude: featured.filter(i => i.domain === 'lowaltitude').length,
    aerospace: featured.filter(i => i.domain === 'aerospace').length
  };
  return {
    label,
    periodLabel,
    window: { start, end, basis: basis === 'released' ? 'released_at' : 'fetched_at' },
    generatedAt: now(),
    totals,
    byDomain,
    lead: factualLead({ label, totals, hot, sections, deals }),
    leadSource: 'factual',
    hot,
    sections,
    deals: deals.slice(0, 40),
    investors: investorsOf(deals),
    companies: companyBoard(start, end, 15, basis),
    portfolio: portfolioUpdates(start, end, basis),
    breakthroughs
  };
}

// ---------- 周报 / 月报 ----------
function readPeriod(kind, key) {
  const row = db.prepare('SELECT content_json, created_at FROM period_reports WHERE kind = ? AND period_key = ?').get(kind, key);
  if (!row) return null;
  try { return JSON.parse(row.content_json); } catch { return null; }
}

function generatePeriod(kind, key, { overwrite = false } = {}) {
  if (!KINDS.has(kind)) throw Object.assign(new Error('未知刊期类型'), { status: 400 });
  const period = resolvePeriod(kind, key || periodKeyOf(kind));
  if (Date.parse(period.start) > Date.now()) throw Object.assign(new Error('刊期尚未开始'), { status: 400 });
  const existing = readPeriod(kind, period.key);
  const finished = Date.parse(period.end) <= Date.now();
  // 已结束的刊期是定稿；进行中的刊期 30 分钟内复用，之后重新组稿（保留模型导语直到数据变化）
  if (existing && !overwrite && (finished || Date.now() - Date.parse(existing.generatedAt) < 30 * 60e3)) return existing;
  const issue = composeIssue({ start: period.start, end: new Date(Math.min(Date.parse(period.end), Date.now())).toISOString(),
    label: period.label, periodLabel: period.periodLabel, perSection: kind === 'monthly' ? 12 : 10, hotLimit: kind === 'monthly' ? 15 : 10,
    basis: 'released' });
  const content = { kind, key: period.key, finished, ...issue, window: { ...issue.window, periodEnd: period.end } };
  if (existing?.leadSource === 'model' && existing.totals?.featured === content.totals.featured && existing.totals?.deals === content.totals.deals) {
    content.lead = existing.lead;
    content.leadSource = 'model';
  }
  db.prepare(`INSERT INTO period_reports (kind, period_key, content_json, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(kind, period_key) DO UPDATE SET content_json = excluded.content_json, created_at = excluded.created_at`)
    .run(kind, period.key, JSON.stringify(content), now());
  return content;
}

function listPeriods(kind) {
  if (!KINDS.has(kind)) return [];
  const stored = db.prepare('SELECT period_key FROM period_reports WHERE kind = ? ORDER BY period_key DESC LIMIT 60').all(kind).map(r => r.period_key);
  const current = periodKeyOf(kind);
  const previous = previousPeriodKey(kind);
  return [...new Set([current, previous, ...stored])].sort().reverse();
}

// ---------- 导语改写（仅调度器、仅有 Key 时） ----------
function leadInput(issue) {
  const lines = [`【刊期】${issue.label}`, `【统计】相关 ${issue.totals.relevant} 条，精选 ${issue.totals.featured} 条，融资与资本事件 ${issue.totals.deals} 起`];
  if (issue.hot?.length) lines.push('【热点事件】', ...issue.hot.slice(0, 6).map((h, i) => `${i + 1}. [${DOMAIN_LABEL[h.domain] || ''}] ${h.title}（${h.participants} 个独立信源）${h.digest ? `：${h.digest}` : ''}`));
  const top = (issue.sections || []).flatMap(s => s.items.map(i => ({ ...i, category: s.category })))
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 12);
  if (top.length) lines.push('【精选】', ...top.map(i => `- [${DOMAIN_LABEL[i.domain] || ''}·${i.category}] ${i.title}：${(i.summary || '').slice(0, 90)}`));
  if (issue.deals?.length) lines.push('【一级市场】', ...issue.deals.slice(0, 10).map(d => `- ${d.companyName} ${d.round}${d.amountText ? ` ${d.amountText}` : ''}${d.investors.length ? `，投资方：${d.investors.slice(0, 4).join('、')}` : ''}`));
  return neutralize(lines.join('\n'));
}

async function rewriteLead(issue, settings, periodLabel) {
  const prompt = industry.renderPrompt('report-lead', { periodLabel });
  const user = `<item id="0">\n${leadInput(issue)}\n</item>`;
  const { value } = await withReceipt({
    task: 'report-lead',
    keyParts: [prompt.version, modelFor(settings), user],
    validate: v => v && typeof v.lead === 'string' && v.lead.trim().length >= 20,
    call: async () => extractJson(await chat([
      { role: 'system', content: prompt.text },
      { role: 'user', content: user }
    ], { settings, model: modelFor(settings), maxTokens: 800 }))
  });
  return [...String(value.lead).trim()].slice(0, 400).join('');
}

// 今日日报、本周与上周周报、本月月报：还是事实型导语的，改写一次
async function enhanceLeads({ settings }) {
  if (!settings?.ai?.apiKey) return { rewritten: 0 };
  let rewritten = 0;
  const { getDaily } = require('./daily');
  const today = localDateString();
  try {
    const daily = getDaily(today);
    if (daily && !daily.corrupt && daily.leadSource === 'factual' && daily.totals?.relevant > 0) {
      const before = db.prepare('SELECT content_json FROM daily_reports WHERE date = ?').get(today)?.content_json;
      daily.lead = await rewriteLead(daily, settings, '日报');
      daily.leadSource = 'model';
      rewritten += db.prepare('UPDATE daily_reports SET content_json = ? WHERE date = ? AND content_json = ?')
        .run(JSON.stringify(daily), today, before ?? null).changes;
    }
    for (const [kind, key] of [['weekly', periodKeyOf('weekly')], ['weekly', previousPeriodKey('weekly')], ['monthly', periodKeyOf('monthly')]]) {
      const issue = generatePeriod(kind, key);
      if (issue.leadSource !== 'factual' || !issue.totals?.relevant) continue;
      const before = db.prepare('SELECT content_json FROM period_reports WHERE kind = ? AND period_key = ?').get(kind, key)?.content_json;
      issue.lead = await rewriteLead(issue, settings, kind === 'weekly' ? '周报' : '月报');
      issue.leadSource = 'model';
      rewritten += db.prepare('UPDATE period_reports SET content_json = ? WHERE kind = ? AND period_key = ? AND content_json = ?')
        .run(JSON.stringify(issue), kind, issue.key, before ?? null).changes;
    }
  } catch (error) {
    if (!error?.budgetExceeded) console.warn('[reports] 导语改写失败:', error.message);
  }
  return { rewritten };
}

module.exports = {
  isoWeek,
  periodKeyOf,
  previousPeriodKey,
  resolvePeriod,
  composeIssue,
  generatePeriod,
  readPeriod,
  listPeriods,
  enhanceLeads,
  factualLead,
  foldByStory
};
