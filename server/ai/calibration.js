'use strict';
// 精选率自适应校准 —— 让「精选」在信息丰枯不均的日子里保持同一个含金量。
//
// 固定阈值的毛病很实在：赶上发射周、政策集中出台的一周，70 分以上能有三四十条，
// 精选页变成第二个信息流；淡季连着几天一条都够不着，用户打开只看到空页。
// AIHOT 的经验值是精选率 ~14%——那是「一天里值得你停下来看的比例」，
// 而不是「70 分」这个绝对刻度。所以这里把目标锁在比例上：
// 取最近若干天已判定相关的质量分分布，找出目标比例对应的分位数，
// 与静态阈值的差就是偏移量，再夹到 maxShift 以内，防止阈值被异常分布带跑。
//
// 全程纯 SQL + 纯算术，不花一分钱模型调用（沿用「能用脚本就别用模型」）。
const { db } = require('../db');

// 分位阈值：把质量分降序排列，取第 ⌈n×targetRate⌉ 个作为「刚好卡住目标比例」的分数
function quantileThreshold(qualities, targetRate) {
  const sorted = [...qualities].sort((a, b) => b - a);
  if (!sorted.length) return null;
  const rate = Math.min(1, Math.max(0.01, targetRate));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rate) - 1));
  return sorted[index];
}

// 纯函数，便于直接断言：给定分布与静态基准，算出应当施加的偏移
function resolveThresholdShift({
  qualities, staticThreshold, targetRate, minSamples = 60, maxShift = 8
}) {
  if (!Array.isArray(qualities) || qualities.length < minSamples) {
    return { shift: 0, reason: 'insufficient-samples', samples: qualities?.length || 0 };
  }
  const desired = quantileThreshold(qualities, targetRate);
  if (desired == null) return { shift: 0, reason: 'no-distribution', samples: qualities.length };
  const raw = desired - staticThreshold;
  const bounded = Math.max(-maxShift, Math.min(maxShift, raw));
  return {
    shift: Math.round(bounded * 10) / 10,
    reason: Math.abs(raw) > maxShift ? 'clamped' : 'calibrated',
    samples: qualities.length,
    desiredThreshold: Math.round(desired * 10) / 10
  };
}

function sampleQualities(days) {
  return db.prepare(`
    SELECT quality_score AS q FROM articles
    WHERE relevant = 1 AND quality_score IS NOT NULL
      AND julianday(COALESCE(published_at, fetched_at)) > julianday('now', ?)`)
    .all(`-${Math.max(1, Math.round(days))} days`)
    .map(row => Number(row.q))
    .filter(Number.isFinite);
}

// 每篇文章都重算一次分布是荒唐的（分析循环一批就是 60 条）。
// 分布本身是慢变量，缓存几分钟完全够用。
const CACHE_TTL_MS = 5 * 60_000;
let cache = null;

function currentShift(scoring, nowMs = Date.now()) {
  const config = scoring.adaptiveFeatured || {};
  if (config.enabled === false) return { shift: 0, reason: 'disabled', samples: 0 };
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.value;

  const value = resolveThresholdShift({
    qualities: sampleQualities(config.sampleDays ?? 14),
    staticThreshold: scoring.featuredThresholds?.default ?? 70,
    targetRate: config.targetRate ?? 0.14,
    minSamples: config.minSamples ?? 60,
    maxShift: config.maxShift ?? 8
  });
  cache = { at: nowMs, value };
  return value;
}

function invalidate() {
  cache = null;
}

module.exports = { currentShift, invalidate, resolveThresholdShift, quantileThreshold, sampleQualities };
