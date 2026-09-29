'use strict';
// 字面相似度原语 —— 事件归组（ai/stories）的召回通道。
//
// 标题 + 摘要切成字符 bigram，用 overlap 系数（交集 / 较短者）比较：它比 Jaccard 更适合
// 长短差异大的中文新闻标题。倒排索引只枚举真正有交集的文档对，结果与逐对比较完全一致。
// v0.2.0 之前这里还有一套“整窗口并查集重算 + 语义合并”的聚类；它被 AIHOT 式的增量事件归组
// 取代（ai/stories：召回 → 自动归入 / 模型判定 → 事件），只保留这组纯函数。

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
//
// minShared 是防「串珠成链」的关键。overlap 系数的分母是较短者，短标题因此极易越过阈值：
// 一条 14 字的标题只有 13 个 bigram，撞上 6 个就是 0.46，比 0.42 的阈值还高。
// 而并查集是单链接聚类——A~B、B~C、C~D 会把整条链并成一个簇。
// 实测 2000 条规模下出现过 149 条的巨簇，既毁了折叠展示，也让「多源印证」加成变成人人有份。
// 再加一条绝对交集下限，短标题必须真的共享足够多的字，链就断在源头。
function findSimilarPairs(docs, threshold, onPair, minShared = 0) {
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
      if (count < minShared) continue;
      const other = docs[j];
      // 跨领域（低空 vs 航天）不并簇，避免文本相近导致误合
      if (doc.domain && other.domain && doc.domain !== other.domain) continue;
      const smaller = Math.min(doc.grams.size, other.grams.size);
      if (smaller && count / smaller >= threshold) onPair(other, doc);
    }
  }
}

module.exports = { bigrams, overlap, findSimilarPairs };
