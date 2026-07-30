'use strict';

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
  return String(value || '').toLocaleLowerCase('zh-CN');
}

function matches(text, terms) {
  const haystack = normalizedText(text);
  return unique((terms || []).filter(term =>
    haystack.includes(normalizedText(term))));
}

function sentencesOf(article) {
  const tags = Array.isArray(article?.tags) ? article.tags.join('；') : '';
  return [article?.title, article?.summary, tags]
    .filter(Boolean)
    .flatMap(value => String(value).split(/[。！？!?；;\r\n]+/u))
    .map(value => value.trim())
    .filter(Boolean);
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
      rejectedReason: reason
    }
  };
}

function credibilityGate(article, config) {
  const tier = String(article?.tier || '');
  const clusterSize = Math.max(1, Number(article?.clusterSize) || 1);
  const credibility = Number(article?.scores?.credibility);
  const hasModelCredibility = Number.isFinite(credibility);
  const minimums = config?.minimumScores || {};

  if (tier === 'T1') return { accepted: true, evidence: 'tier-t1', strength: 0.95 };
  if (tier === 'T1.5' && hasModelCredibility
    && credibility >= (Number(minimums.tier15Credibility) || 70)) {
    return { accepted: true, evidence: 'tier-t1.5-model', strength: 0.82 };
  }
  if (clusterSize >= 2 && (
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
  if ((Number(article?.noiseHits) || 0) > 0) {
    return rejected(config, baseSignals, 'noise');
  }

  const objects = domainObjects(domain, config);
  const actions = Array.isArray(config.completionActions) ? config.completionActions : [];
  const uncertaintyMarkers = Array.isArray(config.uncertaintyMarkers)
    ? config.uncertaintyMarkers
    : [];
  const sentences = sentencesOf(article);
  const allText = sentences.join('；');
  baseSignals.uncertainty = matches(allText, uncertaintyMarkers);
  const allObjects = matches(allText, objects);
  const allActions = matches(allText, actions);

  const cleanEvidence = sentences.map(sentence => ({
    sentence,
    objects: matches(sentence, objects),
    actions: matches(sentence, actions),
    uncertainty: matches(sentence, uncertaintyMarkers)
  })).filter(evidence =>
    evidence.objects.length
    && evidence.actions.length
    && evidence.uncertainty.length === 0);

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
  }

  const credibility = credibilityGate(article, config);
  baseSignals.credibilityEvidence = credibility.evidence;
  if (!credibility.accepted) {
    return rejected(config, baseSignals, 'credibility-gate');
  }

  const scores = article?.scores;
  const modelCredibilityFallback = article?.tier === 'T1' ? 0.86 : 0.7;
  const novelty = scoreDimension(scores, 'novelty', 0.72);
  const importance = scoreDimension(scores, 'importance', 0.7);
  const modelCredibility = scoreDimension(scores, 'credibility', modelCredibilityFallback);
  const actionStrength = Math.min(1, 0.5 + (baseSignals.actions.length - 1) * 0.2);
  const objectStrength = Math.min(1, 0.5 + (baseSignals.objects.length - 1) * 0.15);
  const corroboration = Math.min(1,
    Math.max(0, (Number(article?.clusterSize) || 1) - 1) / 2);

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
  const roundedScore = Math.round(score * 1000) / 1000;

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
      rejectedReason: null
    }
  };
}

module.exports = {
  analyzeBreakthrough,
  credibilityGate,
  domainObjects,
  matches
};
