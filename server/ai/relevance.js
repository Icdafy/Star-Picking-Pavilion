'use strict';

const keywords = require('./keywords');
const DOMAINS = new Set(['lowaltitude', 'aerospace', 'both']);

// 展示、导出和词库计数共用这个边界：采集完成不等于行业判断完成。
const VISIBLE_INDUSTRY_SQL = "a.relevant = 1 AND a.analyzed IN (1, 3) AND a.domain IN ('lowaltitude', 'aerospace', 'both')";

function translated(article) {
  try { return JSON.parse(article.translation_json || '{}') || {}; } catch { return {}; }
}

function articleProfile(article, { heuristic = false } = {}) {
  const translation = translated(article);
  const title = String(article.title || '');
  const titleZh = translation.titleZh || article.title_zh || '';
  const summary = String(article.summary_raw ?? article.summaryRaw ?? '');
  const blocked = keywords.isGenericRoundup(title) || keywords.isGenericRoundup(titleZh);
  const text = article.tier === 'T2'
    ? (heuristic ? titleZh || title : `${title} ${summary.slice(0, 80)} ${titleZh}`)
    : `${title} ${summary} ${titleZh} ${translation.summaryZh || ''}`;
  const profile = keywords.relevanceOf(text);
  return { ...profile, blocked, relevant: !blocked && profile.relevant };
}

function canQueueArticle(article, settings) {
  const profile = articleProfile(article);
  return !profile.blocked && (profile.relevant || Boolean(settings.ai?.apiKey && (article.tier === 'T1' || article.intl)));
}

module.exports = { DOMAINS, VISIBLE_INDUSTRY_SQL, articleProfile, canQueueArticle };
