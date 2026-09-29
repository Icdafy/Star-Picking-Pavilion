'use strict';
// 一级市场公司库 —— 投资人真正盯的是“公司”，不是关键词。
//
// 一家公司有三类“名字”：规范名、别名（简称/英文名）、代表型号（朱雀三号 → 蓝箭航天，
// 谷神星一号 → 星河动力）。型号往往比公司名更常出现在标题里，所以它们同样指向公司。
// 匹配纯代码完成，模型给出的主体名称（subjects）再按同一张别名表归一：
// 不认识的主体保留名字、不挂 id，出现在“新发现公司”里供用户一键收录。
//
// 关注级别：0 未标记 · 1 关注 · 2 被投。内置条目随版本增量同步身份信息，
// 但用户的标记、备注、停用状态永远不被覆盖；用户自建的公司（custom=1）不参与同步。
const crypto = require('node:crypto');
const { db, now } = require('../db');
const { loadCompanySeed, loadSelection } = require('../industry');

const WATCH_LEVELS = Object.freeze({ none: 0, watch: 1, portfolio: 2 });
const STATUS_VALUES = new Set(['private', 'listed', 'state', 'unknown']);
const DOMAIN_VALUES = new Set(['lowaltitude', 'aerospace']);

function stringList(value, max = 24, length = 40) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/\s+/g, ' ');
    if (!text || text.length > length || /\p{Cc}/u.test(text) || out.includes(text)) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function parseList(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
  } catch { return []; }
}

// ---------- 种子同步 ----------
let indexVersion = 0;
let seedChecked = false;

function syncCompanySeed({ force = false } = {}) {
  if (seedChecked && !force) return 0;
  seedChecked = true;
  const seed = loadCompanySeed();
  const applied = Number(db.prepare("SELECT value FROM meta WHERE key='companySeedVersion'").get()?.value || 0);
  const count = db.prepare('SELECT COUNT(*) c FROM companies WHERE custom = 0').get().c;
  if (!force && applied >= seed.version && count > 0) return 0;
  const upsert = db.prepare(`INSERT INTO companies
      (id, name, aliases_json, products_json, domain, segment, region, status, note, custom, watch, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, products_json = excluded.products_json,
      domain = excluded.domain, segment = excluded.segment, region = excluded.region, status = excluded.status,
      updated_at = excluded.updated_at
    WHERE companies.custom = 0`);
  let changed = 0;
  const stamp = now();
  for (const c of seed.companies) {
    changed += upsert.run(c.id, c.name.trim(), JSON.stringify(stringList(c.aliases)), JSON.stringify(stringList(c.products)),
      DOMAIN_VALUES.has(c.domain) ? c.domain : null, typeof c.segment === 'string' ? c.segment.slice(0, 40) : null,
      c.region === 'intl' ? 'intl' : 'cn', STATUS_VALUES.has(c.status) ? c.status : 'unknown',
      typeof c.note === 'string' ? c.note.slice(0, 200) : null, stamp, stamp).changes;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('companySeedVersion', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(String(seed.version));
  indexVersion++;
  return changed;
}

// ---------- 别名索引 ----------
let aliasIndex = null;

function isLatin(surface) { return /^[\x20-\x7e]+$/.test(surface); }

// 太短的面没有判别力：“汇天”可以，“M1”不行。拉丁字母面至少 3 个字符且按词边界匹配。
function usableSurface(surface) {
  if (isLatin(surface)) return surface.replace(/\s/g, '').length >= 3;
  return [...surface].length >= 2;
}

function buildIndex() {
  const rows = db.prepare('SELECT id, name, aliases_json, products_json, domain FROM companies WHERE enabled = 1').all();
  const surfaces = [];
  for (const row of rows) {
    const add = (text, kind) => {
      if (!text || !usableSurface(text)) return;
      surfaces.push({ id: row.id, name: row.name, domain: row.domain, text, lower: text.toLowerCase(), latin: isLatin(text), kind });
    };
    add(row.name, 'name');
    for (const alias of parseList(row.aliases_json)) add(alias, 'alias');
    for (const product of parseList(row.products_json)) add(product, 'product');
  }
  // 长面先匹配：“蓝箭航天”命中后，它覆盖的“蓝箭”就不再单独计一次
  surfaces.sort((a, b) => b.text.length - a.text.length);
  return { version: indexVersion, surfaces, byId: new Map(rows.map(r => [r.id, r])) };
}

function index() {
  syncCompanySeed();
  if (!aliasIndex || aliasIndex.version !== indexVersion) aliasIndex = buildIndex();
  return aliasIndex;
}

function invalidateIndex() { indexVersion++; }

function boundaryOk(text, start, length) {
  const before = text[start - 1];
  const after = text[start + length];
  const word = ch => ch !== undefined && /[A-Za-z0-9]/.test(ch);
  return !word(before) && !word(after);
}

// 中文没有词边界：“千亿航天”里藏着“亿航”，“高峰飞行”里藏着“峰飞”。短别名（≤3 字）的
// 首字与前一字、末字与后一字若组成一个常见词，说明它只是更长词语的一部分，不算命中。
const COMMON_WORDS = new Set([
  '航天', '航空', '航线', '航道', '航运', '航母', '飞行', '飞机', '飞船', '飞天', '飞跃', '飞速', '天下', '天空', '天地', '天气', '天然',
  '空间', '空中', '空域', '箭体', '千亿', '百亿', '十亿', '万亿', '数亿', '亿元', '终极', '积极', '北极', '南极', '极地', '极限',
  '高峰', '顶峰', '巅峰', '登峰', '汇聚', '汇报', '沃土', '蓝天'
]);

function cjkBoundaryOk(text, start, length) {
  if (length > 3) return true;
  const before = text[start - 1];
  const after = text[start + length];
  const cjk = ch => ch !== undefined && /\p{Script=Han}/u.test(ch);
  if (cjk(before) && COMMON_WORDS.has(before + text[start])) return false;
  if (cjk(after) && COMMON_WORDS.has(text[start + length - 1] + after)) return false;
  return true;
}

// 返回 Map<companyId, { name, count, first, surfaces:Set }>
function matchText(text) {
  const source = String(text || '');
  const lower = source.toLowerCase();
  const covered = [];
  const hits = new Map();
  if (!source) return hits;
  for (const surface of index().surfaces) {
    const haystack = surface.latin ? lower : source;
    const needle = surface.latin ? surface.lower : surface.text;
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      from = at + needle.length;
      if (surface.latin ? !boundaryOk(source, at, needle.length) : !cjkBoundaryOk(source, at, needle.length)) continue;
      if (covered.some(([s, e]) => at >= s && at + needle.length <= e)) continue;
      covered.push([at, at + needle.length]);
      const hit = hits.get(surface.id) || { id: surface.id, name: surface.name, count: 0, first: at, surfaces: new Set() };
      hit.count++;
      hit.first = Math.min(hit.first, at);
      hit.surfaces.add(surface.text);
      hits.set(surface.id, hit);
    }
  }
  return hits;
}

// 一个名字（模型给的主体、融资标的）归到公司库里的哪一家。要求名字本身基本就是这个面，
// 避免“蓝箭航天的供应商某某公司”被整句归给蓝箭。
function resolveName(name) {
  const text = String(name || '').trim();
  if (!text) return null;
  const hits = [...matchText(text).values()];
  if (!hits.length) return null;
  const best = hits.sort((a, b) => b.count - a.count || a.first - b.first)[0];
  const longest = Math.max(...[...best.surfaces].map(s => s.length));
  // 名字比命中面长太多（多出一个完整的公司后缀以外的内容）说明是另一家
  const residue = text.replace(/(股份)?有限(责任)?公司|集团|科技|航空|航天|技术|（.*?）|\(.*?\)/g, '');
  return longest >= Math.min(residue.length, text.length) * 0.6 ? best : null;
}

function cleanSubjectName(name) {
  if (typeof name !== 'string') return '';
  const text = name.trim().replace(/\s+/g, ' ');
  return text && text.length <= 40 && !/\p{Cc}/u.test(text) ? text : '';
}

// 主体公司：标题命中与模型主体 → primary；正文命中 → mention。
function resolveSubjects({ title = '', text = '', modelSubjects = [] } = {}) {
  const subjects = new Map();
  const add = (id, name, role) => {
    const key = id || `name:${name}`;
    const existing = subjects.get(key);
    if (existing) {
      if (role === 'primary') existing.role = 'primary';
      return;
    }
    subjects.set(key, { id: id || null, name, role });
  };
  for (const raw of Array.isArray(modelSubjects) ? modelSubjects.slice(0, 6) : []) {
    const name = cleanSubjectName(raw);
    if (!name) continue;
    const hit = resolveName(name);
    add(hit?.id, hit?.name || name, 'primary');
  }
  const inOrder = hits => [...hits.values()].sort((a, b) => a.first - b.first);
  for (const hit of inOrder(matchText(title))) add(hit.id, hit.name, 'primary');
  for (const hit of inOrder(matchText(String(text).slice(0, 4000)))) add(hit.id, hit.name, 'mention');
  return [...subjects.values()]
    .sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary') || Number(Boolean(b.id)) - Number(Boolean(a.id)))
    .slice(0, 8);
}

const deleteLinks = db.prepare('DELETE FROM article_companies WHERE article_id = ?');
const insertLink = db.prepare(`INSERT INTO article_companies (article_id, company_id, role) VALUES (?, ?, ?)
  ON CONFLICT(article_id, company_id) DO UPDATE SET role = CASE WHEN excluded.role = 'primary' THEN 'primary' ELSE article_companies.role END`);

// 调用方负责事务（持久化与 FTS 双写在同一个事务里）
function writeArticleCompanies(articleId, subjects) {
  deleteLinks.run(articleId);
  const known = index().byId;
  for (const subject of subjects || []) {
    if (subject?.id && known.has(subject.id)) insertLink.run(articleId, subject.id, subject.role === 'primary' ? 'primary' : 'mention');
  }
}

// 升级前的数据、以及新收录一家公司之后：纯代码补一遍关联，不花一次模型调用
function backfillSubjects(limit = 400) {
  const rows = db.prepare(`SELECT id, title, title_zh, ai_summary, summary_raw FROM articles
    WHERE relevant = 1 AND subjects_json IS NULL ORDER BY id DESC LIMIT ?`).all(limit);
  const update = db.prepare('UPDATE articles SET subjects_json = ? WHERE id = ?');
  for (const row of rows) {
    const subjects = resolveSubjects({
      title: `${row.title || ''} ${row.title_zh || ''}`,
      text: `${row.ai_summary || ''} ${row.summary_raw || ''}`
    });
    db.exec('BEGIN IMMEDIATE');
    try {
      update.run(JSON.stringify(subjects), row.id);
      writeArticleCompanies(row.id, subjects);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  return rows.length;
}

// 新增或修改一家公司后，把近 180 天已判相关的资料重新对一遍这家公司的名字
function rematchCompany(id, days = 180) {
  invalidateIndex();
  const company = index().byId.get(id);
  if (!company) return 0;
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  const rows = db.prepare(`SELECT id, title, title_zh, ai_summary, summary_raw, subjects_json FROM articles
    WHERE relevant = 1 AND fetched_at >= ?`).all(cutoff);
  let linked = 0;
  for (const row of rows) {
    const inTitle = matchText(`${row.title || ''} ${row.title_zh || ''}`).has(id);
    const inBody = inTitle || matchText(`${row.ai_summary || ''} ${row.summary_raw || ''}`).has(id);
    if (!inBody) continue;
    insertLink.run(row.id, id, inTitle ? 'primary' : 'mention');
    linked++;
  }
  return linked;
}

// ---------- 管理 ----------
function companyRow(row) {
  return {
    id: row.id,
    name: row.name,
    aliases: parseList(row.aliases_json),
    products: parseList(row.products_json),
    domain: row.domain,
    segment: row.segment,
    region: row.region,
    status: row.status,
    note: row.note,
    custom: Boolean(row.custom),
    watch: Number(row.watch) || 0,
    watchNote: row.watch_note || '',
    enabled: Boolean(row.enabled)
  };
}

function getCompany(id) {
  syncCompanySeed();
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(String(id || ''));
  return row ? companyRow(row) : null;
}

// 关注或被投的公司必须真的有人在抓：没有对应检索线就补一条（东财检索按原始媒体计出版方）。
// 已有同名检索线（含用户手动停用的）一律不动——停用是用户的决定。
function ensureCompanySource(company) {
  if (!company || company.region === 'intl') return false;
  const names = [company.name, ...company.aliases].filter(n => [...n].length >= 2);
  const exists = db.prepare('SELECT id FROM sources WHERE url = ?');
  if (names.some(n => exists.get(`eastmoney://${n}`))) return false;
  return db.prepare(`INSERT OR IGNORE INTO sources (name, type, url, tier, domain, enabled, note, intl)
    VALUES (?, 'api', ?, 'T2', ?, 1, ?, 0)`)
    .run(`关注检索·${company.name}`, `eastmoney://${company.name}`, company.domain || 'both',
      '标记关注/被投时自动创建：跟踪该公司的融资、订单、试验与人事报道。可在信源页停用。').changes > 0;
}

function setWatch(id, level, note) {
  const watch = Number(level);
  if (![0, 1, 2].includes(watch)) throw Object.assign(new Error('关注级别无效'), { status: 400 });
  syncCompanySeed();
  const r = db.prepare('UPDATE companies SET watch = ?, watch_note = COALESCE(?, watch_note), updated_at = ? WHERE id = ?')
    .run(watch, typeof note === 'string' ? note.trim().slice(0, 200) : null, now(), String(id));
  if (!r.changes) throw Object.assign(new Error('公司不存在'), { status: 404 });
  const company = getCompany(id);
  const sourceCreated = watch > 0 ? ensureCompanySource(company) : false;
  return { ...company, sourceCreated };
}

function customId(name) {
  return `u-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 10)}`;
}

function addCompany(input) {
  const name = cleanSubjectName(input?.name);
  if (!name || [...name].length < 2) throw Object.assign(new Error('公司名称需为 2–40 个字符'), { status: 400 });
  const existing = resolveName(name);
  if (existing && existing.name === name) throw Object.assign(new Error(`公司库已有「${existing.name}」`), { status: 409 });
  const id = customId(name);
  const stamp = now();
  db.prepare(`INSERT INTO companies (id, name, aliases_json, products_json, domain, segment, region, status, note, custom, watch, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`)
    .run(id, name, JSON.stringify(stringList(input.aliases)), JSON.stringify(stringList(input.products)),
      DOMAIN_VALUES.has(input.domain) ? input.domain : null,
      typeof input.segment === 'string' ? input.segment.trim().slice(0, 40) || null : null,
      input.region === 'intl' ? 'intl' : 'cn', STATUS_VALUES.has(input.status) ? input.status : 'private',
      typeof input.note === 'string' ? input.note.trim().slice(0, 200) || null : null,
      [0, 1, 2].includes(Number(input.watch)) ? Number(input.watch) : 1, stamp, stamp);
  const linked = rematchCompany(id);
  const company = getCompany(id);
  const sourceCreated = company.watch > 0 ? ensureCompanySource(company) : false;
  require('./deals').relinkDeals();
  return { company, linked, sourceCreated };
}

function updateCompany(id, patch) {
  const company = getCompany(id);
  if (!company) throw Object.assign(new Error('公司不存在'), { status: 404 });
  const aliases = patch?.aliases !== undefined ? stringList(patch.aliases) : company.aliases;
  const products = patch?.products !== undefined ? stringList(patch.products) : company.products;
  const enabled = patch?.enabled !== undefined ? (patch.enabled ? 1 : 0) : (company.enabled ? 1 : 0);
  db.prepare('UPDATE companies SET aliases_json = ?, products_json = ?, enabled = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(aliases), JSON.stringify(products), enabled, now(), company.id);
  const linked = rematchCompany(company.id);
  return { company: getCompany(company.id), linked };
}

function removeCompany(id) {
  const company = getCompany(id);
  if (!company) throw Object.assign(new Error('公司不存在'), { status: 404 });
  if (!company.custom) throw Object.assign(new Error('内置公司不能删除，可以停用'), { status: 400 });
  db.prepare('DELETE FROM companies WHERE id = ?').run(company.id);
  invalidateIndex();
  return { removed: true };
}

// ---------- 读取：公司列表、公司热度、公司详情 ----------

function decay(ageMs, halfLifeHours) {
  return Math.pow(0.5, Math.max(0, ageMs) / 3600e3 / halfLifeHours);
}

function observedAt(row) {
  const fetched = Date.parse(row.fetched_at);
  const published = Date.parse(row.published_at);
  // 来源时间优先；缺失或比发现时间还晚（时区错写、预告稿）时用发现时间
  return Number.isFinite(published) && (!Number.isFinite(fetched) || published <= fetched + 3600e3) ? published : fetched;
}

// 公司热度：窗口内以该公司为主体的报道，每个独立参与者只算一次（取最近一次），按半衰期衰减。
// 与事件热度同一套哲学：一家媒体发十篇只算一次，有很多人在说才是真的热。
function companyHeat({ nowMs = Date.now(), domain = null, watchedOnly = false, limit = 30 } = {}) {
  syncCompanySeed();
  const { heatWindowDays, halfLifeHours } = loadSelection().companies;
  const windowMs = heatWindowDays * 86400e3;
  const since = new Date(nowMs - 2 * windowMs).toISOString();
  const rows = db.prepare(`SELECT ac.company_id, a.id, a.title, a.title_zh, a.url, a.published_at, a.fetched_at, a.featured,
      a.attention_score, a.quality_score, COALESCE(a.participant_key, 'source:' || a.source_id) AS participant, s.name AS source_name
    FROM article_companies ac JOIN articles a ON a.id = ac.article_id JOIN sources s ON s.id = a.source_id
    WHERE ac.role = 'primary' AND a.relevant = 1 AND a.fetched_at >= ?`).all(since);
  const companies = new Map(db.prepare('SELECT * FROM companies WHERE enabled = 1').all().map(r => [r.id, companyRow(r)]));
  const byCompany = new Map();
  for (const row of rows) {
    const company = companies.get(row.company_id);
    if (!company) continue;
    if (domain && company.domain !== domain) continue;
    if (watchedOnly && !company.watch) continue;
    const at = observedAt(row);
    if (!Number.isFinite(at) || at > nowMs) continue;
    const entry = byCompany.get(row.company_id) || { company, current: new Map(), previous: 0, reports: 0, top: null };
    if (at >= nowMs - windowMs) {
      const last = entry.current.get(row.participant);
      if (!last || last.at < at) entry.current.set(row.participant, { at, source: row.source_name });
      entry.reports++;
      const score = Number(row.attention_score ?? row.quality_score) || 0;
      if (!entry.top || score + (row.featured ? 20 : 0) > entry.top.rankScore) {
        entry.top = { id: row.id, title: row.title_zh || row.title, url: row.url, at: new Date(at).toISOString(), rankScore: score + (row.featured ? 20 : 0) };
      }
    } else {
      entry.previous++;
    }
    byCompany.set(row.company_id, entry);
  }
  const dealCounts = new Map(db.prepare(`SELECT company_id, COUNT(*) c, MAX(COALESCE(deal_date, first_seen_at)) last
    FROM deals WHERE company_id IS NOT NULL GROUP BY company_id`).all().map(r => [r.company_id, r]));
  const ranked = [...byCompany.values()]
    .filter(entry => entry.current.size > 0)
    .map(entry => {
      let heat = 0;
      for (const p of entry.current.values()) heat += decay(nowMs - p.at, halfLifeHours);
      const deals = dealCounts.get(entry.company.id);
      return {
        company: entry.company,
        heat: Math.round(heat * 100) / 10,
        participants: entry.current.size,
        reports: entry.reports,
        previousReports: entry.previous,
        trend: entry.previous === 0 ? 'new' : entry.reports > entry.previous * 1.2 ? 'up' : entry.reports < entry.previous * 0.8 ? 'down' : 'flat',
        sources: [...new Set([...entry.current.values()].sort((a, b) => b.at - a.at).map(p => p.source))].slice(0, 6),
        top: entry.top ? { id: entry.top.id, title: entry.top.title, url: entry.top.url, at: entry.top.at } : null,
        deals: deals ? deals.c : 0
      };
    })
    .sort((a, b) => b.heat - a.heat || b.reports - a.reports);
  return { windowDays: heatWindowDays, halfLifeHours, entries: ranked.slice(0, Math.max(1, Math.min(200, limit))) };
}

function listCompanies({ domain = null, watch = null, q = '' } = {}) {
  syncCompanySeed();
  const where = [];
  const params = [];
  if (domain) { where.push('c.domain = ?'); params.push(domain); }
  if (watch === 'watched') where.push('c.watch > 0');
  else if (watch === 'portfolio') where.push('c.watch = 2');
  if (q) {
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.aliases_json LIKE ? ESCAPE '\\' OR c.products_json LIKE ? ESCAPE '\\' OR c.segment LIKE ? ESCAPE '\\')");
    const pattern = `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const rows = db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM article_companies ac JOIN articles a ON a.id = ac.article_id
        WHERE ac.company_id = c.id AND a.relevant = 1 AND a.fetched_at >= ?) AS mentions30d,
      (SELECT MAX(COALESCE(a.published_at, a.fetched_at)) FROM article_companies ac JOIN articles a ON a.id = ac.article_id
        WHERE ac.company_id = c.id AND a.relevant = 1) AS last_at,
      (SELECT COUNT(*) FROM deals d WHERE d.company_id = c.id) AS deals
    FROM companies c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY c.watch DESC, mentions30d DESC, c.name`).all(since, ...params);
  return rows.map(row => ({ ...companyRow(row), mentions30d: row.mentions30d, lastAt: row.last_at, deals: row.deals }));
}

module.exports = {
  WATCH_LEVELS,
  syncCompanySeed,
  matchText,
  resolveName,
  resolveSubjects,
  writeArticleCompanies,
  backfillSubjects,
  rematchCompany,
  invalidateIndex,
  getCompany,
  setWatch,
  ensureCompanySource,
  addCompany,
  updateCompany,
  removeCompany,
  companyHeat,
  listCompanies,
  observedAt
};
