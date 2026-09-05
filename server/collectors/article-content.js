'use strict';
const cheerio = require('cheerio');
const { publicUrl, fetchPage } = require('./public-web');

function extractContent(html, url) {
  const $ = cheerio.load(html);
  const root = $('#js_content, article, .article-content, .article_content, .TRS_Editor, #content, .news-content').first();
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
      if (!images.some(i => i.url === u) && images.length < 6) images.push({ url: u, caption: alt });
    } catch {}
  });
  const text = content.text().replace(/\s+/g, ' ').trim().slice(0, 12000);
  const published = $('meta[property="article:published_time"]').attr('content')
    || $('meta[name="publishdate"]').attr('content') || $('time[datetime]').first().attr('datetime');
  const ct = html.match(/\b(?:ct|publish_time)\s*[:=]\s*["']?(\d{10})/);
  const publishedAt = published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString()
    : ct ? new Date(Number(ct[1]) * 1000).toISOString() : null;
  const publisherId = ($('#js_name').text().trim() || html.match(/var\s+user_name\s*=\s*["']([^"']+)/)?.[1] || '').slice(0, 120);
  return { text, images, publishedAt, publisherId,
    title: ($('#activity-name').text() || $('h1').first().text() || $('title').text()).trim().slice(0, 300) };
}

async function enrichArticle(article) {
  try {
    const page = new URL(article.url).hostname === 'mp.weixin.qq.com' ? require('./wechat').pacedPage : fetchPage;
    const html = await page(article.url);
    if (/环境异常|访问过于频繁|请完成验证|captcha|登录后查看/i.test(html)) throw new Error('访问验证，停止正文抓取');
    return { ...extractContent(html, article.url), status: 'ok' };
  } catch (error) { return { text: '', images: [], status: String(error.message).slice(0, 180) }; }
}
module.exports = { extractContent, enrichArticle };
