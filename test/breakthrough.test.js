'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeBreakthrough } = require('../server/ai/breakthrough');

const config = Object.freeze({
  version: 1,
  maxBonus: 10,
  maxHalfLifeExtensionHours: 18,
  minimumScores: {
    tier15Credibility: 70,
    corroboratedCredibility: 60
  },
  eligibleCategories: ['技术研发', '发射与任务'],
  completionActions: [
    '首飞', '试飞', '点火成功', '入轨', '回收', '复用',
    '适航取证', '取得型号合格证', '测试通过', '性能验证'
  ],
  uncertaintyMarkers: [
    '拟', '计划', '有望', '或将', '传闻', '网传', '预计', '意向', '宣布将'
  ],
  objects: {
    lowaltitude: [
      'eVTOL', '飞行汽车', '飞控', '航电', '电推进', '航空电池',
      '垂直起降', '适航', '低空智联网'
    ],
    aerospace: [
      '可重复使用火箭', '火箭发动机', '推进系统', '卫星平台',
      '有效载荷', '星座组网', '热防护', '轨道转移'
    ]
  }
});

function article(overrides = {}) {
  return {
    domain: 'aerospace',
    category: '技术研发',
    title: '可重复使用火箭完成十公里垂直起降回收试验',
    summary: '官方宣布发动机点火、着陆和回收验证成功。',
    tags: ['可重复使用火箭', '回收复用'],
    tier: 'T1',
    clusterSize: 1,
    noiseHits: 0,
    scores: {
      novelty: 88,
      importance: 82,
      credibility: 92
    },
    ...overrides
  };
}

test('商业航天的权威完成性试验获得可解释的突破加成', () => {
  const result = analyzeBreakthrough(article(), config);

  assert.ok(result.score >= 0.6);
  assert.ok(result.score <= 1);
  assert.equal(result.bonus, Math.round(result.score * config.maxBonus * 10) / 10);
  assert.equal(result.halfLifeExtensionHours,
    Math.round(result.score * config.maxHalfLifeExtensionHours * 10) / 10);
  assert.ok(result.signals.objects.includes('可重复使用火箭'));
  assert.ok(result.signals.actions.includes('回收'));
  assert.equal(result.signals.credibilityEvidence, 'tier-t1');
  assert.equal(result.signals.rejectedReason, null);
});

test('低空经济适航取证可由可信 T1.5 信源通过模型可信度门槛', () => {
  const result = analyzeBreakthrough(article({
    domain: 'lowaltitude',
    category: '技术研发',
    title: '某型eVTOL取得型号合格证',
    summary: '民航主管部门确认适航取证完成。',
    tags: ['eVTOL', '适航取证'],
    tier: 'T1.5',
    scores: { novelty: 85, importance: 90, credibility: 86 }
  }), config);

  assert.ok(result.score > 0);
  assert.equal(result.signals.credibilityEvidence, 'tier-t1.5-model');
  assert.ok(result.signals.objects.includes('eVTOL'));
  assert.ok(result.signals.actions.includes('适航取证'));
});

test('多源印证可让达到较低可信门槛的 T2 技术事件获得加成', () => {
  const result = analyzeBreakthrough(article({
    tier: 'T2',
    clusterSize: 3,
    scores: { novelty: 80, importance: 75, credibility: 66 }
  }), config);

  assert.ok(result.score > 0);
  assert.equal(result.signals.credibilityEvidence, 'corroborated-model');
});

test('没有模型分数时只接受 T1 或多源印证', () => {
  const official = analyzeBreakthrough(article({ scores: null, tier: 'T1' }), config);
  const corroborated = analyzeBreakthrough(article({
    scores: null,
    tier: 'T2',
    clusterSize: 2
  }), config);
  const unsupported = analyzeBreakthrough(article({
    scores: null,
    tier: 'T2',
    clusterSize: 1
  }), config);

  assert.ok(official.score > 0);
  assert.ok(corroborated.score > 0);
  assert.equal(unsupported.score, 0);
  assert.equal(unsupported.signals.rejectedReason, 'credibility-gate');
});

test('计划性标题即使命中首飞和技术对象也不获得加成', () => {
  const result = analyzeBreakthrough(article({
    domain: 'lowaltitude',
    title: '公司计划于明年完成eVTOL首飞',
    summary: '项目仍处于方案阶段。',
    tags: ['eVTOL'],
    tier: 'T1'
  }), config);

  assert.equal(result.score, 0);
  assert.equal(result.bonus, 0);
  assert.equal(result.signals.rejectedReason, 'uncertain-claim');
  assert.ok(result.signals.uncertainty.includes('计划'));
});

test('历史计划与今日完成分句时采用明确完成证据', () => {
  const result = analyzeBreakthrough(article({
    domain: 'lowaltitude',
    title: '原计划年中首飞；今日eVTOL首飞成功',
    summary: '现场完成全部试验科目。',
    tags: ['eVTOL', '首飞'],
    tier: 'T1'
  }), config);

  assert.ok(result.score > 0);
  assert.equal(result.signals.rejectedReason, null);
});

test('错误领域、错误分类、缺少对象或缺少完成动作逐项拒绝', () => {
  const cases = [
    [article({ domain: null }), 'domain'],
    [article({ category: '企业动态' }), 'category'],
    [article({ title: '公司完成重大测试', summary: '结果成功。', tags: [] }), 'technical-object'],
    [article({
      title: '可重复使用火箭进入研发阶段',
      summary: '项目持续推进。',
      tags: []
    }), 'completion-action']
  ];

  for (const [input, reason] of cases) {
    const result = analyzeBreakthrough(input, config);
    assert.equal(result.score, 0);
    assert.equal(result.signals.rejectedReason, reason);
  }
});

test('噪声形态与低可信单点声明不会靠关键词进入热点', () => {
  const noisy = analyzeBreakthrough(article({ noiseHits: 1 }), config);
  const weak = analyzeBreakthrough(article({
    tier: 'T2',
    clusterSize: 1,
    scores: { novelty: 90, importance: 90, credibility: 95 }
  }), config);

  assert.equal(noisy.score, 0);
  assert.equal(noisy.signals.rejectedReason, 'noise');
  assert.equal(weak.score, 0);
  assert.equal(weak.signals.rejectedReason, 'credibility-gate');
});

test('跨领域事件同时匹配两侧技术对象但不重复计算同一信号', () => {
  const result = analyzeBreakthrough(article({
    domain: 'both',
    title: '卫星平台支持低空智联网完成性能验证',
    summary: '两套系统完成联合测试通过。',
    tags: ['卫星平台', '低空智联网'],
    tier: 'T1'
  }), config);

  assert.ok(result.score > 0);
  assert.deepEqual(
    [...new Set(result.signals.objects)],
    result.signals.objects
  );
  assert.ok(result.signals.objects.includes('卫星平台'));
  assert.ok(result.signals.objects.includes('低空智联网'));
});
