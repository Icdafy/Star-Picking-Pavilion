'use strict';
// 事件聚类 —— 同一事件多家报道折叠成一个事件簇
// 用字符 bigram overlap 相似度（纯代码，零成本），官方源优先当主条
// （AIHOT 用 embedding，这里先用代码方案，后续可在此模块换成 embedding 接口）
//
// 性能：分析循环每 75 秒调一次，逐对比较是 O(n²)×集合大小，72 小时窗口下会长时间阻塞事件循环。
// 改为倒排索引计数：交集大小由倒排表累加得到，与逐对比较**结果完全一致**，只是不再枚举无交集的对。
// 另外只在分组真正变化时才写库，避免每轮重写全部 cluster_id 把 WAL 撑大。
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

// 倒排索引求相似对：postings[bigram] → 已处理文档下标；对文档 i 累加得到与每个 j 的精确交集大小
function findSimilarPairs(docs, threshold, onPair) {
  const postings = new Map();
  const shared = new Map();
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    shared.clear();
    for (const gram of doc.grams) {
      const bucket = postings.get(gram);
      if (bucket) {
        for (const j of bucket) shared.set(j, (shared.get(j) || 0) + 1);
      } else {
        postings.set(gram, [i]);
        continue;
      }
      bucket.push(i);
    }
    for (const [j, count] of shared) {
      const other = docs[j];
      // 跨领域（低空 vs 航天）不并簇，避免文本相近导致误合
      if (doc.domain && other.domain && doc.domain !== other.domain) continue;
      const smaller = Math.min(doc.grams.size, other.grams.size);
      if (smaller && count / smaller >= threshold) onPair(other, doc);
    }
  }
}

const TIER_RANK = { 'T1': 3, 'T1.5': 2, 'T2': 1 };

function mainArticleOf(members) {
  return [...members].sort((a, b) =>
    ((TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0))
    || ((b.quality_score || 0) - (a.quality_score || 0)))[0];
}

// 判断「本轮算出的分组」是否与库中现状完全一致，一致则跳过全部写入。
// 必须逐簇核对成员总数与主条，因为簇里可能还有已滑出时间窗、本轮未参与计算的成员。
function matchesStoredClusters(partition, rows) {
  const grouped = new Set();
  for (const members of partition) {
    const clusterId = members[0].cluster_id;
    if (clusterId == null) return false;
    for (const member of members) {
      if (member.cluster_id !== clusterId) return false;
      grouped.add(member.id);
    }
    const stored = db.prepare('SELECT main_article_id, size FROM clusters WHERE id = ?').get(clusterId);
    if (!stored || stored.size !== members.length) return false;
    if (stored.main_article_id !== mainArticleOf(members).id) return false;
    const total = db.prepare('SELECT COUNT(*) c FROM articles WHERE cluster_id = ?').get(clusterId).c;
    if (total !== members.length) return false;
  }
  for (const row of rows) {
    if (!grouped.has(row.id) && row.cluster_id != null) return false;
  }
  const orphans = db.prepare(`SELECT COUNT(*) c FROM clusters
    WHERE id NOT IN (SELECT cluster_id FROM articles WHERE cluster_id IS NOT NULL)`).get().c;
  return orphans === 0;
}

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
  for (const r of rows) r.grams = bigrams(r.title + ' ' + (r.ai_summary || ''));

  // 并查集
  const parent = new Map(rows.map(r => [r.id, r.id]));
  const find = id => { let p = parent.get(id); while (p !== parent.get(p)) p = parent.get(p); parent.set(id, p); return p; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  findSimilarPairs(rows, threshold, (a, b) => union(a.id, b.id));

  const groups = new Map();
  for (const r of rows) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }

  const partition = [...groups.values()].filter(members => members.length > 1);
  // 分组与库中现状一致时直接返回：分析循环每 75 秒跑一次，绝大多数轮次没有新的并簇，
  // 若照旧重写全部 cluster_id，WAL 会被无意义的写入撑大。
  if (matchesStoredClusters(partition, rows)) {
    return { clusters: partition.length, unchanged: true };
  }

  let clusterCount = 0;
  const oldClusterIds = [...new Set(rows.map(row => row.cluster_id).filter(Boolean))];
  db.exec('BEGIN IMMEDIATE');
  try {
    const clear = db.prepare('UPDATE articles SET cluster_id=NULL WHERE id=?');
    for (const row of rows) if (row.cluster_id != null) clear.run(row.id);

    const updateCluster = db.prepare('UPDATE articles SET cluster_id=? WHERE id=?');
    for (const members of partition) {
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

module.exports = { clusterRecent, bigrams, overlap, findSimilarPairs };
