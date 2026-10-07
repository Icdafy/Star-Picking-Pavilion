'use strict';
// RSS 适配器（标准 RSS / Atom / 必应资讯 RSS / RSSHub 通用）
const Parser = require('rss-parser');
const { fetchText } = require('./fetch-util');
const { extractContent } = require('./article-content');
const { dateFromUrl } = require('./loose-date');
const { stripMarkup, decodeEntities } = require('../ai/normalize');
const { isVideoPageUrl } = require('./video-url');

class SourceParser extends Parser {
  buildAtomFeed(document) {
    const feed = super.buildAtomFeed(document);
    feed.isAtom = true;
    feed.atomBase = document.feed.$?.['xml:base'];
    return feed;
  }
  parseItemAtom(entry) {
    const valid = { ...entry };
    for (const name of ['published', 'updated']) {
      if (valid[name] && (typeof valid[name][0] !== 'string' || !Number.isFinite(Date.parse(valid[name][0])))) delete valid[name];
    }
    const item = super.parseItemAtom(valid);
    item.atomBase = entry.$?.['xml:base'];
    const links = entry.link || [];
    item.linkBase = (links.find(link => link.$?.rel === 'alternate') || links[0])?.$?.['xml:base'];
    return item;
  }
}
const parser = new SourceParser({
  customFields: {
    item: [
      ['description', 'description'],
      ['title', 'atomTitle', { keepArray: true }],
      ['summary', 'atomSummary', { keepArray: true }],
      ['content', 'atomContent', { keepArray: true }],
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure']
    ]
  }
});

// rsshub://<route> → 用设置里的 RSSHub 实例地址拼成完整 URL
function resolveUrl(url, settings) {
  if (url.startsWith('rsshub://')) {
    const base = (settings.collect.rsshubBase || '').replace(/\/$/, '');
    if (!base) throw new Error('未配置 RSSHub 地址（设置页填写后启用）');
    return base + '/' + url.slice('rsshub://'.length).replace(/^\//, '');
  }
  return url;
}

async function fetch(source, settings) {
  const feedUrl = resolveUrl(source.url, settings);
  const xml = await fetchText(feedUrl, settings, { international: Boolean(source.intl) });
  const cleanedXml = flattenAtomXhtml(sanitizeXml(xml));
  const feed = await parser.parseString(cleanedXml);
  const atom = feed.isAtom === true;
  return (feed.items || []).map(it => {
    // XML 已解码一次。Atom 默认/text 的尖括号和 &amp; 是字面数据，不再按 HTML 解释。
    const readAtom = (field, fallback) => {
      const node = field?.[0];
      const plain = !node?.$?.type || node.$.type === 'text';
      const text = typeof node === 'string' ? node : typeof node?._ === 'string' ? node._ : fallback || '';
      return { text: plain ? String(text).replace(/\s+/g, ' ').trim() : cleanText(text), plain };
    };
    const title = atom ? readAtom(it.atomTitle, it.title).text : cleanText(it.title);
    const summaryField = it.atomSummary ? readAtom(it.atomSummary, it.summary) : null;
    const contentField = readAtom(it.atomContent, it.content);
    const body = atom && contentField.plain ? '' : it['content:encoded'] || it.content || it.description || '';
    let address = it.link;
    if (typeof address === 'string' && address.trim()) {
      try {
        const feedBase = new URL(feed.atomBase || '', feedUrl);
        const entryBase = new URL(it.atomBase || '', feedBase);
        address = new URL(address, new URL(it.linkBase || '', entryBase)).href;
      } catch {}
    }
    const url = normalizeUrl(address);
    const images = body && url ? extractContent(body, url).images : [];
    return { title, url, textFormat: 'plain',
      summary: atom ? summaryField?.text || contentField.text : cleanText(it.description || it['content:encoded'] || it.content || ''),
      publishedAt: toIso(it.isoDate || it.pubDate) || dateFromUrl(url),
      image: extractImage({ ...it, content: '', 'content:encoded': '', description: '' }) || images[0]?.url || null, images };
  });
}

// 部分媒体 feed 会把标题里的 R&D 等裸 & 直接写进 XML，导致整个信源
// 无法解析。只转义不构成合法 XML 实体的 &，保留已有命名/数字实体。
function sanitizeXml(xml) {
  return String(xml || '').replace(
    /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/gi,
    match => match[0] === '<' ? match : '&amp;'
  );
}

// Atom 的 type="xhtml" 文本结构是混合内容：xml2js 会把 <title> 拆成对象（标题变成 [object Object]）
// 并打乱文字顺序。解析前把它改写成等价的 type="html" 转义文本，保留标记与语序，交给 cleanText 统一去标签。
// 对应 AIHOT 1db4b16「preserve Atom XHTML text constructs」。
function flattenAtomXhtml(xml) {
  return String(xml || '').replace(
    /<(title|summary|content|subtitle|rights)(\s[^>]*?\btype\s*=\s*["']xhtml["'][^>]*)>([\s\S]*?)<\/\1>/gi,
    (_, tag, attrs, inner) => {
      const markup = inner.trim()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<${tag}${attrs.replace(/\btype\s*=\s*["']xhtml["']/i, 'type="html"')}>${markup}</${tag}>`;
    }
  );
}

// 依次尝试：media:content / media:thumbnail / enclosure / 正文首个 <img>
function extractImage(it) {
  const fromMedia = arr => {
    if (!arr) return null;
    const list = Array.isArray(arr) ? arr : [arr];
    for (const m of list) {
      const u = m?.$?.url || m?.url;
      if (u && /^https?:\/\//.test(u) && /\.(jpe?g|png|webp|gif|avif)/i.test(u)) return u;
      if (u && m?.$?.medium === 'image') return u;
    }
    return null;
  };
  let img = fromMedia(it.mediaContent) || fromMedia(it.mediaThumbnail);
  if (!img && it.enclosure?.url && /image/i.test(it.enclosure.type || '')) img = it.enclosure.url;
  if (!img) {
    const html = it['content:encoded'] || it.content || it.description || '';
    const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && /^https?:\/\//.test(m[1])) img = m[1];
  }
  return img && !isVideoPageUrl(img) ? img : null;
}

function cleanText(s) {
  return decodeEntities(stripMarkup(s)).replace(/\s+/g, ' ').trim();
}

function toIso(d) {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t) ? null : t.toISOString();
}

// 必应资讯的链接带跳转包装，解出真实地址
// 解出的地址与原始 link 一样只允许无内嵌凭据的 HTTP(S)：信源内容不受信任，
// javascript:/data:/file: 等 scheme 必须在这里就出不了采集层，而不是等前端兜底。
function normalizeUrl(link) {
  if (!link) return null;
  let candidate = link;
  try {
    const u = new URL(link);
    if (u.hostname.includes('bing.com') && u.searchParams.get('url')) {
      candidate = decodeURIComponent(u.searchParams.get('url'));
    }
  } catch { /* 解析失败保留原文，交下方统一校验 */ }
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return candidate;
  } catch {
    return null;
  }
}

module.exports = { fetch, resolveUrl, sanitizeXml, flattenAtomXhtml, normalizeUrl, cleanText };
