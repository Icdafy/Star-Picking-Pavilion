'use strict';

const SCORE_KEYS = ['importance', 'novelty', 'credibility', 'impact', 'timeliness'];

function boundedText(value, maximum) {
  if (typeof value !== 'string') return '';
  return [...value.trim()].slice(0, maximum).join('');
}

// L7 最小形状校验：名称字段必须是可用字符串（有限数字转字符串），
// 否则该元素在进入 entities/events 归一之前就被丢掉
function usableName(value) {
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value === 'number' && Number.isFinite(value);
}

function entityShapeOk(item) {
  if (typeof item === 'string') return usableName(item);
  if (!item || typeof item !== 'object') return false;
  return usableName(item.n ?? item.name);
}

function eventShapeOk(item) {
  if (typeof item === 'string') return usableName(item);
  if (!item || typeof item !== 'object') return false;
  // 事件的主体 a 必须最终可得非空字符串，没有主体的事件无法参与对齐
  return usableName(item.a ?? item.actor);
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
    // 实体与原子事件带出前做最小形状校验（脏形状的元素直接丢弃），
    // 再交给 entities/events 两个模块各自归一。
    // 这里保证「一定是数组 + 元素形状可用」，让下游不用重复做类型防御。
    entities: Array.isArray(value.entities)
      ? value.entities.filter(entityShapeOk).slice(0, 16)
      : [],
    events: Array.isArray(value.events)
      ? value.events.filter(eventShapeOk).slice(0, 8)
      : []
  };
}

module.exports = { normalizeModelResult };
