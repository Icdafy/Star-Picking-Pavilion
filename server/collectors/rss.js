'use strict';
// RSS 适配器（标准 RSS / Atom / 必应资讯 RSS / RSSHub 通用）
const Parser = require('rss-parser');
const { fetchText } = require('./fetch-util');
const { extractContent } = require('./article-content');

const parser = new Parser({
  customFields: {
    item: [
      ['description', 'description'],
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
  const xml = await fetchText(resolveUrl(source.url, settings), settings, { international: Boolean(source.intl) });
  const feed = await parser.parseString(flattenAtomXhtml(sanitizeXml(xml)));
  return (feed.items || []).map(it => ({
    title: cleanText(it.title),
    url: normalizeUrl(it.link),
    summary: cleanText(it.contentSnippet || it.description || it.content || ''),
    publishedAt: toIso(it.isoDate || it.pubDate),
    image: extractImage(it),
    images: extractContent(it['content:encoded'] || it.content || it.description || '', it.link).images
  }));
}

// 部分媒体 feed 会把标题里的 R&D 等裸 & 直接写进 XML，导致整个信源
// 无法解析。只转义不构成合法 XML 实体的 &，保留已有命名/数字实体。
function sanitizeXml(xml) {
  return String(xml || '').replace(
    /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/gi,
    '&amp;'
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
        .replace(/^<div\b[^>]*>/i, '').replace(/<\/div>$/i, '')
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
  return img || null;
}

function cleanText(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
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
