'use strict';
const Parser = require('rss-parser');
const { fetchPage, publicUrl } = require('./public-web');
const { extractContent, isAccessChallenge } = require('./article-content');
const { relevanceOf } = require('../ai/keywords');
const { resolveUrl } = require('./rss');

const parser = new Parser();
let nextRequestAt = 0;
const pauseUntil = new Map();
async function pacedPage(url, fetchImpl = fetchPage) {
  const origin = new URL(url).origin;
  if (Date.now() < (pauseUntil.get(origin) || 0)) throw new Error('公众号访问异常，暂停一小时后重试');
  const slot = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = slot + 3000;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, slot - Date.now())));
  try {
    const html = await fetchImpl(url);
    if (isAccessChallenge(html)) throw new Error('公众号访问验证，已停止');
    return html;
  } catch (error) { pauseUntil.set(origin, Date.now() + 3600000); throw error; }
}
function isArticleUrl(value) {
  try { const u = publicUrl(value); return u.hostname === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/.test(u.pathname); }
  catch { return false; }
}

// Feed URL is an explicitly configured public RSSHub/Wechat2RSS subscription.
// A direct mp.weixin.qq.com/s/... URL is also accepted; no login cookies or account enumeration.
async function fetch(source, settings, { page = pacedPage } = {}) {
  const url = resolveUrl(source.url, settings);
  const candidates = [];
  if (isArticleUrl(url)) candidates.push({ link: url });
  else {
    const feed = await parser.parseString(await page(url));
    candidates.push(...(feed.items || []).filter(i => isArticleUrl(i.link)).slice(0, 5));
  }
  const items = [];
  for (const candidate of candidates) {
    const html = await page(candidate.link);
    if (isAccessChallenge(html)) throw new Error('公众号访问验证，未取得文章正文');
    const article = extractContent(html, candidate.link);
    if (!article.text || !article.title) throw new Error('公众号正文或标题为空');
    const title = article.title || candidate.title || '';
    const summary = article.text || candidate.contentSnippet || '';
    const profile = relevanceOf(`${title} ${summary}`);
    if (!profile.relevant || (source.domain !== 'both' && profile.domain !== source.domain)) continue;
    items.push({ title, url: candidate.link, summary, contentText: article.text,
      publisherId: article.publisherId, images: article.images, image: article.images[0]?.url || null,
      publishedAt: article.publishedAt || null });
  }
  return items;
}
module.exports = { fetch, isArticleUrl, pacedPage };
