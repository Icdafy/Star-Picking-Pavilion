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
    tags,
    // 实体与原子事件按原样带出，交给 entities/events 两个模块各自归一。
    // 这里只负责保证「一定是数组」，让下游不用重复做类型防御。
    entities: Array.isArray(value.entities) ? value.entities.slice(0, 16) : [],
    events: Array.isArray(value.events) ? value.events.slice(0, 8) : []
  };
}

module.exports = { normalizeModelResult };
