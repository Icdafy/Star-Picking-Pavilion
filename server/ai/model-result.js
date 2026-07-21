'use strict';

const SCORE_KEYS = ['importance', 'novelty', 'credibility', 'impact', 'timeliness'];

function boundedText(value, maximum) {
  if (typeof value !== 'string') return '';
  return [...value.trim()].slice(0, maximum).join('');
}

function normalizeModelResult(value, categories) {
  if (!value?.scores || typeof value.scores !== 'object' || Array.isArray(value.scores)) {
    throw new Error('模型评分结果无效');
  }
  const scores = {};
  for (const key of SCORE_KEYS) {
    const number = Number(value.scores[key]);
    scores[key] = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
  }
  const allowedCategories = Array.isArray(categories) && categories.length ? categories : ['企业动态'];
  const fallbackCategory = allowedCategories.includes('企业动态') ? '企业动态' : allowedCategories[0];
  const category = allowedCategories.includes(value.category) ? value.category : fallbackCategory;
  const tags = [];
  for (const candidate of Array.isArray(value.tags) ? value.tags : []) {
    const tag = boundedText(candidate, 24);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 4) break;
  }
  return {
    scores,
    category,
    summary: boundedText(value.summary, 80),
    reason: boundedText(value.reason, 60),
    tags
  };
}

module.exports = { normalizeModelResult };
