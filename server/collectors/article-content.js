'use strict';
const cheerio = require('cheerio');
const { publicUrl, fetchPage } = require('./public-web');
const { parsePublicationDate } = require('./publication-date');
const { networkAccess } = require('../network-access');
const { removeHiddenContent } = require('./visible-content');
const { isVideoPageUrl } = require('./video-url');

function extractContent(html, url, options = {}) {
  const $ = cheerio.load(html, { scriptingEnabled: false });
  // 元数据必须在移除脚本 / 页头之前读取；正文日期与事件日期各自保留。
  const publication = extractPublicationDate($, html, url, options);
  removeHiddenContent($);
  const root = $('#js_content, #ContentBody, article, .article-content, .article_content, .TRS_Editor, #content, .news-content, .news_content').first();
  const content = root.length ? root : $('body');
  content.find('script,style,nav,header,footer,aside,form').remove();
  const images = [];
  content.find('img').each((_, el) => {
    const img = $(el), alt = (img.attr('alt') || img.attr('title') || '').slice(0, 150);
    const src = img.attr('data-src') || img.attr('data-original') || img.attr('src');
    if (!src || /logo|icon|qrcode|二维码|头像|广告|扫码/i.test(`${src} ${alt}`)) return;
    if ((Number(img.attr('width')) > 0 && Number(img.attr('width')) < 100)
      || (Number(img.attr('height')) > 0 && Number(img.attr('height')) < 80)) return;
    try {
      const u = publicUrl(new URL(src, url).href).href;
      if (isVideoPageUrl(u)) return;
      if (!images.some(i => i.url === u) && images.length < 6) images.push({ url: u, caption: alt });
    } catch {}
  });
  content.find('p,div,section,li,br').each((_, el) => { $(el).append('\n'); });
  const text = content.text().replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
  // 出版方：公众号名；转载站的“文章来源：界面新闻”（东方财富等聚合页）——热度按真实出版方计独立信源
  const publisherId = ($('#js_name').text().trim() || html.match(/var\s+user_name\s*=\s*["']([^"']+)/)?.[1]
    || reprintSource($('.em_media').text() || $('body').text()) || '').slice(0, 120);
  return { text, images, ...(publication || { publishedAt: null }), publisherId,
    title: ($('#activity-name').text() || root.find('h1').first().text() || $('h1').first().text() || $('title').text()).trim().slice(0, 300) };
}

function extractPublicationDate($, html, url, options = {}) {
  const parse = value => parsePublicationDate(value, { ...options, url });
  for (const el of $('meta[property="article:published_time"], meta[name="publishdate"], meta[name="pubdate"], meta[name="publish_date"], meta[itemprop="datePublished"], [itemprop="datePublished"]').toArray()) {
    const date = parse($(el).attr('content') || $(el).attr('datetime') || $(el).text());
    if (date) return date;
  }
  // JSON-LD 只读文章的 datePublished，不能拿 dateModified 或相关内容的日期替代。
  const readArticle = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4) return null;
    if (Array.isArray(value)) return value.slice(0, 40).map(v => readArticle(v, depth + 1)).find(Boolean) || null;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => /^(?:NewsArticle|Article|BlogPosting|Report)$/.test(type))) {
      const address = value.url || value.mainEntityOfPage?.['@id'] || value.mainEntityOfPage;
      if (!address || typeof address !== 'string' || new URL(address, url).pathname === new URL(url).pathname) {
        const date = parse(value.datePublished);
        if (date) return date;
      }
    }
    return readArticle(value['@graph'], depth + 1) || readArticle(value.mainEntity, depth + 1);
  };
  for (const el of $('script[type="application/ld+json"]').toArray().slice(0, 10)) {
    try { const date = readArticle(JSON.parse($(el).text())); if (date) return date; } catch {}
  }
  const ct = html.match(/\b(?:ct|publish_time)\s*[:=]\s*["']?(\d{10})(?!\d)/);
  if (ct) return parse(new Date(Number(ct[1]) * 1000).toISOString());
  // 只读专门发布信息，或紧随正文标题的独立日期。正文计划、推荐新闻、图片路径不能当发布时间。
  const selector = 'time, [class*="time"], [class*="date"], [class*="publish"], [class*="info"], [class="meta"], [class*="meta "], [id*="time"], [id*="date"], h1 + h3, h1 + h2, h1 + p, h2 + h3';
  const pattern = /^(?:(?:发布时间|发布日期|发布于|发表时间|报道时间|时间|日期)\s*[：:]?\s*)?((?:20\d{2}[-/年.]\d{1,2}(?:[-/月.]\d{1,2}日?|月)?|\d{1,2}[-/月.]\d{1,2}日?)(?:(?:T|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)(?=\s|$)/;
  for (const el of $(selector).toArray().slice(0, 100)) {
    const node = $(el);
    if (node.closest('nav,header,footer,aside,.related,.recommend,[class*="related"],[class*="recommend"]').length) continue;
    const text = node.text().trim();
    if (text.length > 240) continue;
    const semantics = [node.attr('itemprop'), node.attr('class'), node.attr('id')].filter(Boolean).join(' ');
    if (/dateModified|(?:^|[\s_-])(?:modified|updated|update)(?:$|[\s_-])|updatetime/i.test(semantics)
      || /^(?:最后)?(?:更新|修改)(?:时间|日期)?\s*[：:]|^(?:last\s+)?(?:updated|modified)\b/i.test(text)) continue;
    const value = node.attr('datetime') || node.attr('content') || text.match(pattern)?.[1];
    const date = parse(value);
    if (date) return date;
  }
  return null;
}

function reprintSource(text) {
  const m = String(text || '').match(/文章来源[：:]\s*([^）)\s<>，,。；;]{2,30})/);
  return m ? m[1].trim() : '';
}

async function enrichArticle(article, { network = networkAccess, fetchPageImpl = fetchPage } = {}) {
  if (isVideoPageUrl(article.url)) return { text: '', images: [], status: 'video-page' };
  // 补抓历史新闻正文也遵守海外等待；调用方可能只有数据库原始行，没有联表 intl。
  const intl = article.intl != null ? Boolean(article.intl) : article.source_id
    ? Boolean(require('../db').db.prepare('SELECT intl FROM sources WHERE id=?').get(article.source_id)?.intl) : false;
  if (intl && !(await network.detect()).available) return { text: '', images: [], status: 'network-wait' };
  try {
    const page = new URL(article.url).hostname === 'mp.weixin.qq.com'
      ? { html: await require('./wechat').pacedPage(article.url), url: article.url }
      : await fetchPageImpl(article.url, { withUrl: true });
    const { html } = page;
    if (isVideoPageUrl(page.url)) return { text: '', images: [], status: 'video-page' };
    if (isAccessChallenge(html)) throw new Error('访问验证，停止正文抓取');
    const content = extractContent(html, page.url, { nowMs: Date.parse(article.fetched_at) || Date.now() });
    return { ...content, status: content.text ? 'ok' : '正文为空' };
  } catch (error) { return { text: '', images: [], status: String(error.message).slice(0, 180) }; }
}
function isAccessChallenge(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  // A comment widget's captcha script is not a challenge blocking the article.
  return /环境异常|访问过于频繁|请完成验证|正在进行安全检测|captcha|登录后查看|verify (?:that )?you are human|checking your browser/i.test($('title').text() + ' ' + $('body').text());
}
module.exports = { extractContent, extractPublicationDate, enrichArticle, isAccessChallenge, reprintSource };
