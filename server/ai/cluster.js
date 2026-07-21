'use strict';
// 事件聚类 —— 同一事件多家报道折叠成一个事件簇
// 用字符 bigram Jaccard 相似度（纯代码，零成本），官方源优先当主条
// （AIHOT 用 embedding，这里先用代码方案，后续可在此模块换成 embedding 接口）
const { db, now } = require('../db');
const { loadScoring } = require('../config');

function bigrams(s) {
  const t = String(s || '').replace(/[\s\p{P}]+/gu, '').toLowerCase();
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

// overlap 系数 = 交集 / 较短者 —— 比 Jaccard 更适合长短差异大的中文新闻标题
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

const TIER_RANK = { 'T1': 3, 'T1.5': 2, 'T2': 1 };

function clusterRecent() {
  const scoring = loadScoring();
  const windowH = scoring.clusterWindowHours || 72;
  const threshold = scoring.clusterSimilarityThreshold || 0.5;

  const rows = db.prepare(`
    SELECT a.id, a.title, a.ai_summary, a.domain, a.cluster_id, a.quality_score, s.tier
    FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE a.relevant = 1 AND julianday(a.fetched_at) > julianday('now', ?)
    ORDER BY a.id`).all(`-${windowH} hours`);
  if (!rows.length) return { clusters: 0 };

  // 标题 + AI 摘要一起算 bigram：东财式标题党标题差异大，但 AI 摘要对同一事件描述高度一致，靠摘要才能并簇
  for (const r of rows) r._bg = bigrams(r.title + ' ' + (r.ai_summary || ''));

  // 并查集
  const parent = new Map(rows.map(r => [r.id, r.id]));
  const find = id => { let p = parent.get(id); while (p !== parent.get(p)) p = parent.get(p); parent.set(id, p); return p; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      // 跨领域（低空 vs 航天）不并簇，避免文本相近导致误合
      if (rows[i].domain && rows[j].domain && rows[i].domain !== rows[j].domain) continue;
      if (overlap(rows[i]._bg, rows[j]._bg) >= threshold) union(rows[i].id, rows[j].id);
    }
  }

  const groups = new Map();
  for (const r of rows) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }

  let clusterCount = 0;
  const oldClusterIds = [...new Set(rows.map(row => row.cluster_id).filter(Boolean))];
  db.exec('BEGIN IMMEDIATE');
  try {
    const clear = db.prepare('UPDATE articles SET cluster_id=NULL WHERE id=?');
    for (const row of rows) clear.run(row.id);

    const updateCluster = db.prepare('UPDATE articles SET cluster_id=? WHERE id=?');
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      // 主条：信源等级优先 > 质量分
      members.sort((a, b) =>
        (TIER_RANK[b.tier] - TIER_RANK[a.tier]) || ((b.quality_score || 0) - (a.quality_score || 0)));
      const main = members[0];
      const clusterId = db.prepare('INSERT INTO clusters (main_article_id, size, updated_at) VALUES (?, ?, ?)')
        .run(main.id, members.length, now()).lastInsertRowid;
      for (const member of members) updateCluster.run(clusterId, member.id);
      clusterCount++;
    }

    for (const clusterId of oldClusterIds) {
      const remaining = db.prepare(`SELECT a.id, a.quality_score, s.tier
        FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.cluster_id=?`).all(clusterId);
      if (remaining.length < 2) {
        db.prepare('UPDATE articles SET cluster_id=NULL WHERE cluster_id=?').run(clusterId);
        db.prepare('DELETE FROM clusters WHERE id=?').run(clusterId);
        continue;
      }
      remaining.sort((a, b) =>
        (TIER_RANK[b.tier] - TIER_RANK[a.tier]) || ((b.quality_score || 0) - (a.quality_score || 0)));
      db.prepare('UPDATE clusters SET main_article_id=?, size=?, updated_at=? WHERE id=?')
        .run(remaining[0].id, remaining.length, now(), clusterId);
    }

    db.exec(`DELETE FROM clusters
      WHERE id NOT IN (SELECT DISTINCT cluster_id FROM articles WHERE cluster_id IS NOT NULL)`);
    db.exec('COMMIT');
    return { clusters: clusterCount };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { clusterRecent };
