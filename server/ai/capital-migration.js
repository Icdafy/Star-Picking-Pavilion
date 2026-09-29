'use strict';
// v0.2.1：只合并可确定的同名/别名；历史文章、星标和用户备注均保留。
// v0.2.2：融资事件按性质分类，并合并同一公司名称变体的重复记录（见文件末尾）。
const { db } = require('../db');
const companies = require('./companies');
const deals = require('./deals');
const array = value => { try { const parsed=JSON.parse(value || '[]'); return Array.isArray(parsed)?parsed:[]; } catch { return []; } };

function migrateCapital() {
  const v021 = migrateCapitalV021();
  const v022 = migrateCapitalV022();
  return v021 || v022;
}

// 同名 / 别名公司合并：内置条目优先，自建条目的别名、型号、标记与备注并入
function mergeDuplicateCompanies() {
    const rows = db.prepare('SELECT * FROM companies ORDER BY custom, created_at, id').all();
    const accepted = [];
    for (const row of rows) {
      const key = companies.identityKey(row.name);
      const matches = accepted.filter(c => [c.name, ...array(c.aliases_json)].some(n => companies.identityKey(n) === key));
      if (matches.length !== 1) { accepted.push(row); continue; }
      const target = matches[0];
      const aliases = [...new Set([...array(target.aliases_json), row.name, ...array(row.aliases_json)])];
      db.prepare('UPDATE companies SET aliases_json=?, products_json=?, watch=MAX(watch,?), watch_note=?, note=? WHERE id=?')
        .run(JSON.stringify(aliases), JSON.stringify([...new Set([...array(target.products_json), ...array(row.products_json)])]), row.watch,
          [target.watch_note, row.watch_note].filter(Boolean).join('\n'), [target.note, row.note].filter(Boolean).join('\n'), target.id);
      db.prepare(`INSERT INTO article_companies (article_id, company_id, role) SELECT article_id, ?, role FROM article_companies WHERE company_id=?
        ON CONFLICT(article_id, company_id) DO UPDATE SET role=CASE WHEN excluded.role='primary' THEN 'primary' ELSE article_companies.role END`).run(target.id, row.id);
      db.prepare('UPDATE deals SET company_id=?, company_name=? WHERE company_id=?').run(target.id,target.name,row.id);
      db.prepare('DELETE FROM companies WHERE id=?').run(row.id);
      Object.assign(target, db.prepare('SELECT * FROM companies WHERE id=?').get(target.id));
    }
    companies.invalidateIndex();
}

function migrateCapitalV021() {
  if (db.prepare("SELECT value FROM meta WHERE key='capitalIdentityV021'").get()) return false;
  companies.syncCompanySeed();
  db.exec('BEGIN IMMEDIATE');
  try {
    mergeDuplicateCompanies();
    // 重写历史主体引用，避免前端仍显示已合并名称。
    for (const row of db.prepare('SELECT id, subjects_json FROM articles WHERE subjects_json IS NOT NULL').all()) {
      const seen = new Map();
      const linked = db.prepare('SELECT c.id, c.name, ac.role FROM article_companies ac JOIN companies c ON c.id=ac.company_id WHERE ac.article_id=?').all(row.id);
      for (const subject of [...array(row.subjects_json), ...linked]) {
        const hit = companies.resolveName(subject.name);
        const next = hit ? { ...subject, id:hit.id, name:hit.name } : subject;
        const key = next.id || companies.identityKey(next.name);
        if (!seen.has(key) || next.role === 'primary') seen.set(key,next);
      }
      const subjects = [...seen.values()];
      db.prepare('UPDATE articles SET subjects_json=? WHERE id=?').run(JSON.stringify(subjects),row.id);
      // writeArticleCompanies 的新采集索引只含启用公司；迁移须额外保留用户停用公司的既有引用。
      companies.writeArticleCompanies(row.id, subjects);
      for (const prior of linked) db.prepare(`INSERT INTO article_companies(article_id,company_id,role) VALUES(?,?,?)
        ON CONFLICT(article_id,company_id) DO UPDATE SET role=CASE WHEN excluded.role='primary' THEN 'primary' ELSE article_companies.role END`).run(row.id,prior.id,prior.role);
    }
    // 只重键并合并确切相同公司+轮次的记录，所有证据与投资方取并集。
    reconcileDeals();
    db.prepare("INSERT INTO meta(key,value) VALUES('capitalIdentityV021','1')").run();
    db.exec('COMMIT');
    return true;
  } catch (error) { db.exec('ROLLBACK'); companies.invalidateIndex(); throw error; }
}
function reconcileDeals() {
    for (const row of db.prepare('SELECT * FROM deals ORDER BY id').all()) {
      const hit = deals.resolveDealCompany(row.company_name) || companies.getCompany(row.company_id);
      const name = hit?.name || row.company_name;
      const at = db.prepare('SELECT published_at FROM articles WHERE id=?').get(row.first_article_id)?.published_at || row.first_seen_at;
      const key = deals.dealKey(hit?.id || `name:${companies.identityKey(name)}`, row.round, row.deal_date, at);
      const other = db.prepare('SELECT * FROM deals WHERE deal_key=? AND id<>?').get(key,row.id);
      if (other) {
        const ids = [...new Set([...array(other.article_ids_json), ...array(row.article_ids_json)])];
        db.prepare(`UPDATE deals SET article_ids_json=?, source_count=?, investors_json=?, lead_investors_json=?,
          amount_text=COALESCE(amount_text,?), amount_cny=COALESCE(amount_cny,?), status=?, first_seen_at=MIN(first_seen_at,?), updated_at=MAX(updated_at,?) WHERE id=?`)
          .run(JSON.stringify(ids), ids.length, JSON.stringify([...new Set([...array(other.investors_json), ...array(row.investors_json)])]),
            JSON.stringify([...new Set([...array(other.lead_investors_json), ...array(row.lead_investors_json)])]),row.amount_text,row.amount_cny,
            deals.STATUS_RANK[row.status]>deals.STATUS_RANK[other.status]?row.status:other.status,row.first_seen_at,row.updated_at,other.id);
        db.prepare('DELETE FROM deals WHERE id=?').run(row.id);
      } else db.prepare('UPDATE deals SET deal_key=?, company_id=?, company_name=? WHERE id=?').run(key,hit?.id||null,name,row.id);
    }
}
// ---------- v0.2.2 ----------
// ① 新增内置公司后重新关联近 180 天报道；② 融资事件重新归属公司并按性质分类（股权 / 上市进程 / 并购 /
// 上市公司再融资 / 债权）；③ 同一公司（公司库内同一 id，或库外名称变体）±45 天、轮次相容的记录合并。
// 证据文章、投资方取并集，状态只升不降，轮次取写明的一方；不删除任何文章。
function classifyAllKinds() {
  const rows = db.prepare(`SELECT d.id, d.round, d.company_id, c.status AS company_status, a.title, a.title_zh, a.ai_summary, a.summary_raw
    FROM deals d LEFT JOIN companies c ON c.id = d.company_id LEFT JOIN articles a ON a.id = d.first_article_id`).all();
  const update = db.prepare('UPDATE deals SET deal_kind = ? WHERE id = ?');
  let changed = 0;
  for (const row of rows) {
    const kind = deals.classifyKind({ round: row.round, companyStatus: row.company_status,
      text: [row.title, row.title_zh, row.ai_summary || row.summary_raw].filter(Boolean).join(' ') });
    changed += update.run(kind, row.id).changes;
  }
  return changed;
}

function dealDay(row) {
  const at = db.prepare('SELECT published_at FROM articles WHERE id=?').get(row.first_article_id)?.published_at;
  return Date.parse(row.deal_date || at || row.first_seen_at);
}

function absorb(target, source) {
  const ids = [...new Set([...array(target.article_ids_json), ...array(source.article_ids_json)])].slice(-40);
  const round = target.round === '未披露' ? source.round : target.round;
  const status = deals.STATUS_RANK[source.status] > deals.STATUS_RANK[target.status] ? source.status : target.status;
  const kindRank = { equity: 3, ipo: 3, ma: 3, secondary: 1, debt: 1, jv: 1 };
  const kind = (kindRank[source.deal_kind] || 0) > (kindRank[target.deal_kind] || 0) ? source.deal_kind : target.deal_kind;
  db.prepare('DELETE FROM deals WHERE id=?').run(source.id);
  db.prepare(`UPDATE deals SET round=?, article_ids_json=?, source_count=?, investors_json=?, lead_investors_json=?,
      amount_text=COALESCE(amount_text,?), amount_cny=COALESCE(amount_cny,?), status=?, deal_date=COALESCE(deal_date,?),
      domain=COALESCE(domain,?), deal_kind=?, first_seen_at=MIN(first_seen_at,?), updated_at=MAX(updated_at,?) WHERE id=?`)
    .run(round, JSON.stringify(ids), ids.length,
      JSON.stringify([...new Set([...array(target.investors_json), ...array(source.investors_json)])].slice(0, 12)),
      JSON.stringify([...new Set([...array(target.lead_investors_json), ...array(source.lead_investors_json)])].slice(0, 6)),
      source.amount_text, source.amount_cny, status, source.deal_date, source.domain, kind, source.first_seen_at, source.updated_at, target.id);
  // 轮次由“未披露”补全后，键也随之更新（撞键说明已有同一笔，交给下一轮合并）
  if (target.round === '未披露' && round !== '未披露') {
    const base = String(target.deal_key).split('|')[0];
    const key = deals.dealKey(base, round, target.deal_date || source.deal_date, target.first_seen_at);
    if (!db.prepare('SELECT 1 FROM deals WHERE deal_key=? AND id<>?').get(key, target.id)) db.prepare('UPDATE deals SET deal_key=? WHERE id=?').run(key, target.id);
  }
  return db.prepare('SELECT * FROM deals WHERE id=?').get(target.id);
}

function mergeDealVariants() {
  let merged = 0;
  const rows = db.prepare('SELECT * FROM deals ORDER BY source_count DESC, id').all();
  const alive = new Map(rows.map(r => [r.id, r]));
  const identity = new Map(rows.map(r => [r.id, r.company_id ? `id:${r.company_id}` : deals.dealIdentity(r.company_name)]));
  const day = new Map(rows.map(r => [r.id, dealDay(r)]));
  for (const row of rows) {
    if (!alive.has(row.id)) continue;
    let target = alive.get(row.id);
    for (const other of rows) {
      if (other.id === target.id || !alive.has(other.id)) continue;
      const a = identity.get(target.id), b = identity.get(other.id);
      const same = a.startsWith('id:') || b.startsWith('id:') ? a === b : deals.sameIdentity(a, b);
      if (!same || !deals.roundsCompatible(target.round, other.round)) continue;
      if (!(Math.abs(day.get(target.id) - day.get(other.id)) <= 45 * 86400e3)) continue;
      // 未披露轮次的并购 / 转让 / 战略融资不跨月合并，避免把一家公司先后两次交易并成一条
      if (target.round === other.round && ['并购', '股权转让', '战略融资'].includes(target.round)
        && String(target.deal_key).split('|')[2] !== String(other.deal_key).split('|')[2]) continue;
      target = absorb(target, alive.get(other.id));
      alive.delete(other.id);
      alive.set(target.id, target);
      merged++;
    }
  }
  return merged;
}

function migrateCapitalV022() {
  if (db.prepare("SELECT value FROM meta WHERE key='capitalV022'").get()) return false;
  companies.syncCompanySeed();
  db.exec('BEGIN IMMEDIATE');
  try {
    mergeDuplicateCompanies();
    // 本版新增的内置公司：把近 180 天报道关联上（与收录公司同一逻辑）
    for (const { id } of db.prepare("SELECT id FROM companies WHERE custom = 0 AND id IN (SELECT value FROM json_each(?))").all(JSON.stringify(V022_COMPANIES))) {
      companies.rematchCompany(id);
    }
    reconcileDeals();
    const kinds = classifyAllKinds();
    const merged = mergeDealVariants();
    db.prepare("INSERT INTO meta(key,value) VALUES('capitalV022',?)").run(JSON.stringify({ kinds, merged }));
    db.exec('COMMIT');
    return true;
  } catch (error) { db.exec('ROLLBACK'); companies.invalidateIndex(); throw error; }
}

const V022_COMPANIES = Object.freeze(['govy', 'lanxiao-aviation', 'huayu-xianxiang', 'yuntu-aviation', 'jiushidu-aviation', 'shangfei-aviation',
  'hangjing', 'hanglian-tech', 'kasen-aviation', 'qingwei-aviation', 'yufeng-flight', 'weifen-aerospace', 'zhixing-space']);

module.exports = { migrateCapital, reconcileDeals, classifyAllKinds, mergeDealVariants };

