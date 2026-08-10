'use strict';

// 失败标记的内置默认词表：配置文件缺失 failureMarkers 时仍保留失败语义防护，
// 避免一次配置事故就把「发射失败」重新放进突破加成。
const DEFAULT_FAILURE_MARKERS = [
  '取消', '推迟', '延期', '中止', '终止', '失利', '失败',
  '坠毁', '爆炸', '解体', '未成功', '未能成功', '被迫终止', '停飞', '破产', '夭折'
];

// 完成动作词周边 8 字内出现失败标记时，该次动作命中作废：
// 「点火成功后火箭解体」里的「点火成功」不是突破证据。
const FAILURE_PROXIMITY_RADIUS = 8;

// 全文存在不确定性标记但仍有干净证据时，不直接拒绝，只对最终分打对折（软否决）
const UNCERTAINTY_PENALTY_FACTOR = 0.5;

function clamp(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizedText(value) {
  // 固定 toLowerCase：toLocaleLowerCase('zh-CN') 的结果依赖运行环境区域设置，
  // 同一份文本在不同机器上可能归一出不同结果，命中判定必须是确定的。
  return String(value || '').toLowerCase();
}

function matches(text, terms) {
  const haystack = normalizedText(text);
  return unique((terms || []).filter((term) => {
    const needle = normalizedText(term);
    // 空 needle 会命中一切文本，与 matchOccurrences 同等防护
    return needle && haystack.includes(needle);
  }));
}

function matchOccurrences(text, terms) {
  const haystack = normalizedText(text);
  const occurrences = [];
  for (const term of terms || []) {
    const needle = normalizedText(term);
    if (!needle) continue;
    for (let index = haystack.indexOf(needle); index >= 0;
      index = haystack.indexOf(needle, index + 1)) {
      occurrences.push({
        term,
        index,
        end: index + needle.length
      });
    }
  }
  return occurrences;
}

function isMeaningfulUncertaintyOccurrence(text, occurrence) {
  if (normalizedText(occurrence.term) !== '拟') return true;
  // “模拟、虚拟、比拟”中的“拟”是词的一部分，不表达尚未发生。
  return !['模', '虚', '比'].includes(text[occurrence.index - 1]);
}

// 完成动作词与失败标记的距离是否在邻近窗口内（两侧间隔 ≤ 8 字，重叠自然成立）
function isNearFailure(action, failure) {
  return Math.max(failure.index - action.end, action.index - failure.end)
    <= FAILURE_PROXIMITY_RADIUS;
}

function evidenceIn(text, objects, actions, uncertaintyMarkers, failureMarkers = []) {
  const normalized = normalizedText(text);
  const objectOccurrences = matchOccurrences(normalized, objects);
  const failureOccurrences = matchOccurrences(normalized, failureMarkers);
  // 邻近窗口校验：失败标记出现在完成动作词周边 8 字内，该次动作命中作废
  const actionOccurrences = matchOccurrences(normalized, actions)
    .filter(action =>
      !objectOccurrences.some(object =>
        action.index >= object.index && action.end <= object.end))
    .filter(action =>
      !failureOccurrences.some(failure => isNearFailure(action, failure)));
  const uncertaintyOccurrences = matchOccurrences(
    normalized,
    uncertaintyMarkers
  ).filter(occurrence => isMeaningfulUncertaintyOccurrence(normalized, occurrence));
  return {
    objects: unique(objectOccurrences.map(occurrence => occurrence.term)),
    actions: unique(actionOccurrences.map(occurrence => occurrence.term)),
    uncertainty: unique(uncertaintyOccurrences.map(occurrence => occurrence.term)),
    failures: unique(failureOccurrences.map(occurrence => occurrence.term))
  };
}

// 句子流带来源标注：干净证据只接受标题与摘要，tags 是聚合产物，
// 只用于探测技术对象/动作的存在，不能单独充当完成证据。
function sentencesOf(article) {
  const segments = [
    { source: 'title', value: article?.title },
    { source: 'summary', value: article?.summary },
    { source: 'tags', value: Array.isArray(article?.tags) ? article.tags.join('；') : '' }
  ];
  return segments
    .filter(segment => segment.value)
    .flatMap(segment => String(segment.value)
      // “…”省略号同样收尾一句话，切不开会把「…成功…后续拟…」误拼成同一句
      .split(/[。！？!?；;…\r\n]+/u)
      .map(value => value.trim())
      .filter(Boolean)
      .map(text => ({ source: segment.source, text })));
}

function domainObjects(domain, config) {
  const objects = config?.objects || {};
  if (domain === 'both') {
    return unique([...(objects.lowaltitude || []), ...(objects.aerospace || [])]);
  }
  return Array.isArray(objects[domain]) ? objects[domain] : [];
}

function rejected(config, signals, reason) {
  return {
    version: Number(config?.version) || 1,
    score: 0,
    bonus: 0,
    halfLifeExtensionHours: 0,
    signals: {
      objects: unique(signals.objects || []),
      actions: unique(signals.actions || []),
      credibilityEvidence: signals.credibilityEvidence || null,
      uncertainty: unique(signals.uncertainty || []),
      noiseHits: signals.noiseHits || 0,
      rejectedReason: reason
    }
  };
}

function credibilityGate(article, config) {
  const tier = String(article?.tier || '');
  const sourceCount = Math.max(1, Number(article?.sourceCount) || 1);
  const credibility = Number(article?.scores?.credibility);
  const hasModelCredibility = Number.isFinite(credibility);
  const minimums = config?.minimumScores || {};

  if (tier === 'T1') {
    // T1 不再无条件 accepted：要求模型可信度 >= 40 或多源印证 >= 2
    //（无模型分时只看多源）。不达标不拒绝，降为 corroborated 同档强度。
    const floor = Number(minimums.tier1Credibility) || 40;
    const meetsFloor = hasModelCredibility
      ? credibility >= floor || sourceCount >= 2
      : sourceCount >= 2;
    return meetsFloor
      ? { accepted: true, evidence: 'tier-t1', strength: 0.95 }
      : { accepted: true, evidence: 'tier-t1-downgraded', strength: 0.76 };
  }
  if (tier === 'T1.5' && hasModelCredibility
    && credibility >= (Number(minimums.tier15Credibility) || 70)) {
    return { accepted: true, evidence: 'tier-t1.5-model', strength: 0.82 };
  }
  if (sourceCount >= 2 && (
    !hasModelCredibility
    || credibility >= (Number(minimums.corroboratedCredibility) || 60)
  )) {
    return { accepted: true, evidence: hasModelCredibility
      ? 'corroborated-model'
      : 'corroborated-no-model', strength: 0.76 };
  }
  return { accepted: false, evidence: null, strength: 0 };
}

function scoreDimension(scores, name, fallback) {
  const value = Number(scores?.[name]);
  return Number.isFinite(value) ? clamp(value / 100, 0, 1) : fallback;
}

function analyzeBreakthrough(article, config = {}) {
  const baseSignals = {
    objects: [],
    actions: [],
    credibilityEvidence: null,
    uncertainty: [],
    noiseHits: Number(article?.noiseHits) || 0,
    rejectedReason: null
  };
  const domain = article?.domain;
  if (!['lowaltitude', 'aerospace', 'both'].includes(domain)) {
    return rejected(config, baseSignals, 'domain');
  }
  if (!Array.isArray(config.eligibleCategories)
    || !config.eligibleCategories.includes(article?.category)) {
    return rejected(config, baseSignals, 'category');
  }
  // 单次噪声命中可能只是误触形态特征，连续命中两个才拒绝；计数留在 signals 供观察
  if (baseSignals.noiseHits >= 2) {
    return rejected(config, baseSignals, 'noise');
  }

  const objects = domainObjects(domain, config);
  const actions = Array.isArray(config.completionActions) ? config.completionActions : [];
  const uncertaintyMarkers = Array.isArray(config.uncertaintyMarkers)
    ? config.uncertaintyMarkers
    : [];
  const failureMarkers = Array.isArray(config.failureMarkers)
    && config.failureMarkers.length
    ? config.failureMarkers
    : DEFAULT_FAILURE_MARKERS;
  const sentences = sentencesOf(article);
  const allEvidence = evidenceIn(
    sentences.map(segment => segment.text).join('；'),
    objects,
    actions,
    uncertaintyMarkers,
    failureMarkers
  );
  baseSignals.uncertainty = allEvidence.uncertainty;
  const allObjects = allEvidence.objects;
  const allActions = allEvidence.actions;

  // 干净证据只接受标题与摘要的句子：与 uncertaintyMarkers 同样做句级过滤，
  // 含失败标记的句子同样不得计入。
  const cleanEvidence = sentences
    .filter(segment => segment.source !== 'tags')
    .map(segment => ({
      sentence: segment.text,
      ...evidenceIn(segment.text, objects, actions, uncertaintyMarkers, failureMarkers)
    }))
    .filter(evidence =>
      evidence.objects.length
      && evidence.actions.length
      && evidence.uncertainty.length === 0
      && evidence.failures.length === 0);

  baseSignals.objects = unique(cleanEvidence.flatMap(evidence => evidence.objects));
  baseSignals.actions = unique(cleanEvidence.flatMap(evidence => evidence.actions));

  if (!allObjects.length) {
    return rejected(config, baseSignals, 'technical-object');
  }
  if (!allActions.length) {
    baseSignals.objects = allObjects;
    return rejected(config, baseSignals, 'completion-action');
  }
  if (!cleanEvidence.length && baseSignals.uncertainty.length) {
    baseSignals.objects = allObjects;
    baseSignals.actions = allActions;
    return rejected(config, baseSignals, 'uncertain-claim');
  }
  if (!cleanEvidence.length) {
    baseSignals.objects = allObjects;
    baseSignals.actions = allActions;
    return rejected(config, baseSignals, 'unlinked-evidence');
  }

  const credibility = credibilityGate(article, config);
  baseSignals.credibilityEvidence = credibility.evidence;
  if (!credibility.accepted) {
    return rejected(config, baseSignals, 'credibility-gate');
  }

  const scores = article?.scores;
  // T1 被降档时不再享受 T1 的模型可信度默认值，与降档后的强度一致
  const modelCredibilityFallback = article?.tier === 'T1'
    && baseSignals.credibilityEvidence === 'tier-t1'
    ? 0.86
    : 0.7;
  const novelty = scoreDimension(scores, 'novelty', 0.72);
  const importance = scoreDimension(scores, 'importance', 0.7);
  const modelCredibility = scoreDimension(scores, 'credibility', modelCredibilityFallback);
  const actionStrength = Math.min(1, 0.5 + (baseSignals.actions.length - 1) * 0.2);
  const objectStrength = Math.min(1, 0.5 + (baseSignals.objects.length - 1) * 0.15);
  const corroboration = Math.min(1,
    Math.max(0, (Number(article?.sourceCount) || 1) - 1) / 2);

  const score = clamp(
    novelty * 0.2
      + importance * 0.18
      + modelCredibility * 0.2
      + actionStrength * 0.15
      + objectStrength * 0.1
      + credibility.strength * 0.12
      + corroboration * 0.05,
    0,
    1
  );
  // 软否决：全文仍有不确定性标记但存在干净证据时不拒绝，只对最终分打折
  const uncertaintyPenalty = baseSignals.uncertainty.length > 0;
  const roundedScore = Math.round(
    score * (uncertaintyPenalty ? UNCERTAINTY_PENALTY_FACTOR : 1) * 1000) / 1000;

  return {
    version: Number(config.version) || 1,
    score: roundedScore,
    bonus: round1(clamp(Number(config.maxBonus), 0, 100) * roundedScore),
    halfLifeExtensionHours: round1(
      clamp(Number(config.maxHalfLifeExtensionHours), 0, 240) * roundedScore
    ),
    signals: {
      objects: baseSignals.objects,
      actions: baseSignals.actions,
      credibilityEvidence: baseSignals.credibilityEvidence,
      uncertainty: baseSignals.uncertainty,
      noiseHits: baseSignals.noiseHits,
      'uncertainty-penalty': uncertaintyPenalty,
      rejectedReason: null
    }
  };
}

module.exports = {
  analyzeBreakthrough,
  credibilityGate,
  domainObjects,
  evidenceIn,
  matchOccurrences,
  matches
};
