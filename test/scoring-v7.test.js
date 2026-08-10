'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scoring = require('../server/ai/scoring');
const calibration = require('../server/ai/calibration');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'scoring.json'), 'utf8'));
const DIMS = { importance: 60, novelty: 55, credibility: 60, impact: 55, timeliness: 60 };

test('计分参数齐备，三个新信号都可调', () => {
  for (const key of ['lexiconBoost', 'corroborationBoost', 'noisePenalty', 'adaptiveFeatured']) {
    assert.ok(config[key] && typeof config[key] === 'object', `缺少 ${key}`);
  }
  assert.ok(config.lexiconBoost.maxBonus > 0);
  assert.ok(config.corroborationBoost.maxBonus > 0);
  assert.ok(config.noisePenalty.perHit > 0);
  assert.ok(config.clusterMaxSize >= 2);
  assert.ok(config.clusterMinSharedGrams >= 1);
});

test('饱和曲线收益递减，堆词堆信源刷不满分', () => {
  assert.equal(scoring.saturate(0), 0);
  assert.ok(Math.abs(scoring.saturate(1) - 0.5) < 1e-9);
  assert.ok(Math.abs(scoring.saturate(2) - 0.75) < 1e-9);
  assert.ok(scoring.saturate(100) <= 1, '饱和曲线不得越过 1');
  // 单调递增
  assert.ok(scoring.saturate(3) > scoring.saturate(2));
});

test('旧调用签名仍成立：第二参数传 tier 字符串等价于只给 tier', () => {
  assert.equal(
    scoring.computeQuality(DIMS, 'T1', config),
    scoring.computeQuality(DIMS, { tier: 'T1' }, config)
  );
});

test('词库贴合度按权重和加成，且有上限', () => {
  const base = scoring.computeQuality(DIMS, { tier: 'T2' }, config);
  const light = scoring.computeQuality(DIMS, { tier: 'T2', lexicon: { weightSum: 6 } }, config);
  const heavy = scoring.computeQuality(DIMS, { tier: 'T2', lexicon: { weightSum: 60 } }, config);
  assert.ok(light > base, '命中词库应当加分');
  assert.ok(heavy > light, '权重和更大应当加更多');
  assert.ok(heavy - base <= config.lexiconBoost.maxBonus + 1e-6, '加成不得超过 maxBonus');
});

test('多源印证：单条报道不加分，簇越大加得越多但封顶', () => {
  const alone = scoring.computeQuality(DIMS, { tier: 'T2', clusterSize: 1 }, config);
  const base = scoring.computeQuality(DIMS, { tier: 'T2' }, config);
  assert.equal(alone, base, '簇大小 1 等于没有印证，不能加分');

  const three = scoring.computeQuality(DIMS, { tier: 'T2', clusterSize: 3 }, config);
  const twelve = scoring.computeQuality(DIMS, { tier: 'T2', clusterSize: 12 }, config);
  assert.ok(three > alone);
  assert.ok(twelve > three);
  assert.ok(twelve - alone <= config.corroborationBoost.maxBonus + 1e-6);
});

test('噪声惩罚随命中数加深并封顶，分数不会掉成负数', () => {
  const clean = scoring.computeQuality(DIMS, { tier: 'T2' }, config);
  const one = scoring.computeQuality(DIMS, { tier: 'T2', noiseHits: 1 }, config);
  const many = scoring.computeQuality(DIMS, { tier: 'T2', noiseHits: 99 }, config);
  assert.ok(one < clean);
  assert.ok(many < one);
  assert.ok(clean - many <= config.noisePenalty.maxPenalty + 1e-6);
  assert.ok(scoring.computeQuality(
    { importance: 0, novelty: 0, credibility: 0, impact: 0, timeliness: 0 },
    { tier: 'T2', noiseHits: 99 }, config) >= 0);
});

test('质量分始终夹在 0 到 100 之间', () => {
  const perfect = { importance: 100, novelty: 100, credibility: 100, impact: 100, timeliness: 100 };
  assert.equal(scoring.computeQuality(perfect,
    { tier: 'T1', lexicon: { weightSum: 999 }, clusterSize: 99 }, config), 100);
});

test('技术突破强度为零时热度与旧公式逐值一致', () => {
  const now = Date.parse('2026-07-31T08:00:00.000Z');
  const publishedAt = '2026-07-30T20:00:00.000Z';
  const expected = 80 * Math.pow(0.5, 12 / config.heatDecayHalfLifeHours);

  assert.equal(scoring.heatScore(80, publishedAt, config, now), expected);
  assert.equal(
    scoring.heatScore(80, publishedAt, config, now, { score: 0, bonus: 0 }),
    expected
  );
});

test('可信技术突破提升初始热度并延长半衰期但不越过 100', () => {
  const runtimeConfig = {
    ...config,
    breakthroughBoost: {
      maxHalfLifeExtensionHours: 18
    }
  };
  const now = Date.parse('2026-07-31T08:00:00.000Z');
  const publishedAt = '2026-07-30T20:00:00.000Z';
  const score = 0.75;
  const bonus = 8;
  const effectiveQuality = Math.min(100, 96 + bonus);
  const effectiveHalfLife = config.heatDecayHalfLifeHours + 18 * score;
  const expected = effectiveQuality * Math.pow(0.5, 12 / effectiveHalfLife);

  assert.equal(
    scoring.heatScore(96, publishedAt, runtimeConfig, now, { score, bonus }),
    expected
  );
  assert.ok(scoring.heatScore(96, publishedAt, runtimeConfig, now, { score, bonus }) <= 100);
  assert.ok(
    scoring.heatScore(96, publishedAt, runtimeConfig, now, { score, bonus })
      > scoring.heatScore(96, publishedAt, runtimeConfig, now)
  );
});

test('自适应偏移与启发式折扣互斥，不会把门槛砍两遍', () => {
  const staticThreshold = config.featuredThresholds.default;
  const discount = config.heuristicThresholdDiscount;

  // 只有折扣（无偏移）
  assert.equal(
    scoring.resolveThreshold('企业动态', config, { heuristic: true, shift: 0 }),
    Math.round(staticThreshold * discount * 10) / 10
  );
  // 有偏移时忽略折扣：否则 70 × 0.85 − 10 = 49.5，六成条目都会变成「精选」
  assert.equal(
    scoring.resolveThreshold('企业动态', config, { heuristic: true, shift: -10 }),
    staticThreshold - 10
  );
  assert.equal(
    scoring.resolveThreshold('企业动态', config, { heuristic: false, shift: -10 }),
    staticThreshold - 10
  );
});

test('偏移保留各分类之间的相对高低', () => {
  const opinion = scoring.resolveThreshold('观点报告', config, { shift: -6 });
  const policy = scoring.resolveThreshold('政策法规', config, { shift: -6 });
  assert.ok(opinion > policy, '观点报告本来就比政策法规严，偏移后仍应更严');
  assert.equal(
    opinion - policy,
    config.featuredThresholds['观点报告'] - config.featuredThresholds['政策法规']
  );
});

test('isFeatured 兼容旧的布尔第四参数', () => {
  const quality = 60;
  assert.equal(
    scoring.isFeatured(quality, '企业动态', config, true),
    scoring.isFeatured(quality, '企业动态', config, { heuristic: true })
  );
});

test('分位阈值精确对齐目标精选率', () => {
  const qualities = Array.from({ length: 200 }, (_, i) => i * 0.5);  // 0 .. 99.5
  const threshold = calibration.quantileThreshold(qualities, 0.14);
  const passing = qualities.filter(q => q >= threshold).length;
  assert.ok(Math.abs(passing / qualities.length - 0.14) <= 0.01, `实际比例 ${passing / 200}`);
});

test('样本不足时不做校准，宁可用静态阈值也不被少量数据带跑', () => {
  const result = calibration.resolveThresholdShift({
    qualities: [90, 85, 80], staticThreshold: 70, targetRate: 0.14, minSamples: 60
  });
  assert.equal(result.shift, 0);
  assert.equal(result.reason, 'insufficient-samples');
});

test('偏移被夹在 maxShift 内并标记为 clamped', () => {
  const qualities = Array.from({ length: 100 }, () => 99);
  const result = calibration.resolveThresholdShift({
    qualities, staticThreshold: 70, targetRate: 0.14, minSamples: 60, maxShift: 8
  });
  assert.equal(result.shift, 8);
  assert.equal(result.reason, 'clamped');
});

test('淡季分布偏低时偏移为负，把精选率拉回目标值附近', () => {
  // 整体偏低但仍在可达范围内（分位数落在 70 − maxShift 之上）
  const qualities = Array.from({ length: 300 }, (_, i) => 52 + (i % 40) * 0.4);  // 52 .. 67.6
  const result = calibration.resolveThresholdShift({
    qualities, staticThreshold: 70, targetRate: 0.14, minSamples: 60, maxShift: 15
  });
  assert.equal(result.reason, 'calibrated');
  assert.ok(result.shift < 0, '分布低于静态阈值时应当下调门槛');
  const passing = qualities.filter(q => q >= 70 + result.shift).length / qualities.length;
  assert.ok(Math.abs(passing - 0.14) <= 0.03, `校准后精选率 ${passing}，偏离目标过多`);
});

test('maxShift 是精选的质量地板：整批都不合格时宁可空着也不推垃圾', () => {
  // 「top 14% 的垃圾」仍然是垃圾。当一整段时间的分数全部低于地板，
  // 空的精选页才是诚实的答案——它说的是「这几天没有值得你停下来看的东西」。
  const qualities = Array.from({ length: 300 }, (_, i) => 20 + (i % 20) * 0.5);  // 20 .. 29.5
  const result = calibration.resolveThresholdShift({
    qualities, staticThreshold: 70, targetRate: 0.14, minSamples: 60, maxShift: 15
  });
  assert.equal(result.reason, 'clamped');
  assert.equal(result.shift, -15);
  assert.equal(qualities.filter(q => q >= 70 + result.shift).length, 0);
});

// —— heatScore 发布时间防护（与 SQL 侧 HEAT_EXPRESSION 规则一致）——

test('heatScore：无效发布时间（解析不出有限值）按当前时刻取值', () => {
  const now = Date.parse('2026-07-31T08:00:00.000Z');
  const expected = scoring.heatScore(80, null, config, now);
  assert.equal(expected, 80, 'hours=0 时热度等于有效质量分');

  for (const publishedAt of ['not-a-date', null, '']) {
    const value = scoring.heatScore(80, publishedAt, config, now);
    assert.ok(Number.isFinite(value), `${publishedAt} 应产出有限值`);
    assert.equal(value, expected, `${publishedAt} 应按当前时刻取值`);
  }
});

test('heatScore：晚于当前超 48 小时的发布时间改用 fetchedAt（未传则按当前时刻）', () => {
  const now = Date.parse('2026-07-31T08:00:00.000Z');
  const future = new Date(now + 72 * 3600e3).toISOString();
  const fetchedAt = new Date(now - 12 * 3600e3).toISOString();

  const value = scoring.heatScore(80, future, config, now, {}, fetchedAt);
  assert.equal(value, scoring.heatScore(80, fetchedAt, config, now));
  assert.equal(value, 80 * Math.pow(0.5, 12 / config.heatDecayHalfLifeHours));

  // 未传第 6 参时回落当前时刻，不抛异常
  assert.equal(scoring.heatScore(80, future, config, now), 80);
});

test('heatScore：48 小时内的未来时间 hours 夹取为 0', () => {
  const now = Date.parse('2026-07-31T08:00:00.000Z');
  const soon = new Date(now + 3600e3).toISOString();
  assert.equal(scoring.heatScore(80, soon, config, now), 80);
});

// —— computeQuality / resolveThreshold 非有限输入与未知配置的回退 ——

test('computeQuality：维度分非有限值与未知 tier 不崩溃', () => {
  // 维度分 Infinity → 公式结果无穷大，最终夹到 100
  const infinity = scoring.computeQuality(
    { importance: Infinity, novelty: Infinity, credibility: Infinity, impact: Infinity, timeliness: Infinity },
    { tier: 'T2' }, config);
  assert.equal(infinity, 100);

  // 未知 tier（含 undefined）乘数回落 1.0：base = Σ(维度分×权重) = 58
  for (const tier of ['T3', undefined]) {
    assert.equal(scoring.computeQuality(DIMS, { tier }, config), 58);
  }
});

test('resolveThreshold：未配置分类回落 default，偏移钳在 0..100', () => {
  assert.equal(
    scoring.resolveThreshold('未配置的分类', config),
    config.featuredThresholds.default
  );
  assert.equal(scoring.resolveThreshold('企业动态', config, { shift: 50 }), 100);
  assert.equal(scoring.resolveThreshold('企业动态', config, { shift: -100 }), 0);
});

test('isFeatured 在阈值临界点两侧精确翻转', () => {
  const threshold = scoring.resolveThreshold('企业动态', config);
  assert.equal(scoring.isFeatured(threshold, '企业动态', config), true);
  assert.equal(scoring.isFeatured(threshold - 0.1, '企业动态', config), false);
});
