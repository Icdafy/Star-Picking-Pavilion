'use strict';
const Parser = require('rss-parser');
const { fetchPage, publicUrl } = require('./public-web');
const { extractContent } = require('./article-content');
const { relevanceOf } = require('../ai/keywords');
const { resolveUrl } = require('./rss');

const parser = new Parser();
let nextRequestAt = 0;
let pauseUntil = 0;
async function pacedPage(url, fetchImpl = fetchPage) {
  if (Date.now() < pauseUntil) throw new Error('公众号访问异常，暂停一小时后重试');
  const slot = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = slot + 3000;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, slot - Date.now())));
  try {
    const html = await fetchImpl(url);
    if (/环境异常|访问过于频繁|请完成验证|captcha|登录后查看/i.test(html)) throw new Error('公众号访问验证，已停止');
    return html;
  } catch (error) { pauseUntil = Date.now() + 3600000; throw error; }
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
    const article = extractContent(html, candidate.link);
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
