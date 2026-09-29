'use strict';
// 一级市场融资事件 —— 从真实报道里抽取，不预置任何融资数据。
//
// 同一笔融资会被公众号、财经媒体、投资方官微反复报道：deal_key = 公司 + 轮次，
// 所有报道合并成一条记录，投资方取并集、状态只升不降（传闻 → 已宣布 → 已完成），
// 每篇报道留作证据（article_ids），source_count 就是“有几篇独立报道在说”。
// 轮次说不清的（未披露、战略融资、股权转让、并购）再按月份分桶，避免把一家公司
// 相隔半年的两次战略融资并成一条。
//
// 有 Key 时由内容理解一并抽取（deal 字段）；无 Key 时用标题上的规则兜底（origin=heuristic）。
const { db, now } = require('../db');
const { loadTaxonomy } = require('../industry');
const companies = require('./companies');

const STATUS_RANK = Object.freeze({ rumored: 1, announced: 2, completed: 3 });
const UNBUCKETED = new Set(['未披露', '战略融资', '股权转让', '并购']);

function text(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && !/\p{Cc}/u.test(clean) ? [...clean].slice(0, max).join('') : '';
}

function list(value, max = 10) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const name = text(item, 40);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

// 轮次归一：“A+轮”“A＋轮”“Pre A轮”“B1轮”“天使+轮”……归到 taxonomy.rounds 的规范写法
function normalizeRound(raw, rounds = loadTaxonomy().rounds) {
  let value = text(raw, 20).replace(/＋/g, '+').replace(/\s+/g, '').replace(/^pre[-_]?/i, 'Pre-');
  if (!value) return '未披露';
  value = value.replace(/融资$/, '').replace(/^新一?轮$/, '未披露');
  if (/^Pre-?IPO轮?$/i.test(value)) return 'Pre-IPO';
  if (/IPO|首次公开发行|上市申请|递表|招股/i.test(value)) return rounds.includes('IPO') ? 'IPO' : value;
  if (/辅导/.test(value)) return '上市辅导';
  if (/并购|收购/.test(value)) return '并购';
  if (/战略/.test(value)) return '战略融资';
  if (/种子/.test(value)) return '种子轮';
  if (/^天使\+*轮?$/.test(value)) return value.replace(/轮?$/, '轮');
  if (/Pre-?IPO/i.test(value)) return 'Pre-IPO';
  const match = value.match(/^(Pre-)?([A-F])(\d{1,2}|\+{1,6})?轮?$/i);
  if (match) {
    return `${match[1] ? 'Pre-' : ''}${match[2].toUpperCase()}${match[3] || ''}轮`;
  }
  return rounds.includes(value) ? value : '未披露';
}

// 只换算明确写出的人民币数字：“3亿元”“5000万元”“1.5亿人民币”。“数亿元”“近亿元”与外币返回 null。
function parseAmountCny(raw) {
  const value = text(raw, 40).replace(/,/g, '');
  if (!value || /美元|美金|USD|US\$|\$|欧元|港元|港币|日元/i.test(value)) return null;
  const match = value.match(/(\d+(?:\.\d+)?)\s*(亿|千万|百万|万)?\s*(元|人民币|RMB)/i);
  if (!match) return null;
  // “近 10 亿元”“超 3 亿元”“约 5000 万元”是约数，只保留原文写法，不当作精确金额
  if (/(数|近|超|逾|几|约|过|上)\s*$/.test(value.slice(0, match.index))) return null;
  if (/(余|多)/.test(value.slice(match.index + match[1].length, match.index + match[1].length + 2))) return null;
  const number = Number(match[1]);
  const unit = { 亿: 1e8, 千万: 1e7, 百万: 1e6, 万: 1e4 }[match[2]] || 1;
  const amount = number * unit;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeDate(raw) {
  const value = text(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

// 模型输出 → 规范融资事件；公司名缺失或不像一个名字时返回 null（宁缺毋滥）
function normalizeDeal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const company = text(raw.company, 40);
  if (!company || [...company].length < 2) return null;
  const amountText = text(raw.amount, 30);
  return {
    company,
    round: normalizeRound(raw.round),
    amountText,
    amountCny: parseAmountCny(amountText),
    investors: list(raw.investors),
    leadInvestors: list(raw.leadInvestors, 5),
    date: normalizeDate(raw.date),
    status: STATUS_RANK[raw.status] ? raw.status : 'announced'
  };
}

// ---------- 无 Key 兜底：标题规则 ----------
const ROUND_PATTERN = '(种子轮|天使\\+{0,6}轮|Pre-?A\\+?轮|Pre-?B\\+?轮|Pre-?C轮|Pre-?IPO轮?|[A-F][+＋]{0,6}\\d?轮|战略融资|战略投资|新一轮融资)';
const AMOUNT_PATTERN = '((?:近|超|逾|数)?[\\d.]*(?:十|百|千)?(?:万|亿)(?:元|美元|人民币)?|数[十百千]?[万亿](?:元|美元)?)';
const DEAL_TITLE = new RegExp(`(?:完成|获得?|宣布完成|斩获|拿下|获投)(?:了)?(?:新一轮)?${AMOUNT_PATTERN}?(?:的)?${ROUND_PATTERN}`);
const RUMOR = /据悉|传闻|知情人士|消息人士|或将|洽谈/;
const PLANNED = /即将|拟|计划|筹划|正在筹备|有望|将于|启动/;
const AMOUNT_ANYWHERE = /(?:近|超|逾|约)?\d+(?:\.\d+)?(?:万|亿)(?:元|美元|人民币)?|数[十百千]?[万亿](?:元|美元)?/;
const INVESTOR_LEAD = /由([^，。；,;]{2,40}?)领投/;
const INVESTOR_FOLLOW = /([^，。；,;]{2,60}?)跟投/;

function splitInvestors(fragment) {
  return list(String(fragment || '').split(/[、,，和及与]/).map(s => s.replace(/^(本轮|此轮|本次)?(融资)?由?/, '').replace(/(等|联合|共同|参投|跟投|领投)+$/, '').trim()));
}

function heuristicDeal({ title = '', summary = '', subjects = [] } = {}) {
  const head = String(title || '');
  // 多轮合计不得误记到某一轮；交给模型按原文保留未披露金额。
  if (/连续完成|两轮|三轮|多轮|[A-F]\+*、[A-F]\+*轮/.test(head)) return null;
  const match = head.match(DEAL_TITLE) || head.match(new RegExp(`(?:完成|获得?|获投)${AMOUNT_PATTERN}(融资)`));
  if (!match) return null;
  const primary = [...companies.matchText(head.slice(0, match.index)).values()].sort((a,b)=>b.first-a.first)[0] || null;
  let company = primary?.name || null;
  if (!company) {
    const before = head.slice(0, match.index).replace(/^.*[：:，,|｜!！?？]/, '').trim();
    const candidate = before
      .replace(/^[「『“"【]|[」』”"】]$/g, '')
      .replace(/^(消息|快讯|独家|首发|刚刚)/, '')
      // “混动eVTOL企业追梦空天科技”“广汽子公司高域科技”：描述语之后才是公司名
      .replace(/^.*?(企业|公司|子公司|旗下|独角兽|厂商|初创|明星)(?=[一-龥A-Za-z]{2,})/, '')
      .replace(/(再次|再|又|已|正式|成功|宣布|近日|今日)+$/, '')
      .trim();
    if ([...candidate].length >= 2 && [...candidate].length <= 20) company = candidate;
  }
  if (!company) return null;
  const body = `${head} ${summary || ''}`;
  const lead = body.match(INVESTOR_LEAD);
  const follow = body.match(INVESTOR_FOLLOW);
  // 金额既可能在轮次之前（获数亿元A轮），也可能在之后（完成E轮近10亿元融资）
  const amount = match[1] || head.slice(match.index, match.index + match[0].length + 8).match(AMOUNT_ANYWHERE)?.[0] || '';
  return normalizeDeal({
    company,
    round: match[2],
    amount,
    investors: [...splitInvestors(lead?.[1]), ...splitInvestors(follow?.[1])],
    leadInvestors: splitInvestors(lead?.[1]),
    status: RUMOR.test(head) ? 'rumored' : PLANNED.test(head) ? 'announced' : /完成|获|斩获|拿下/.test(match[0]) ? 'completed' : 'announced'
  });
}

// ---------- 持久化 ----------
function dealKey(companyKey, round, date, seenAt) {
  const base = `${companyKey}|${round}`;
  if (!UNBUCKETED.has(round)) return base;
  return `${base}|${String(date || seenAt || now()).slice(0, 7)}`;
}

function parseIds(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(Number.isInteger) : [];
  } catch { return []; }
}

function parseNames(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
  } catch { return []; }
}

function mergeNames(a, b, max = 12) {
  return [...new Set([...a, ...b])].slice(0, max);
}

// 调用方负责事务。返回 deal id 或 null。
function recordDeal(article, deal, { origin = 'model', domain = null } = {}) {
  if (!deal || !article?.id) return null;
  const hit = companies.resolveName(deal.company);
  const companyId = hit?.id || null;
  const companyName = hit?.name || deal.company;
  const companyKey = companyId || `name:${companies.identityKey(companyName)}`;
  const stamp = now();
  const articleTime = db.prepare('SELECT published_at, fetched_at FROM articles WHERE id = ?').get(article.id);
  const observed = articleTime?.published_at || articleTime?.fetched_at || stamp;
  const key = dealKey(companyKey, deal.round, deal.date, observed);
  let existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(key);
  // “某公司完成新一轮融资”常与写明轮次的报道说的是同一笔：45 天内同一公司已有记录的，
  // 未披露轮次挂到那条上；反过来，先到的“未披露”记录在写明轮次的报道到来时补上轮次。
  if (!existing) {
    const since = new Date(Date.parse(deal.date || observed) - 45 * 86400e3).toISOString().slice(0, 10);
    const until = new Date(Date.parse(deal.date || observed) + 45 * 86400e3).toISOString().slice(0, 10);
    const recent = db.prepare(`SELECT d.* FROM deals d LEFT JOIN articles a ON a.id = d.first_article_id WHERE (deal_key LIKE ? ESCAPE '\\')
      AND substr(COALESCE(deal_date, a.published_at, first_seen_at),1,10) BETWEEN ? AND ?
      AND round NOT IN ('并购', '股权转让', 'IPO', '上市辅导') ORDER BY first_seen_at DESC`)
      .all(`${companyKey.replace(/[\\%_]/g, ch => `\\${ch}`)}|%`, since, until);
    if (deal.round === '未披露') {
      existing = recent.find(row => row.round !== '未披露') || null;
    } else if (!['并购', '股权转让', 'IPO', '上市辅导', '战略融资'].includes(deal.round)) {
      const undisclosed = recent.find(row => row.round === '未披露');
      if (undisclosed) {
        db.prepare('UPDATE deals SET round = ?, deal_key = ? WHERE id = ?').run(deal.round, key, undisclosed.id);
        existing = { ...undisclosed, round: deal.round, deal_key: key };
      }
    }
  }
  if (!existing) {
    return db.prepare(`INSERT INTO deals (deal_key, company_id, company_name, domain, round, amount_text, amount_cny,
        investors_json, lead_investors_json, status, deal_date, first_article_id, article_ids_json, source_count, origin, first_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(key, companyId, companyName, domain, deal.round, deal.amountText || null, deal.amountCny,
        JSON.stringify(mergeNames(deal.investors, deal.leadInvestors)), JSON.stringify(deal.leadInvestors), deal.status,
        deal.date, article.id, JSON.stringify([article.id]), origin, stamp, stamp).lastInsertRowid;
  }
  const ids = parseIds(existing.article_ids_json);
  if (!ids.includes(article.id)) ids.push(article.id);
  const status = (STATUS_RANK[deal.status] || 0) > (STATUS_RANK[existing.status] || 0) ? deal.status : existing.status;
  // 模型抽取的金额优先于规则兜底；明确数字优先于“数亿元”
  const amountText = existing.amount_text && (existing.origin === 'model' || origin !== 'model') ? existing.amount_text : (deal.amountText || existing.amount_text);
  db.prepare(`UPDATE deals SET amount_text = ?, amount_cny = COALESCE(amount_cny, ?), investors_json = ?, lead_investors_json = ?,
      status = ?, deal_date = COALESCE(deal_date, ?), article_ids_json = ?, source_count = ?, domain = COALESCE(domain, ?),
      origin = CASE WHEN ? = 'model' THEN 'model' ELSE origin END, updated_at = ? WHERE id = ?`)
    .run(amountText || null, deal.amountCny,
      JSON.stringify(mergeNames(parseNames(existing.investors_json), mergeNames(deal.investors, deal.leadInvestors))),
      JSON.stringify(mergeNames(parseNames(existing.lead_investors_json), deal.leadInvestors, 6)),
      status, deal.date, JSON.stringify(ids.slice(-40)), ids.length, domain, origin, stamp, existing.id);
  return existing.id;
}

function dealRow(row) {
  let company = null;
  if (row.company_id) {
    company = { id: row.company_id, name: row.company_name, watch: Number(row.watch) || 0, status: row.company_status || null, segment: row.segment || null };
  }
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    company,
    domain: row.domain,
    round: row.round,
    amountText: row.amount_text,
    amountCny: row.amount_cny,
    investors: parseNames(row.investors_json),
    leadInvestors: parseNames(row.lead_investors_json),
    status: row.status,
    date: row.deal_date || (row.article_published_at || row.first_seen_at || '').slice(0, 10),
    dateBasis: row.deal_date ? 'event' : row.article_published_at ? 'published' : 'discovered',
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
    sourceCount: row.source_count,
    origin: row.origin,
    article: row.article_id ? { id: row.article_id, title: row.article_title_zh || row.article_title, url: row.article_url, source: row.source_name } : null
  };
}

function listDeals({ days = 90, domain = null, companyId = null, watchedOnly = false, limit = 100, since = null, until = null, q = '' } = {}) {
  const where = [];
  const params = [];
  const from = since || new Date(Date.now() - days * 86400e3).toISOString();
  where.push('substr(COALESCE(d.deal_date, a.published_at, d.first_seen_at), 1, 10) >= ?');
  params.push(from.slice(0, 10));
  if (until) { where.push('d.first_seen_at < ?'); params.push(until); }
  if (domain) { where.push('d.domain = ?'); params.push(domain); }
  if (companyId) { where.push('d.company_id = ?'); params.push(companyId); }
  if (watchedOnly) where.push('c.watch > 0');
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
    where.push("(d.company_name LIKE ? ESCAPE '\\' OR c.aliases_json LIKE ? ESCAPE '\\' OR c.products_json LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  const rows = db.prepare(`SELECT d.*, c.watch, c.status AS company_status, c.segment,
      a.id AS article_id, a.title AS article_title, a.title_zh AS article_title_zh, a.url AS article_url, a.published_at AS article_published_at, s.name AS source_name
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN articles a ON a.id = d.first_article_id
    LEFT JOIN sources s ON s.id = a.source_id
    WHERE ${where.join(' AND ')}
    ORDER BY substr(COALESCE(d.deal_date, a.published_at, d.first_seen_at), 1, 10) DESC, d.id DESC
    LIMIT ?`).all(...params, Math.max(1, Math.min(500, limit)));
  return rows.map(dealRow);
}

// 活跃机构：窗口内出现在融资事件里的投资方，领投单独计数
function investorBoard({ days = 90, domain = null, limit = 20, q = '', watchedOnly = false } = {}) {
  const deals = listDeals({ days, domain, q, watchedOnly, limit: 500 });
  const board = new Map();
  for (const deal of deals) {
    for (const name of deal.investors) {
      const entry = board.get(name) || { name, deals: 0, leads: 0, companies: new Set() };
      entry.deals++;
      if (deal.leadInvestors.includes(name)) entry.leads++;
      entry.companies.add(deal.companyName);
      board.set(name, entry);
    }
  }
  return [...board.values()]
    .sort((a, b) => b.deals - a.deals || b.leads - a.leads || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(entry => ({ name: entry.name, deals: entry.deals, leads: entry.leads, companies: [...entry.companies].slice(0, 8) }));
}

// 融资主体不在公司库里的：“新发现公司”，供用户一键收录进关注
function discoveredCompanies({ days = 180, limit = 30, domain = null, q = '', watchedOnly = false } = {}) {
  if (watchedOnly) return [];
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT company_name AS name, d.domain, COUNT(*) AS deals, MAX(substr(COALESCE(deal_date,a.published_at,first_seen_at),1,10)) AS last,
      GROUP_CONCAT(round, '、') AS rounds
    FROM deals d LEFT JOIN articles a ON a.id=d.first_article_id WHERE company_id IS NULL AND substr(COALESCE(deal_date,a.published_at,first_seen_at),1,10) >= ?
      AND (? IS NULL OR d.domain = ?) AND company_name LIKE ? ESCAPE '\\'
    GROUP BY company_name ORDER BY last DESC LIMIT ?`).all(since, domain, domain, `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`, 500)
    .map(row => ({ name: row.name, domain: row.domain, deals: row.deals, last: row.last, rounds: [...new Set(String(row.rounds || '').split('、'))].slice(0, 4) }));
  const grouped = new Map();
  for (const row of rows) {
    const key = companies.identityKey(row.name), existing = grouped.get(key);
    if (!existing) grouped.set(key,row);
    else { existing.deals += row.deals; existing.rounds = [...new Set([...existing.rounds,...row.rounds])].slice(0,4); }
  }
  return [...grouped.values()].slice(0,limit);
}

// 升级前已判相关的资本市场资料：按标题规则补抽一次融资事件（纯代码）。
// deal_json 写成 'null' 表示“看过、没有”，同一条不会被反复扫描。
function backfillHistory(limit = 500) {
  const rows = db.prepare(`SELECT id, title, title_zh, ai_summary, summary_raw, subjects_json, domain FROM articles
    WHERE relevant = 1 AND deal_json IS NULL AND (category = '资本市场' OR item_type = 'financing_capital')
    ORDER BY id DESC LIMIT ?`).all(limit);
  const mark = db.prepare('UPDATE articles SET deal_json = ? WHERE id = ?');
  let found = 0;
  for (const row of rows) {
    let subjects = [];
    try { subjects = JSON.parse(row.subjects_json || '[]'); } catch {}
    const deal = heuristicDeal({ title: `${row.title || ''} ${row.title_zh || ''}`, summary: row.ai_summary || row.summary_raw || '', subjects });
    db.exec('BEGIN IMMEDIATE');
    try {
      mark.run(deal ? JSON.stringify(deal) : 'null', row.id);
      if (deal) { recordDeal(row, deal, { origin: 'heuristic', domain: row.domain }); found++; }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  return { scanned: rows.length, found };
}

// 新收录一家公司后，把名字对得上的历史融资事件挂上 company_id
function relinkDeals() {
  db.exec('BEGIN IMMEDIATE');
  try {
    require('./capital-migration').reconcileDeals();
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

module.exports = {
  STATUS_RANK,
  normalizeRound,
  parseAmountCny,
  normalizeDeal,
  heuristicDeal,
  dealKey,
  recordDeal,
  listDeals,
  investorBoard,
  discoveredCompanies,
  relinkDeals,
  backfillHistory
};
