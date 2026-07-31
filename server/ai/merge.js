'use strict';
// 管线第 8 段：语义合并。
//
// 第 7 段的 bigram 聚类看的是字面：同一件事被两家用完全不同的说法写出来
// （「朱雀三号完成首飞」vs「蓝箭可复用火箭首次飞行成功」）就并不到一起。
// 这一段补上语义通道，用第 5、6 段抠出来的结构化信号对齐：
//   ① 主事件键相同 —— 同主体、同动作类、同客体，那就是同一件事，直接并
//   ② 锚点实体重叠 + 动作类相同 —— 键没对上（客体写法不同），但说的是同一批
//      具名主体在做同一类事，达到共享下限才并
//
// 输出的是「该并的成对关系」，真正的合并交给 cluster.js 的并查集，
// 这样簇容量上限、跨领域禁并这些既有约束依然生效，不会被这里绕过去。

const DEFAULT_OPTIONS = Object.freeze({
  // 锚点通道要求共享的具名实体个数。1 个太松——「又一家公司拿到 SpaceX 订单」
  // 和「SpaceX 发射成功」共享一个 SpaceX 就并簇，那是灾难。
  minSharedAnchors: 2,
  // 出现得太频繁的锚点没有判别力（头部公司几乎条条都提），
  // 让它参与配对只会把桶撑成平方级开销，还净是假阳性。
  maxAnchorPostings: 60
});

function documentOf(row) {
  return {
    id: row.id,
    domain: row.domain || null,
    primaryEventKey: row.primaryEventKey || null,
    actionClass: row.actionClass || null,
    anchorKeys: Array.isArray(row.anchorKeys) ? row.anchorKeys.filter(Boolean) : []
  };
}

function sameDomain(a, b) {
  return !a.domain || !b.domain || a.domain === b.domain;
}

// 通道 ①：主事件键完全相同。桶内取第一条当代表，其余逐个与它配对——
// 并查集是传递的，n 条只需要 n-1 对，不必两两枚举。
function eventKeyPairs(docs, onPair) {
  const buckets = new Map();
  for (const doc of docs) {
    if (!doc.primaryEventKey) continue;
    const bucket = buckets.get(doc.primaryEventKey);
    if (bucket) bucket.push(doc);
    else buckets.set(doc.primaryEventKey, [doc]);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const [head, ...rest] = bucket;
    for (const doc of rest) {
      if (sameDomain(head, doc)) onPair(head, doc, 'event-key');
    }
  }
}

// 通道 ②：倒排计数求共享锚点数。与逐对比较结果一致，但不枚举没有交集的对。
function anchorPairs(docs, onPair, { minSharedAnchors, maxAnchorPostings }) {
  const postings = new Map();
  for (const doc of docs) {
    for (const key of doc.anchorKeys) {
      const bucket = postings.get(key);
      if (bucket) bucket.push(doc);
      else postings.set(key, [doc]);
    }
  }

  const shared = new Map();
  const seen = new Set();
  for (const doc of docs) {
    if (!doc.actionClass || doc.anchorKeys.length < minSharedAnchors) continue;
    shared.clear();
    for (const key of doc.anchorKeys) {
      const bucket = postings.get(key);
      if (!bucket || bucket.length > maxAnchorPostings) continue;
      for (const other of bucket) {
        if (other.id === doc.id) continue;
        shared.set(other, (shared.get(other) || 0) + 1);
      }
    }
    for (const [other, count] of shared) {
      if (count < minSharedAnchors) continue;
      // 动作类必须一致：同一批公司「签约」与「首飞」是两件事
      if (other.actionClass !== doc.actionClass) continue;
      if (!sameDomain(doc, other)) continue;
      const pairId = doc.id < other.id ? `${doc.id}:${other.id}` : `${other.id}:${doc.id}`;
      if (seen.has(pairId)) continue;
      seen.add(pairId);
      onPair(doc, other, 'anchor-overlap');
    }
  }
}

// rows: [{ id, domain, primaryEventKey, actionClass, anchorKeys }]
// onPair(a, b, channel) —— 由调用方决定怎么合并（并查集 union）
function semanticPairs(rows, onPair, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const docs = (Array.isArray(rows) ? rows : []).map(documentOf);
  if (docs.length < 2) return 0;
  let pairs = 0;
  const emit = (a, b, channel) => { pairs++; onPair(a, b, channel); };
  eventKeyPairs(docs, emit);
  anchorPairs(docs, emit, settings);
  return pairs;
}

module.exports = { DEFAULT_OPTIONS, semanticPairs };
