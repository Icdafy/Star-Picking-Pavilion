'use strict';
// v0.2.1：只合并可确定的同名/别名；历史文章、星标和用户备注均保留。
const { db } = require('../db');
const companies = require('./companies');
const deals = require('./deals');
const array = value => { try { const parsed=JSON.parse(value || '[]'); return Array.isArray(parsed)?parsed:[]; } catch { return []; } };

function migrateCapital() {
  if (db.prepare("SELECT value FROM meta WHERE key='capitalIdentityV021'").get()) return false;
  companies.syncCompanySeed();
  db.exec('BEGIN IMMEDIATE');
  try {
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
      const hit = companies.resolveName(row.company_name) || companies.getCompany(row.company_id);
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
module.exports = { migrateCapital, reconcileDeals };
