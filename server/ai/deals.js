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

// ---------- v0.2.2：事件性质、阶段、量级 ----------
// 一级市场视图只该看到一级市场：上市公司定增/可转债属于二级市场再融资，融资租赁、授信、债券属于债权，
// 它们仍然入库留痕（报道是真的），但默认不进入融资动态、机构榜和概览统计。
const DEAL_KINDS = Object.freeze({ equity: '股权融资', ipo: '上市进程', ma: '并购与股权转让', secondary: '上市公司再融资', debt: '债权与租赁', jv: '合资设立' });
const PRIMARY_KINDS = Object.freeze(['equity', 'ipo', 'ma']);
const SECONDARY_TEXT = /定增|定向增发|向特定对象发行|非公开发行|可转债|可转换公司债|配股|发行股份购买|募集配套资金|募资不超过|募集资金总额不超过|增发/;
const JV_TEXT = /(?:拟设|设立|成立|组建|共同出资)[^。；]{0,16}合资公司|合资公司[^。；]{0,8}(?:设立|成立|落地)|共同出资设立|合资设立/;
const DEBT_TEXT = /融资租赁|金融租赁|授信|银团|贷款|公司债|中期票据|短期融资券|科创债|债券|票据/;

function classifyKind({ round = '未披露', text = '', companyStatus = null } = {}) {
  if (['IPO', '上市辅导'].includes(round)) return 'ipo';
  if (['并购', '股权转让'].includes(round)) return 'ma';
  const body = String(text || '');
  const vagueRound = ['未披露', '战略融资'].includes(round);
  if (vagueRound && SECONDARY_TEXT.test(body)) return 'secondary';
  if (vagueRound && companyStatus === 'listed' && /募资|募集|发行/.test(body)) return 'secondary';
  if (vagueRound && JV_TEXT.test(body) && !/轮融资|领投|跟投/.test(body)) return 'jv';
  if (vagueRound && DEBT_TEXT.test(body) && !/股权融资|轮融资|领投|跟投/.test(body)) return 'debt';
  return 'equity';
}

// 阶段：早期 / 成长 / 后期 / 上市进程 / 战略与并购 / 未披露
const STAGES = Object.freeze({ early: '早期', growth: '成长期', late: '后期', ipo: '上市进程', strategic: '战略与并购', unknown: '轮次未披露' });
function stageOf(round) {
  const r = String(round || '');
  if (/^(种子轮|天使)|^Pre-A|^A\d*\+*轮$/.test(r)) return 'early';
  if (/^Pre-[BC]|^[BC]\d*\+*轮$/.test(r)) return 'growth';
  if (/^[D-F]\d*\+*轮$|^Pre-IPO$/.test(r)) return 'late';
  if (['IPO', '上市辅导'].includes(r)) return 'ipo';
  if (['战略融资', '并购', '股权转让'].includes(r)) return 'strategic';
  return 'unknown';
}

// 金额量级：只用于分档与排序，不冒充精确金额。外币按粗略汇率折算只为判断量级；
// “数千万”“近亿”“超亿”等约数按字面下限归档。
const FX = { 美元: 7.1, 美金: 7.1, USD: 7.1, 'US$': 7.1, $: 7.1, 欧元: 7.8, EUR: 7.8, 港元: 0.91, 港币: 0.91, HKD: 0.91, 日元: 0.048, 英镑: 9 };
const TIERS = Object.freeze([
  { id: 'b10', label: '十亿级及以上', min: 1e9 },
  { id: 'b1', label: '亿元级', min: 1e8 },
  { id: 'm10', label: '千万级', min: 1e7 },
  { id: 'small', label: '千万以下', min: 0 }
]);
function estimateAmount(raw) {
  const value = text(raw, 40).replace(/,/g, '');
  if (!value) return null;
  const currency = Object.keys(FX).find(k => value.includes(k));
  const rate = currency ? FX[currency] : 1;
  let est = null;
  const exact = value.match(/(\d+(?:\.\d+)?)\s*(亿|千万|百万|万)?/);
  if (exact && (exact[2] || /元|美元|欧元|港元/.test(value))) {
    const unit = { 亿: 1e8, 千万: 1e7, 百万: 1e6, 万: 1e4 }[exact[2]] || 1;
    est = Number(exact[1]) * unit;
    if (/近\s*$/.test(value.slice(0, exact.index))) est *= 0.9;
  } else if (/数十亿/.test(value)) est = 2e9;
  else if (/数亿|几亿/.test(value)) est = 2e8;
  else if (/(超|逾|过)亿/.test(value)) est = 1e8;
  else if (/近亿/.test(value)) est = 8e7;
  else if (/数千万|几千万/.test(value)) est = 2e7;
  else if (/千万/.test(value)) est = 1e7;
  else if (/数百万|百万/.test(value)) est = 2e6;
  if (!Number.isFinite(est) || est <= 0) return null;
  return est * rate;
}
function tierOf(deal) {
  const est = Number(deal.amountCny) > 0 ? Number(deal.amountCny) : estimateAmount(deal.amountText);
  if (!est) return null;
  return TIERS.find(t => est >= t.min)?.id || null;
}

// 未入库公司的融资主体身份：去掉括号地名、法律形式、行政区前缀和行业后缀，只用于同一时间窗内的
// 融资去重（“广东高域科技有限公司”“高域科技”“高域”），不写回公司库，也不用于报道归属。
const REGION_PREFIX = /^(?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|深圳|广州|杭州|南京|苏州|无锡|常州|合肥|芜湖|武汉|长沙|成都|西安|郑州|青岛|济南|厦门|宁波|珠海|东莞|佛山|沈阳|大连|哈尔滨|长春|南昌|昆明|贵阳|太原|石家庄|南宁|福州|烟台|绵阳|德阳|株洲|湘潭|嘉兴|湖州|绍兴|台州|温州|金华|南通|扬州|镇江|盐城|泰州|徐州|中山|惠州|江门|雄安|滨州|潍坊)(?:省|市|自治区|特别行政区|新区)?/;
const INDUSTRY_SUFFIX = /(?:航空航天|航天科技|航空科技|航空技术|智能科技|智能装备|科技发展|技术开发|电子科技|信息技术|无人机|科技|技术|智能|航空|航天|实业|集团|控股|工业)$/;
function dealIdentity(name) {
  let key = String(name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
    .replace(/[（(][^）)]{1,8}[)）]/g, '')
    .replace(/(?:股份有限公司|有限责任公司|有限公司|股份公司|公司)$/, '');
  const regionless = key.replace(REGION_PREFIX, '');
  if ([...regionless].length >= 2) key = regionless;
  for (let i = 0; i < 2; i++) {
    const trimmed = key.replace(INDUSTRY_SUFFIX, '');
    if ([...trimmed].length >= 2 && trimmed !== key) key = trimmed; else break;
  }
  return key;
}
// 名称变体：完全相同，或较短者（≥2 字）是较长者的首尾部分（“高域”⊂“广汽高域”）
const GENERIC_CORES = new Set(['中科', '中国', '中航', '中电', '国家', '航天', '航空', '空天', '星空', '天空', '无人', '低空', '卫星', '火箭', '智能', '科技']);
function sameIdentity(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = [...a].length <= [...b].length ? [a, b] : [b, a];
  if ([...short].length < 2 || GENERIC_CORES.has(short) || [...long].length - [...short].length > 3) return false;
  return long.startsWith(short) || long.endsWith(short);
}
// 融资主体 → 公司库：先按确切名称 / 别名；不行再比“去掉地名、括号与行业后缀后的字号”，
// 必须恰好命中一家（“深圳市庆为航空科技有限公司”→ 庆为航空），字号过短或是通用词则不猜。
function resolveDealCompany(name) {
  const hit = companies.resolveName(name);
  if (hit) return hit;
  const key = dealIdentity(name);
  if ([...key].length < 2 || GENERIC_CORES.has(key)) return null;
  const matches = db.prepare('SELECT id, name, aliases_json FROM companies WHERE enabled = 1').all()
    .filter(row => [row.name, ...parseNames(row.aliases_json)].some(n => dealIdentity(n) === key));
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name } : null;
}

function roundsCompatible(a, b) {
  if (a === b) return true;
  const soft = ['未披露'];
  const hard = ['并购', '股权转让', 'IPO', '上市辅导'];
  return (soft.includes(a) && !hard.includes(b)) || (soft.includes(b) && !hard.includes(a));
}

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

// 公司库之外的融资主体：±45 天内名称变体相同、轮次相容的记录视为同一笔。
// 先到的“未披露”记录遇到写明轮次的报道时补上轮次（键随之更新，撞键则并入已有记录）。
function matchVariant(companyName, deal, observed, newKey) {
  const identity = dealIdentity(companyName);
  if (!identity) return null;
  const center = Date.parse(deal.date || observed);
  if (!Number.isFinite(center)) return null;
  const since = new Date(center - 45 * 86400e3).toISOString().slice(0, 10);
  const until = new Date(center + 45 * 86400e3).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT d.* FROM deals d LEFT JOIN articles a ON a.id = d.first_article_id
    WHERE d.company_id IS NULL AND substr(COALESCE(d.deal_date, a.published_at, d.first_seen_at),1,10) BETWEEN ? AND ?
    ORDER BY d.source_count DESC, d.id`).all(since, until);
  const match = rows.find(row => sameIdentity(identity, dealIdentity(row.company_name)) && roundsCompatible(row.round, deal.round));
  if (!match) return null;
  if (match.round === '未披露' && deal.round !== '未披露' && !UNBUCKETED.has(deal.round)) {
    const taken = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(newKey);
    if (taken) return taken;
    db.prepare('UPDATE deals SET round = ?, deal_key = ? WHERE id = ?').run(deal.round, newKey, match.id);
    return { ...match, round: deal.round, deal_key: newKey };
  }
  return match;
}

// 调用方负责事务。返回 deal id 或 null。
function recordDeal(article, deal, { origin = 'model', domain = null, text = '' } = {}) {
  if (!deal || !article?.id) return null;
  const hit = resolveDealCompany(deal.company);
  const companyId = hit?.id || null;
  const companyName = hit?.name || deal.company;
  const companyKey = companyId || `name:${companies.identityKey(companyName)}`;
  const stamp = now();
  const articleTime = db.prepare('SELECT title, title_zh, ai_summary, summary_raw, published_at, fetched_at FROM articles WHERE id = ?').get(article.id);
  const observed = articleTime?.published_at || articleTime?.fetched_at || stamp;
  const companyStatus = companyId ? db.prepare('SELECT status FROM companies WHERE id = ?').get(companyId)?.status : null;
  const evidenceText = [text, articleTime?.title, articleTime?.title_zh, articleTime?.ai_summary || articleTime?.summary_raw].filter(Boolean).join(' ');
  const kind = classifyKind({ round: deal.round, text: evidenceText, companyStatus });
  const key = dealKey(companyKey, deal.round, deal.date, observed);
  let existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(key);
  // 公司库之外的主体：同一时间窗内名称变体（全称 / 简称 / 母品牌前缀）视为同一家，轮次相容才合并
  if (!existing && !companyId) existing = matchVariant(companyName, deal, observed, key);
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
        investors_json, lead_investors_json, status, deal_date, first_article_id, article_ids_json, source_count, origin, first_seen_at, updated_at, deal_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(key, companyId, companyName, domain, deal.round, deal.amountText || null, deal.amountCny,
        JSON.stringify(mergeNames(deal.investors, deal.leadInvestors)), JSON.stringify(deal.leadInvestors), deal.status,
        deal.date, article.id, JSON.stringify([article.id]), origin, stamp, stamp, kind).lastInsertRowid;
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
  const deal = {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    company,
    domain: row.domain,
    round: row.round,
    stage: stageOf(row.round),
    kind: row.deal_kind || 'equity',
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
    segment: row.segment || null,
    article: row.article_id ? { id: row.article_id, title: row.article_title_zh || row.article_title, url: row.article_url, source: row.source_name } : null
  };
  deal.tier = tierOf(deal);
  deal.estimateCny = Number(deal.amountCny) > 0 ? Number(deal.amountCny) : estimateAmount(deal.amountText);
  return deal;
}

const SORTS = Object.freeze({
  date: (a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id,
  amount: (a, b) => (b.estimateCny || 0) - (a.estimateCny || 0) || String(b.date).localeCompare(String(a.date)),
  sources: (a, b) => (b.sourceCount || 0) - (a.sourceCount || 0) || String(b.date).localeCompare(String(a.date))
});

// kind：'primary'（默认，股权 + 上市进程 + 并购）| 'all' | 具体性质；stage：early/growth/late/ipo/strategic/unknown
// seenWindow：[start, end] 按入库时间取（刊期用），不再按日期过滤
function listDeals({ days = 90, domain = null, companyId = null, watchedOnly = false, limit = 100, since = null, until = null, q = '',
  kind = 'primary', stage = null, sort = 'date', seenWindow = null } = {}) {
  const where = [];
  const params = [];
  if (seenWindow) {
    where.push('d.first_seen_at > ? AND d.first_seen_at <= ?');
    params.push(seenWindow[0], seenWindow[1]);
  } else {
    const from = since || new Date(Date.now() - days * 86400e3).toISOString();
    where.push('substr(COALESCE(d.deal_date, a.published_at, d.first_seen_at), 1, 10) >= ?');
    params.push(from.slice(0, 10));
    if (until) { where.push('d.first_seen_at < ?'); params.push(until); }
  }
  if (domain) { where.push('d.domain = ?'); params.push(domain); }
  if (companyId) { where.push('d.company_id = ?'); params.push(companyId); }
  if (watchedOnly) where.push('c.watch > 0');
  if (kind === 'primary') where.push(`d.deal_kind IN (${PRIMARY_KINDS.map(() => '?').join(',')})`), params.push(...PRIMARY_KINDS);
  else if (kind && kind !== 'all' && DEAL_KINDS[kind]) { where.push('d.deal_kind = ?'); params.push(kind); }
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
    where.push("(d.company_name LIKE ? ESCAPE '\\' OR c.aliases_json LIKE ? ESCAPE '\\' OR c.products_json LIKE ? ESCAPE '\\' OR d.investors_json LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern, pattern);
  }
  const rows = db.prepare(`SELECT d.*, c.watch, c.status AS company_status, c.segment,
      a.id AS article_id, a.title AS article_title, a.title_zh AS article_title_zh, a.url AS article_url, a.published_at AS article_published_at, s.name AS source_name
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN articles a ON a.id = d.first_article_id
    LEFT JOIN sources s ON s.id = a.source_id
    WHERE ${where.join(' AND ')}
    ORDER BY substr(COALESCE(d.deal_date, a.published_at, d.first_seen_at), 1, 10) DESC, d.id DESC
    LIMIT 1000`).all(...params);
  let deals = rows.map(dealRow);
  if (stage && STAGES[stage]) deals = deals.filter(d => d.stage === stage);
  if (sort !== 'date' && SORTS[sort]) deals.sort(SORTS[sort]);
  return deals.slice(0, Math.max(1, Math.min(500, limit)));
}

// 机构名归一：去掉“（有限合伙）”等法律形式与空白，只用于合并同一机构的不同写法
function investorKey(name) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, '')
    .replace(/[（(](?:有限合伙|普通合伙|有限公司)[)）]$/, '')
    .replace(/(?:股份有限公司|有限责任公司|有限公司)$/, '');
}

// 活跃机构：窗口内出现在一级市场融资事件里的投资方，领投单独计数；同一笔融资的多个名称变体只算一次
function investorBoard({ days = 90, domain = null, limit = 20, q = '', watchedOnly = false, deals: given = null } = {}) {
  const deals = given || listDeals({ days, domain, q, watchedOnly, limit: 500 });
  const board = new Map();
  for (const deal of deals) {
    const leads = new Set(deal.leadInvestors.map(investorKey));
    for (const name of new Set(deal.investors)) {
      const key = investorKey(name);
      if (!key) continue;
      const entry = board.get(key) || { name, deals: 0, leads: 0, companies: new Set(), seen: new Set(), domains: new Set(), stages: new Map(), last: '' };
      const dealId = `${deal.companyId || dealIdentity(deal.companyName)}|${deal.round === '未披露' ? String(deal.date).slice(0, 7) : deal.round}`;
      if (entry.seen.has(dealId)) continue;
      entry.seen.add(dealId);
      entry.deals++;
      if (leads.has(key)) entry.leads++;
      entry.companies.add(deal.companyName);
      if (deal.domain) entry.domains.add(deal.domain);
      entry.stages.set(deal.stage, (entry.stages.get(deal.stage) || 0) + 1);
      if (String(deal.date) > entry.last) entry.last = String(deal.date);
      board.set(key, entry);
    }
  }
  return [...board.values()]
    .sort((a, b) => b.deals - a.deals || b.leads - a.leads || b.last.localeCompare(a.last) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(entry => ({
      name: entry.name, deals: entry.deals, leads: entry.leads, companies: [...entry.companies].slice(0, 8),
      domains: [...entry.domains], last: entry.last,
      stages: [...entry.stages.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, label: STAGES[id], count }))
    }));
}

// 概览：窗口内一级市场的结构化统计，全部由已入库的真实融资事件计算，不做外推
function overview({ days = 90, domain = null, q = '', watchedOnly = false } = {}) {
  const deals = listDeals({ days, domain, q, watchedOnly, limit: 500 });
  const excluded = listDeals({ days, domain, q, watchedOnly, limit: 500, kind: 'all' }).filter(d => !PRIMARY_KINDS.includes(d.kind));
  const count = (list, keyOf) => {
    const map = new Map();
    for (const item of list) { const key = keyOf(item); if (key != null) map.set(key, (map.get(key) || 0) + 1); }
    return map;
  };
  const byDomain = count(deals, d => d.domain || 'unknown');
  const stageMap = count(deals, d => d.stage);
  const tierMap = count(deals, d => d.tier || 'unknown');
  const segmentMap = count(deals.filter(d => d.segment), d => d.segment);
  // 月度走势：按融资（或报道）日期所在月份，分领域计数
  const months = [];
  const end = new Date();
  const span = Math.max(1, Math.min(12, Math.ceil(days / 30)));
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthly = months.map(month => {
    const inMonth = deals.filter(d => String(d.date).slice(0, 7) === month);
    return { month, total: inMonth.length, lowaltitude: inMonth.filter(d => d.domain === 'lowaltitude').length, aerospace: inMonth.filter(d => d.domain === 'aerospace').length };
  });
  const disclosed = deals.filter(d => Number(d.amountCny) > 0);
  const large = deals.filter(d => d.estimateCny).sort(SORTS.amount).slice(0, 6);
  const companiesSeen = new Set(deals.map(d => d.companyId || `name:${dealIdentity(d.companyName)}`));
  return {
    days,
    totals: {
      deals: deals.length,
      companies: companiesSeen.size,
      completed: deals.filter(d => d.status === 'completed').length,
      rumored: deals.filter(d => d.status === 'rumored').length,
      withInvestors: deals.filter(d => d.investors.length).length,
      disclosedCny: disclosed.reduce((sum, d) => sum + Number(d.amountCny), 0),
      disclosedCount: disclosed.length,
      largeRounds: deals.filter(d => d.tier === 'b1' || d.tier === 'b10').length,
      excluded: excluded.length,
      lowaltitude: byDomain.get('lowaltitude') || 0,
      aerospace: byDomain.get('aerospace') || 0
    },
    stages: Object.entries(STAGES).map(([id, label]) => ({ id, label, count: stageMap.get(id) || 0 })),
    tiers: [...TIERS.map(t => ({ id: t.id, label: t.label, count: tierMap.get(t.id) || 0 })), { id: 'unknown', label: '金额未披露', count: tierMap.get('unknown') || 0 }],
    segments: [...segmentMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count })),
    monthly,
    large,
    pipeline: deals.filter(d => d.kind === 'ipo' || d.round === 'Pre-IPO').slice(0, 10),
    recent: deals.slice(0, 8),
    investors: investorBoard({ deals, limit: 8 }),
    excludedKinds: [...count(excluded, d => d.kind).entries()].map(([id, n]) => ({ id, label: DEAL_KINDS[id], count: n }))
  };
}

// 导出：CSV（Excel 可直接打开）或 Markdown 表格，只含已入库事实与原文链接
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; // 防公式注入
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const DOMAIN_TEXT = { lowaltitude: '低空经济', aerospace: '商业航天' };
const STATUS_TEXT = { completed: '已完成', announced: '已宣布', rumored: '传闻' };
const BASIS_TEXT = { event: '事件日期', published: '报道日期', discovered: '发现日期' };
function exportDeals(options = {}, format = 'csv') {
  const deals = listDeals({ ...options, limit: 500 });
  const stamp = require('../date-time').localDateString();
  const header = ['日期', '日期口径', '公司', '领域', '赛道', '轮次', '阶段', '金额（原文）', '量级', '状态', '领投', '投资方', '报道数', '原文标题', '原文链接'];
  const rows = deals.map(d => [d.date, BASIS_TEXT[d.dateBasis], d.companyName, DOMAIN_TEXT[d.domain] || '', d.segment || '', d.round, STAGES[d.stage],
    d.amountText || '未披露', TIERS.find(t => t.id === d.tier)?.label || '', STATUS_TEXT[d.status] || d.status,
    d.leadInvestors.join('、'), d.investors.join('、'), d.sourceCount, d.article?.title || '', d.article?.url || '']);
  if (format === 'markdown') {
    const md = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const content = [`# 一级市场融资事件（${stamp} 导出，共 ${deals.length} 起）`, '',
      '> 均抽取自公开报道；金额保留原文写法，量级仅供分档参考。', '',
      `| ${header.slice(0, 13).join(' | ')} | 原文 |`, `|${' --- |'.repeat(14)}`,
      ...rows.map(r => `| ${r.slice(0, 13).map(md).join(' | ')} | ${r[14] ? `[${md(r[13] || '原文')}](${r[14]})` : ''} |`)].join('\n');
    return { filename: `一级市场融资-${stamp}.md`, content, count: deals.length };
  }
  const content = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  return { filename: `一级市场融资-${stamp}.csv`, content, count: deals.length };
}

// 融资主体不在公司库里的：“新发现公司”，供用户一键收录进关注
function discoveredCompanies({ days = 180, limit = 30, domain = null, q = '', watchedOnly = false } = {}) {
  if (watchedOnly) return [];
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT company_name AS name, d.domain, COUNT(*) AS deals, MAX(substr(COALESCE(deal_date,a.published_at,first_seen_at),1,10)) AS last,
      GROUP_CONCAT(round, '、') AS rounds
    FROM deals d LEFT JOIN articles a ON a.id=d.first_article_id WHERE company_id IS NULL AND d.deal_kind IN ('equity','ipo','ma') AND substr(COALESCE(deal_date,a.published_at,first_seen_at),1,10) >= ?
      AND (? IS NULL OR d.domain = ?) AND company_name LIKE ? ESCAPE '\\'
    GROUP BY company_name ORDER BY last DESC LIMIT ?`).all(since, domain, domain, `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`, 500)
    .map(row => ({ name: row.name, domain: row.domain, deals: row.deals, last: row.last, rounds: [...new Set(String(row.rounds || '').split('、'))].slice(0, 4) }));
  const grouped = new Map();
  for (const row of rows) {
    const key = [...grouped.keys()].find(k => sameIdentity(k, dealIdentity(row.name))) || dealIdentity(row.name), existing = grouped.get(key);
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
      if (deal) { recordDeal(row, deal, { origin: 'heuristic', domain: row.domain, text: `${row.title || ''} ${row.ai_summary || row.summary_raw || ''}` }); found++; }
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
  DEAL_KINDS,
  PRIMARY_KINDS,
  STAGES,
  TIERS,
  classifyKind,
  stageOf,
  estimateAmount,
  tierOf,
  dealIdentity,
  sameIdentity,
  resolveDealCompany,
  roundsCompatible,
  overview,
  exportDeals,
  investorKey,
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
