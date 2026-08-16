'use strict';
// HTML 爬虫适配器 —— 面向政府/官方网站的新闻列表页
// selector_json: { list: "css选择器(a元素或含a的容器)", datePattern: "日期正则" }
const cheerio = require('cheerio');
const { fetchText } = require('./fetch-util');

async function fetch(source, settings) {
  const html = await fetchText(source.url, settings);
  const $ = cheerio.load(html);
  const cfg = source.selector_json ? JSON.parse(source.selector_json) : {};
  const listSel = cfg.list || 'ul li a';
  const dateRe = cfg.datePattern ? new RegExp(cfg.datePattern) : /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/;

  const seen = new Set();
  const items = [];
  $(listSel).each((_, el) => {
    const $a = $(el).is('a') ? $(el) : $(el).find('a').first();
    if (!$a.length) return;
    const href = $a.attr('href');
    const title = ($a.attr('title') || $a.text() || '').replace(/\s+/g, ' ').trim();
    if (!href || !title || title.length < 10) return; // 过滤导航类短链接
    // 过滤站点导航/栏目入口等非新闻链接
    if (/^(链接到|进入|返回|首页|更多|查看|无障碍|english|登录|注册)/i.test(title)) return;
    if (/(司|局|处|办公室|中心|频道|专栏|栏目|网|网站|平台|系统|专题)[”"』」]?$/.test(title) && title.length < 16) return;
    // 仅收当前站点的内容页；锚点、脚本与一切非 HTTP(S) scheme（data:/mailto:/tel: 等）
    // 在采集层直接丢弃，不信源内容把非浏览协议带进库
    if (/^javascript:|^#/i.test(href.trim())) return;
    let url;
    try {
      const parsed = new URL(href, source.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      if (parsed.username || parsed.password) return;
      url = parsed.href;
    } catch { return; }
    if (seen.has(url) || url === source.url) return;
    seen.add(url);

    // 日期：在链接附近的文本里找
    const ctx = $a.closest('li,tr,div').text() || '';
    const m = ctx.match(dateRe);
    let publishedAt = null;
    if (m) {
      const norm = m[0].replace(/[年月]/g, '-').replace(/日/g, '');
      const t = new Date(norm);
      if (!isNaN(t)) publishedAt = t.toISOString();
    }
    items.push({ title, url, summary: '', publishedAt });
  });
  return items.slice(0, 40);
}

module.exports = { fetch };
