'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeBreakthrough, matches } = require('../server/ai/breakthrough');

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
      '可重复使用火箭', '可回收火箭', '火箭发动机', '推进系统', '卫星平台',
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

test('关联报道不能让低可信 T2 技术事件获得加成', () => {
  const result = analyzeBreakthrough(article({
    tier: 'T2',
    clusterSize: 3,
    sourceCount: 3,
    scores: { novelty: 80, importance: 75, credibility: 66 }
  }), config);

  assert.equal(result.score, 0);
  assert.equal(result.signals.credibilityEvidence, null);
});

test('没有模型分数时只接受降档 T1', () => {
  const official = analyzeBreakthrough(article({ scores: null, tier: 'T1' }), config);
  const corroborated = analyzeBreakthrough(article({
    scores: null,
    tier: 'T2',
    clusterSize: 2,
    sourceCount: 2
  }), config);
  const unsupported = analyzeBreakthrough(article({
    scores: null,
    tier: 'T2',
    clusterSize: 1
  }), config);

  assert.ok(official.score > 0);
  assert.equal(corroborated.score, 0);
  assert.equal(unsupported.score, 0);
  assert.equal(unsupported.signals.rejectedReason, 'credibility-gate');
});

test('同一信源的重复报道不能冒充多源印证', () => {
  const result = analyzeBreakthrough(article({
    tier: 'T2',
    clusterSize: 3,
    sourceCount: 1,
    scores: { novelty: 80, importance: 75, credibility: 66 }
  }), config);

  assert.equal(result.score, 0);
  assert.equal(result.signals.rejectedReason, 'credibility-gate');
});

test('技术对象内部的动作子串不能单独证明已经完成', () => {
  const result = analyzeBreakthrough(article({
    title: '官方发布可回收火箭总体技术方案',
    summary: '方案披露了总体参数与后续研制安排。',
    tags: ['可回收火箭'],
    tier: 'T1'
  }), config);

  assert.equal(result.score, 0);
  assert.equal(result.signals.rejectedReason, 'completion-action');
});

test('模拟一词中的拟不应把已完成试验误判为计划', () => {
  const result = analyzeBreakthrough(article({
    title: '火箭发动机完成模拟试验并测试通过',
    summary: '官方公布测试数据，性能验证达到预期。',
    tags: ['火箭发动机', '性能验证'],
    tier: 'T1'
  }), config);

  assert.ok(result.score > 0);
  assert.equal(result.signals.rejectedReason, null);
  assert.ok(!result.signals.uncertainty.includes('拟'));
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

test('单次噪声命中不拒绝，连续命中两次及以上才拒绝', () => {
  // 新语义：单次噪声命中可能只是误触形态特征，计数留在 signals 供观察；>=2 才拒绝
  const once = analyzeBreakthrough(article({ noiseHits: 1 }), config);
  const twice = analyzeBreakthrough(article({ noiseHits: 2 }), config);
  const weak = analyzeBreakthrough(article({
    tier: 'T2',
    clusterSize: 1,
    scores: { novelty: 90, importance: 90, credibility: 95 }
  }), config);

  assert.ok(once.score > 0);
  assert.equal(once.signals.rejectedReason, null);
  assert.equal(once.signals.noiseHits, 1);
  assert.equal(twice.score, 0);
  assert.equal(twice.signals.rejectedReason, 'noise');
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

// —— H2：失败词表与动作词邻近窗口 ——
// 测试内 config 未配置 failureMarkers，以下用例同时锁定「配置缺失时回落内置默认词表」的行为

test('H2：含失败标记的完成性报道一律拒绝且不计分', () => {
  const cases = [
    article({
      title: '朱雀三号可回收火箭首飞失利',
      summary: '事故原因正在调查中。',
      tags: ['可回收火箭']
    }),
    article({
      title: '某公司可回收火箭回收失败',
      summary: '后续将择机重新试验。',
      tags: ['可回收火箭']
    }),
    article({
      domain: 'lowaltitude',
      title: '某型eVTOL适航取证推迟',
      summary: '取证时间表尚未确定。',
      tags: ['eVTOL']
    })
  ];
  for (const input of cases) {
    const result = analyzeBreakthrough(input, config);
    assert.equal(result.score, 0);
    assert.ok(result.signals.rejectedReason, `${input.title} 应当被拒绝`);
  }
});

test('H2：动作词周边 8 字内的失败标记作废该次命中，8 字外不影响', () => {
  // 「点火成功」后隔 3 字即出现「解体」→ 动作命中作废
  const near = analyzeBreakthrough(article({
    title: '可重复使用火箭点火成功后箭体解体',
    summary: '官方通报了事故情况。',
    tags: []
  }), config);
  assert.equal(near.score, 0);
  assert.ok(near.signals.rejectedReason);

  // 「点火成功」与「解体」间隔 14 字（>8）→ 动作命中保留，摘要另有干净证据
  const far = analyzeBreakthrough(article({
    title: '可重复使用火箭点火成功，官方通报称试验后段出现异常解体',
    summary: '可重复使用火箭回收环节顺利完成。',
    tags: []
  }), config);
  assert.ok(far.score > 0);
  assert.equal(far.signals.rejectedReason, null);
});

// —— M7：不确定性软否决（打对折而非拒绝）——

test('M7：全文有不确定性但仍有干净证据时分数打对折并记录 uncertainty-penalty', () => {
  const penalized = analyzeBreakthrough(article({
    title: '可回收火箭完成回收试验',
    summary: '后续拟开展复用飞行。',
    tags: ['可回收火箭']
  }), config);
  const control = analyzeBreakthrough(article({
    title: '可回收火箭完成回收试验',
    summary: '后续复用飞行稳步推进。',
    tags: ['可回收火箭']
  }), config);

  assert.equal(control.signals['uncertainty-penalty'], false);
  assert.equal(penalized.signals['uncertainty-penalty'], true);
  assert.equal(penalized.signals.rejectedReason, null, '软否决不是拒绝');
  assert.ok(penalized.score > 0);
  assert.ok(Math.abs(penalized.score - control.score * 0.5) < 0.002,
    `惩罚后 ${penalized.score} 应为未惩罚值 ${control.score} 的一半`);
});

// —— H6：tags 不能单独充当完成证据 ——

test('H6：仅由 tags 构成的证据按 unlinked-evidence 拒绝', () => {
  const result = analyzeBreakthrough(article({
    title: '可回收火箭技术取得新进展',
    summary: '相关研制工作持续推进。',
    tags: ['可回收火箭', '测试通过']
  }), config);
  assert.equal(result.score, 0);
  assert.equal(result.signals.rejectedReason, 'unlinked-evidence');
});

test('H6：超长与含分隔符的 tags 不抛异常且分数有界', () => {
  const hostile = ['超长标签'.repeat(500), '回收;复用\n测试通过', '  '];
  const result = analyzeBreakthrough(article({
    title: '可回收火箭完成回收试验',
    summary: '官方确认试验顺利完成。',
    tags: hostile
  }), config);
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.score >= 0 && result.score <= 1);
});

// —— H7：可信度门槛临界值 ——

test('H7：T1.5 可信度 70 通过、69 拒绝，关联报道不能绕过门槛', () => {
  const pass = analyzeBreakthrough(article({
    tier: 'T1.5',
    scores: { novelty: 80, importance: 75, credibility: 70 }
  }), config);
  assert.equal(pass.signals.credibilityEvidence, 'tier-t1.5-model');
  assert.ok(pass.score > 0);

  const fail = analyzeBreakthrough(article({
    tier: 'T1.5',
    scores: { novelty: 80, importance: 75, credibility: 69 }
  }), config);
  assert.equal(fail.score, 0);
  assert.equal(fail.signals.rejectedReason, 'credibility-gate');

  const multiSource = analyzeBreakthrough(article({
    tier: 'T1.5',
    sourceCount: 2,
    clusterSize: 2,
    scores: { novelty: 80, importance: 75, credibility: 69 }
  }), config);
  assert.equal(multiSource.signals.credibilityEvidence, null);
  assert.equal(multiSource.score, 0);
});

test('H7：T2 可信度 60 或 59 均不能通过关联报道绕过门槛', () => {
  const pass = analyzeBreakthrough(article({
    tier: 'T2',
    sourceCount: 2,
    clusterSize: 2,
    scores: { novelty: 80, importance: 75, credibility: 60 }
  }), config);
  assert.equal(pass.signals.credibilityEvidence, null);
  assert.equal(pass.score, 0);

  const fail = analyzeBreakthrough(article({
    tier: 'T2',
    sourceCount: 2,
    clusterSize: 2,
    scores: { novelty: 80, importance: 75, credibility: 59 }
  }), config);
  assert.equal(fail.score, 0);
  assert.equal(fail.signals.rejectedReason, 'credibility-gate');
});

// —— M6：T1 低可信降档而非拒绝 ——

test('M6：T1 可信度不达标降档为 0.76，达标则正常 tier-t1', () => {
  const downgraded = analyzeBreakthrough(article({
    scores: { novelty: 88, importance: 82, credibility: 10 }
  }), config);
  assert.equal(downgraded.signals.credibilityEvidence, 'tier-t1-downgraded');
  assert.ok(downgraded.score > 0, '降档不是拒绝');
  // 计分公式逐项复算：0.76 的降档强度替换了 T1 的 0.95
  const expectedDowngraded = Math.round(
    (0.88 * 0.2 + 0.82 * 0.18 + 0.10 * 0.2
      + 0.5 * 0.15 + 0.5 * 0.1 + 0.76 * 0.17) * 1000) / 1000;
  assert.equal(downgraded.score, expectedDowngraded);

  const normal = analyzeBreakthrough(article({
    scores: { novelty: 88, importance: 82, credibility: 50 }
  }), config);
  assert.equal(normal.signals.credibilityEvidence, 'tier-t1');
  const expectedNormal = Math.round(
    (0.88 * 0.2 + 0.82 * 0.18 + 0.50 * 0.2
      + 0.5 * 0.15 + 0.5 * 0.1 + 0.95 * 0.17) * 1000) / 1000;
  assert.equal(normal.score, expectedNormal);
});

test('M6：T1 无模型分时均降档，关联报道不改变强度', () => {
  const alone = analyzeBreakthrough(article({ scores: null, sourceCount: 1 }), config);
  assert.equal(alone.signals.credibilityEvidence, 'tier-t1-downgraded');
  assert.ok(alone.score > 0);

  const multi = analyzeBreakthrough(article({ scores: null, sourceCount: 2, clusterSize: 2 }), config);
  assert.equal(multi.signals.credibilityEvidence, 'tier-t1-downgraded');
  assert.equal(multi.score, alone.score);
  assert.ok(multi.score > 0);
});

// —— 不确定词边缘形态 ——

test('「虚拟」「比拟」中的拟不构成不确定性，句首的拟不崩溃', () => {
  const virtual = analyzeBreakthrough(article({
    title: '可回收火箭完成虚拟试飞测试通过',
    summary: '官方公布了全部数据。',
    tags: []
  }), config);
  assert.ok(virtual.score > 0);
  assert.ok(!virtual.signals.uncertainty.includes('拟'));

  const compare = analyzeBreakthrough(article({
    title: '可回收火箭回收表现无可比拟',
    summary: '官方确认回收顺利完成。',
    tags: []
  }), config);
  assert.ok(compare.score > 0);
  assert.ok(!compare.signals.uncertainty.includes('拟'));

  // 句首的「拟」（前一字越界为 undefined）不应崩溃，仍按不确定性处理
  const leading = analyzeBreakthrough(article({
    title: '拟明年实施可回收火箭回收试验',
    summary: '具体安排尚未公布。',
    tags: []
  }), config);
  assert.equal(leading.score, 0);
  assert.ok(leading.signals.rejectedReason);
  assert.ok(leading.signals.uncertainty.includes('拟'));
});

test('单句「计划首飞已完成」不产生干净证据', () => {
  const result = analyzeBreakthrough(article({
    title: '可回收火箭计划首飞已完成',
    summary: '',
    tags: []
  }), config);
  assert.equal(result.score, 0);
  assert.equal(result.signals.rejectedReason, 'uncertain-claim');
  assert.ok(result.signals.uncertainty.includes('计划'));
});

// —— tier 大小写定性（记录现状）——
// 现状：tier 为严格字符串相等，'t1'/' T1' 不会命中 T1 门槛，落到可信度门槛被拒。
// 是否归一化大小写/空白需要显式决策，此用例锁定现状，改动实现前先对齐结论。

test('tier 大小写与空白为严格相等：t1、" T1" 现状被拒（定性锁定，待显式决策）', () => {
  for (const tier of ['t1', ' T1']) {
    const result = analyzeBreakthrough(article({ tier, scores: null, sourceCount: 1 }), config);
    assert.equal(result.score, 0);
    assert.equal(result.signals.rejectedReason, 'credibility-gate');
  }
});

test('T1.5 无模型分时不因关联报道获得可信证据', () => {
  const result = analyzeBreakthrough(article({
    tier: 'T1.5',
    scores: null,
    sourceCount: 2,
    clusterSize: 2
  }), config);
  assert.equal(result.signals.credibilityEvidence, null);
  assert.equal(result.score, 0);
});

// —— matches 空词防护 ——

test('matches 过滤空/空白词：空项不产生任何命中', () => {
  assert.deepEqual(matches('eVTOL 完成试飞', ['', '  ', 'eVTOL']), ['eVTOL']);
  assert.deepEqual(matches('任意文本', ['', null, undefined]), []);
});
