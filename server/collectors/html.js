'use strict';
// HTML 爬虫适配器 —— 面向政府/官方网站的新闻列表页
// selector_json: { list: "css选择器(a元素或含a的容器)", datePattern: "日期正则",
//                  title: "链接内标题元素（可选，如 h1）", summary: "链接内摘要元素（可选）", utcOffset: "+08:00" }
// 卡片式列表常把封面、标题、导语、出处整个包进一个 <a>：指定 title/summary 后只取对应元素的文字。
const cheerio = require('cheerio');
const { fetchText } = require('./fetch-util');
const { looseDateIso, dateFromUrl, listDateIso } = require('./loose-date');
const { parsePublicationDate } = require('./publication-date');

function parseHtml(html, source, { nowMs = Date.now() } = {}) {
  const $ = cheerio.load(html);
  const cfg = source.selector_json ? JSON.parse(source.selector_json) : {};
  const listSel = cfg.list || 'ul li a';
  const dateRe = cfg.datePattern ? new RegExp(cfg.datePattern) : /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/;

  const seen = new Map();
  const linkRe = cfg.linkPattern ? new RegExp(cfg.linkPattern) : null;
  const items = [];
  $(listSel).each((_, el) => {
    const $a = $(el).is('a') ? $(el) : $(el).find('a').first();
    if (!$a.length) return;
    const href = $a.attr('href');
    const $row = cfg.row && $(el).closest(cfg.row).length ? $(el).closest(cfg.row)
      : $(el).is('a') ? ($a.closest('li,tr,article').length ? $a.closest('li,tr,article') : $a.parent()) : $(el);
    const titleText = cfg.title ? ($a.is(cfg.title) ? $a.text() : $row.find(cfg.title).first().text()) : '';
    const title = (titleText || $a.attr('title') || $a.text() || '').replace(/\s+/g, ' ').trim();
    const summary = cfg.summary ? $row.find(cfg.summary).first().text().replace(/\s+/g, ' ').trim().slice(0, 400) : '';
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
    if (linkRe && !linkRe.test(url)) return;
    if (url === source.url) return;

    // 日期：在链接附近的文本里找
    const $date = cfg.date ? $row.find(cfg.date).first() : null;
    const ctx = cfg.date ? ($date?.length ? ($date.attr('datetime') || $date.text()) : '') : ($row.text() || '');
    const dateText = ctx.match(dateRe)?.[0] || '';
    const zone = cfg.utcOffset || '+08:00';
    let publication = parsePublicationDate(cfg.date ? ctx : dateText, { nowMs, utcOffset: zone, url });
    let publishedAt = publication?.publishedAt || (cfg.date && $date?.length ? listDateIso(ctx, zone, nowMs) : null);
    if (!publishedAt && cfg.dateParts) {
      const parts = ['year', 'month', 'day'].map(key => $row.find(cfg.dateParts[key]).first().text().match(/\d+/)?.[0]);
      if (parts.every(Boolean)) {
        publication = parsePublicationDate(`${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`, { utcOffset: zone, url });
        publishedAt = publication?.publishedAt || null;
      }
    }
    if (!publishedAt && dateText) publishedAt = cfg.date ? listDateIso(dateText, zone, nowMs) : looseDateIso(dateText, zone);
    if (!publishedAt) publishedAt = dateFromUrl(url);
    // 首页封面往往没有时间，列表中的同一 URL 有完整日期；合并缺项而非丢弃后者。
    const prior = seen.get(url);
    if (prior) {
      if (!prior.publishedAt && publishedAt) Object.assign(prior, publication || { publishedAt });
      if (!prior.summary && summary) prior.summary = summary;
      if (/[.…]{3}|…$/.test(prior.title) && !/[.…]{3}|…$/.test(title)) prior.title = title;
      return;
    }
    const item = { title, url, summary, publishedAt, ...(publication || {}) };
    seen.set(url, item);
    items.push(item);
  });
  return items.slice(0, 40);
}

async function fetch(source, settings) {
  return parseHtml(await fetchText(source.url, settings, { international: Boolean(source.intl) }), source);
}

module.exports = { fetch, parseHtml };
