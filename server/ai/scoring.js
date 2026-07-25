'use strict';
// 计分公式 —— 纯代码、可控可调（参数全在 config/scoring.json，改完秒级生效）
//
// v0.0.7 之前只有：质量分 = Σ(维度权重 × 维度分) × 信源等级系数。
// 模型给的五维分是「这条新闻本身怎么样」，但一条情报值不值得占用注意力，
// 还取决于三件模型看不到、代码却能便宜地算出来的事：
//   ① 领域贴合度 —— 命中核心词库的分量（「朱雀三号首飞」和「某公司提了一句航天」不是一回事）
//   ② 多源印证 —— 同一事件被几家信源同时报道（聚类簇越大，越可能是真的大事）
//   ③ 噪声特征 —— 股评软文、涨停快讯这类形态，五维分往往不低，但对读者是纯干扰
// 于是质量分变成：等级加权的维度分 + 词库加成 + 印证加成 − 噪声惩罚。
//
// 精选判定同步从「固定阈值」升级为「固定阈值 + 自适应偏移」：信息量丰枯不均时，
// 固定阈值会让精选页忽而空荡忽而泛滥；偏移把整体精选率钉在目标值附近（见 calibration.js）。

// 饱和曲线：每增加一个「单位」收益减半，避免堆词、堆信源就能刷满分。
// x=1 → 0.5，x=2 → 0.75，x=3 → 0.875
function saturate(x) {
  if (!(x > 0)) return 0;
  return 1 - Math.pow(0.5, x);
}

function boundedNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// 词库加成：按命中词的权重和给分，而不是按命中个数。
// 一个 w=10 的定义词（低空经济）应当胜过五个 w=2 的边缘词。
function lexiconBonus(lexiconSummary, scoring) {
  const config = scoring.lexiconBoost || {};
  const maxBonus = boundedNumber(config.maxBonus, 0);
  if (maxBonus <= 0 || !lexiconSummary) return 0;
  const saturationWeight = Math.max(1, boundedNumber(config.saturationWeight, 18));
  const weightSum = Math.max(0, boundedNumber(lexiconSummary.weightSum, 0));
  return maxBonus * saturate(weightSum / saturationWeight);
}

// 多源印证加成：簇内除自己以外还有几个信源在说同一件事。
// 单条报道 clusterSize=1 → 0 分，恰好是「没有印证」的正确取值。
function corroborationBonus(clusterSize, scoring) {
  const config = scoring.corroborationBoost || {};
  const maxBonus = boundedNumber(config.maxBonus, 0);
  if (maxBonus <= 0) return 0;
  const saturationSources = Math.max(1, boundedNumber(config.saturationSources, 2));
  const others = Math.max(0, boundedNumber(clusterSize, 1) - 1);
  return maxBonus * saturate(others / saturationSources);
}

// 噪声惩罚：命中的形态特征越多扣得越狠，但有上限——
// 扣分是为了把它压出精选，不是为了把它打成负数。
function noisePenalty(noiseHits, scoring) {
  const config = scoring.noisePenalty || {};
  const perHit = boundedNumber(config.perHit, 0);
  if (perHit <= 0) return 0;
  const maxPenalty = boundedNumber(config.maxPenalty, perHit * 3);
  const hits = Math.max(0, boundedNumber(noiseHits, 0));
  return Math.min(maxPenalty, perHit * hits);
}

// context 全部可选：老调用方传 tier 字符串也仍然成立（见下方兼容分支）
function computeQuality(scores, context, scoring) {
  const resolved = typeof context === 'string' || context == null
    ? { tier: context }
    : context;
  const weights = scoring.dimensionWeights;
  let base = 0;
  for (const key of Object.keys(weights)) base += (Number(scores?.[key]) || 0) * weights[key];

  const multiplier = scoring.tierMultiplier[resolved.tier] ?? 1.0;
  const adjusted = base * multiplier
    + lexiconBonus(resolved.lexicon, scoring)
    + corroborationBonus(resolved.clusterSize, scoring)
    - noisePenalty(resolved.noiseHits, scoring);

  return Math.round(Math.max(0, Math.min(100, adjusted)) * 10) / 10;
}

// 精选门槛：分类静态阈值 →（启发式折扣 或 自适应偏移）。
// 偏移是全局同一个值，各分类之间的相对高低（观点报告最严、政策法规最松）原样保留。
//
// 两种修正互斥，不能叠加。启发式折扣存在的理由是「无 Key 时分数天花板低」，
// 而自适应偏移正是直接量出真实分布再对齐目标精选率——它已经把天花板低这件事算进去了。
// 两者相乘再相加会把门槛砍两次：实测 70 → ×0.85 → 59.5 → −8 → 51.5，
// 于是六成的条目都成了「精选」，精选页彻底失去筛选的意义。
function resolveThreshold(category, scoring, { heuristic = false, shift = 0 } = {}) {
  const thresholds = scoring.featuredThresholds || {};
  let threshold = thresholds[category] ?? thresholds.default ?? 70;
  const calibrated = boundedNumber(shift, 0);
  if (calibrated !== 0) threshold += calibrated;
  else if (heuristic) threshold *= scoring.heuristicThresholdDiscount ?? 0.85;
  return Math.max(0, Math.min(100, Math.round(threshold * 10) / 10));
}

// 第 4 参数历史上是布尔 heuristic，现在也接受 { heuristic, shift } —— 旧调用方不必改
function isFeatured(quality, category, scoring, options = false) {
  const resolved = typeof options === 'boolean' ? { heuristic: options } : (options || {});
  return quality >= resolveThreshold(category, scoring, resolved);
}

function heatScore(quality, publishedAt, scoring, nowMs = Date.now()) {
  const t = publishedAt ? new Date(publishedAt).getTime() : nowMs;
  const hours = Math.max(0, (nowMs - t) / 3600e3);
  const halfLife = scoring.heatDecayHalfLifeHours || 36;
  return quality * Math.pow(0.5, hours / halfLife);
}

module.exports = {
  computeQuality,
  isFeatured,
  resolveThreshold,
  heatScore,
  saturate,
  lexiconBonus,
  corroborationBonus,
  noisePenalty
};
