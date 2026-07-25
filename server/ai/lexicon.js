'use strict';
// 核心词库引擎 —— config/lexicon.json 的唯一读取入口。
//
// 词库是 v0.0.7 的地基，三处共用同一份事实，避免「关键词表」在代码里散落成好几套：
//   ① 检索面板（GET /api/lexicon）：分组罗列 + 每词在本地库中的命中条数
//   ② 打分（scoring.computeQuality）：命中词的权重决定相关度加成
//   ③ 采集与预筛（collectors/api.js、pipeline.js）：关键词型信源的入库守卫与启发式降级
//
// 匹配是纯字符串包含，不做分词：中文标题里「低空经济」就是连续四个字，
// 引入分词器只会带来依赖和歧义，而这里要的恰恰是确定性。
const fs = require('node:fs');
const path = require('node:path');

const LEXICON_PATH = path.join(__dirname, '..', '..', 'config', 'lexicon.json');
const DOMAINS = new Set(['lowaltitude', 'aerospace']);

let cache = null;

function normalizeTerm(raw, group) {
  const canonical = String(raw?.t || '').trim();
  if (!canonical) return null;
  const weight = Number(raw?.w);
  const aliases = Array.isArray(raw?.a)
    ? [...new Set(raw.a.map(a => String(a || '').trim()).filter(Boolean))]
    : [];
  return {
    term: canonical,
    aliases,
    // 匹配面 = 规范词 + 全部别名。长词优先，让「低空经济示范区」先于「低空经济」被认领，
    // 命中计数才不会把一次出现算成两次。
    surfaces: [canonical, ...aliases].sort((a, b) => b.length - a.length),
    weight: Number.isFinite(weight) ? Math.max(0, Math.min(10, weight)) : 5,
    group: group.id,
    groupLabel: group.label,
    domain: group.domain
  };
}

function build() {
  const raw = JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf8'));
  const groups = [];
  const terms = [];
  for (const rawGroup of raw.groups || []) {
    const domain = DOMAINS.has(rawGroup.domain) ? rawGroup.domain : 'lowaltitude';
    const group = {
      id: String(rawGroup.id || '').trim() || `group-${groups.length}`,
      label: String(rawGroup.label || '').trim() || '未命名分组',
      domain,
      terms: []
    };
    for (const rawTerm of rawGroup.terms || []) {
      const term = normalizeTerm(rawTerm, group);
      if (!term) continue;
      group.terms.push(term);
      terms.push(term);
    }
    if (group.terms.length) groups.push(group);
  }
  // 全局按长度倒序：matchText 逐词扫描时，长词先消费掉自己的位置
  const ordered = [...terms].sort((a, b) =>
    b.surfaces[0].length - a.surfaces[0].length || b.weight - a.weight);
  return {
    version: Number(raw._version || 1),
    groups,
    terms,
    ordered,
    byDomain: {
      lowaltitude: terms.filter(t => t.domain === 'lowaltitude'),
      aerospace: terms.filter(t => t.domain === 'aerospace')
    }
  };
}

function loadLexicon() {
  if (!cache) cache = build();
  return cache;
}

// 测试与「改词库后热更新」用；生产路径不必调用
function reloadLexicon() {
  cache = null;
  return loadLexicon();
}

// 文本中命中的词条。同一词条命中多次只算一次——一篇稿子把「低空经济」写十遍，
// 并不比写一遍更相关，按次数累加只会让长文和复读机拿到虚高的分。
function matchTerms(text) {
  const haystack = String(text || '');
  if (!haystack) return [];
  const { ordered } = loadLexicon();
  const hits = [];
  for (const term of ordered) {
    const surface = term.surfaces.find(s => haystack.includes(s));
    if (surface) hits.push({ ...term, surface });
  }
  return hits;
}

// 把命中结果压成打分与预筛都能直接用的摘要
function summarize(hits) {
  let lowaltitude = 0;
  let aerospace = 0;
  let weightSum = 0;
  let topWeight = 0;
  for (const hit of hits) {
    weightSum += hit.weight;
    if (hit.weight > topWeight) topWeight = hit.weight;
    if (hit.domain === 'lowaltitude') lowaltitude += hit.weight;
    else aerospace += hit.weight;
  }
  let domain = null;
  if (lowaltitude || aerospace) {
    // 两侧都有权重且相差不到 1.5 倍时算跨领域（例如卫星导航赋能低空航路）
    const ratio = Math.max(lowaltitude, aerospace) / Math.max(1, Math.min(lowaltitude, aerospace));
    if (lowaltitude && aerospace && ratio < 1.5) domain = 'both';
    else domain = lowaltitude >= aerospace ? 'lowaltitude' : 'aerospace';
  }
  return {
    hits,
    count: hits.length,
    weightSum,
    topWeight,
    domain,
    terms: hits.map(h => h.term)
  };
}

function analyze(text) {
  return summarize(matchTerms(text));
}

// 领域判定：需要一个「定义级」词（w≥6：领域定义词或具名主体），或多个中等词共同支撑。
// 单独一个「卫星」「航空」不足以把一篇稿子拉进情报库——那正是 v0.0.6 噪声的来源之一；
// 但门槛也不能高到把「中国商飞」「山河智能」这种单个具名主体挡在外面：
// 一条新闻只要主语是这个赛道里的公司，它就是这个赛道的新闻。
// （w≥8 定死为领域定义词，w=6~7 为核心主体，两者都足以单独定性。）
const DEFINING_WEIGHT = 6;
const SUPPORTING_WEIGHT = 4;

function isRelevantSummary(summary) {
  if (!summary.count) return false;
  if (summary.topWeight >= DEFINING_WEIGHT) return true;
  const supporting = summary.hits.filter(h => h.weight >= SUPPORTING_WEIGHT).length;
  return supporting >= 2 || summary.weightSum >= 10;
}

// 检索面板用：把词库摊平成 {term, aliases, group, domain, weight}，供前端按组渲染
function listTerms() {
  const { groups } = loadLexicon();
  return groups.map(group => ({
    id: group.id,
    label: group.label,
    domain: group.domain,
    terms: group.terms.map(term => ({
      term: term.term,
      aliases: term.aliases,
      weight: term.weight
    }))
  }));
}

module.exports = {
  LEXICON_PATH,
  loadLexicon,
  reloadLexicon,
  matchTerms,
  summarize,
  analyze,
  isRelevantSummary,
  listTerms,
  DEFINING_WEIGHT,
  SUPPORTING_WEIGHT
};
