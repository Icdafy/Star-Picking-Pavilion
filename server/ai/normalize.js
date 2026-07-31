'use strict';
// 管线第 1、2 段：结构化 与 数据清洗 —— 纯代码、零成本、可反复执行。
//
// AIHOT 每天进上万条原始新闻，脏数据如果留到模型那一层，代价是双份的：
// 既污染预筛判断（同一篇文章因为跟踪参数不同被当成三条、标题尾巴让 bigram 相似度失真），
// 又按 token 收费。所以在入库之前先把每条原始条目压成统一形状。
//
// 三件事，各自幂等：
//   ① 规范化 URL —— 去掉跟踪参数与锚点，得到跨信源可比的去重键
//   ② 清洗标题 —— HTML 实体、站点后缀、全角字母数字、重复空白
//   ③ 清洗正文摘要 —— 标签、免责声明与「责任编辑」这类固定尾巴
//
// 清洗结果会写回库并用 clean_version 打标，改了规则只要抬版本号，
// 下一轮分析就会把历史数据顺带洗一遍，不需要全量重跑管线。
const CLEAN_VERSION = 1;

// 跟踪参数：这些键存在与否不改变文章内容，却让同一篇文章有无数个 URL。
// 前缀型放 PREFIXES，精确型放 EXACT，避免误伤 `source_id` 这类真参数。
const TRACKING_PREFIXES = ['utm_', 'spm_', 'hmsr', 'hmpl', 'hmcu', 'hmkw', 'hmci', '_hs'];
const TRACKING_EXACT = new Set([
  'spm', 'from', 'src', 'source', 'ref', 'referrer', 'share', 'shareto', 'sharesource',
  'scene', 'chksm', 'clicktime', 'enterid', 'fbclid', 'gclid', 'msclkid', 'yclid',
  'sessionid', 'timestamp', 'wxshare', 'weibo_id', 'isappinstalled', 'wfr', 'for'
]);

function isTrackingParam(key) {
  const name = key.toLowerCase();
  return TRACKING_EXACT.has(name) || TRACKING_PREFIXES.some(prefix => name.startsWith(prefix));
}

// 去重键，不是展示用的地址：原始 url 照旧存库并用于跳转，这里只求「同一篇文章算同一个键」。
// 因此可以放心地丢掉 www.、末尾斜杠和锚点，并把剩余查询参数排序。
function canonicalizeUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return '';
  let url;
  try { url = new URL(input); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol)) return '';

  url.hash = '';
  url.username = '';
  url.password = '';
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if ((url.port === '80' || url.port === '443')) url.port = '';

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);

  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&ensp;': ' ', '&emsp;': ' ', '&#39;': "'", '&#34;': '"', '&middot;': '·'
};

function decodeEntities(text) {
  return String(text || '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|ensp|emsp|#39|#34|middot);/g, m => ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, hex) => safeCodePoint(parseInt(hex, 16), m))
    .replace(/&#(\d{1,7});/g, (m, dec) => safeCodePoint(Number(dec), m));
}

function safeCodePoint(code, fallback) {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return fallback;
  // 代理区码位单独出现会产生孤立代理项，String.fromCodePoint 会抛错
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  try { return String.fromCodePoint(code); } catch { return fallback; }
}

function stripMarkup(text) {
  return String(text || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]{0,400}>/g, ' ');
}

// 控制字符与零宽字符：采集回来的 HTML 里很常见，会让 bigram 相似度和去重键都失真
function stripInvisible(text) {
  return String(text || '').replace(/[\p{Cc}\p{Cf}]/gu, ' ');
}

// 全角字母数字 → 半角。只动 ＡＺａｚ０９ 三段，不碰中文标点：
// 「Ｃ９１９」和「C919」必须算同一个型号，但「，」变成「,」只会让中文读起来别扭。
function foldFullWidthAlnum(text) {
  return String(text || '').replace(/[０-９Ａ-Ｚａ-ｚ]/g,
    ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function collapseSpace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// 站点后缀：`标题_东方财富网`、`标题 - 中国新闻网`、`标题 | 36氪`。
// 只在尾巴确实像站点名时才剪（含「网/站/新闻/财经/资讯/订阅/网易/新浪/搜狐/号」等），
// 或者尾巴与本条的信源名一致 —— 否则「某型号-试飞成功」这种正常标题会被腰斩。
const SITE_TAIL = /[\s_|｜\-–—]+([^\s_|｜\-–—]{2,14})$/;
const SITE_WORDS = /(网|站|新闻|资讯|财经|日报|晚报|时报|周刊|传媒|订阅|头条|号|媒体|在线|社区|观察|研究院)$/;

function stripSiteTail(title, sourceName) {
  let text = title;
  const source = collapseSpace(sourceName || '');
  // 最多剪三层：`标题_新浪财经_新浪网` 这种叠了两三层站点名的很常见
  for (let round = 0; round < 3; round++) {
    const match = SITE_TAIL.exec(text);
    if (!match) break;
    const tail = match[1];
    const looksLikeSite = SITE_WORDS.test(tail) || (source && tail === source);
    if (!looksLikeSite) break;
    const stripped = text.slice(0, match.index).trim();
    // 剪完不能把标题剪没了：剩不到 6 个字符说明这根本不是站点后缀
    if (stripped.length < 6) break;
    text = stripped;
  }
  return text;
}

function cleanTitle(raw, { sourceName = '' } = {}) {
  let text = collapseSpace(foldFullWidthAlnum(stripInvisible(stripMarkup(decodeEntities(raw)))));
  if (!text) return '';
  const source = collapseSpace(sourceName);
  // 信源名做前缀标记：`【东方财富】xxx`、`[新华社] xxx`
  if (source) {
    const prefix = new RegExp(`^[\\[【(（]\\s*${escapeRegExp(source)}\\s*[\\]】)）]\\s*`);
    text = text.replace(prefix, '');
  }
  text = stripSiteTail(text, source);
  return text.slice(0, 300).trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 正文尾巴：免责声明、责任编辑、引流话术。命中即从该处截断，后面的内容全是模板。
const BODY_TAILS = [
  /责任编辑[：:]/, /文章来源[：:]/, /本文来源[：:]/, /本文首发/, /原标题[：:]/,
  /免责声明/, /风险提示[：:]/, /声明[：:]本/, /版权声明/, /转载请注明/,
  /点击(关注|订阅|查看|阅读原文)/, /扫码(关注|添加|入群)/, /关注公众号/,
  /更多(精彩|资讯|内容)(请|尽)/, /举报\/反馈/, /\(?文章内容仅供参考/
];

function cleanSummary(raw) {
  let text = collapseSpace(foldFullWidthAlnum(stripInvisible(stripMarkup(decodeEntities(raw)))));
  if (!text) return '';
  for (const pattern of BODY_TAILS) {
    const match = pattern.exec(text);
    // 尾巴出现在最开头时不截断：那说明整段就是声明，截了只剩空串，
    // 留着反而能让预筛认出「这是模板内容」并判无关。
    // 门槛压到 12 字 —— 再高就会把「一句话正文 + 责任编辑」的短讯漏掉，
    // 而那恰恰是通稿里最常见的形态。
    if (match && match.index >= 12) text = text.slice(0, match.index).trim();
  }
  return text.slice(0, 2000).trim();
}

// 采集适配器交上来的原始条目 → 统一结构。返回 null 表示这条不该入库。
function structureItem(item, { sourceName = '', domain = null } = {}) {
  const title = cleanTitle(item?.title, { sourceName });
  const url = String(item?.url || '').trim();
  const canonicalUrl = canonicalizeUrl(url);
  if (!title || !canonicalUrl) return null;
  return {
    title,
    url,
    canonicalUrl,
    summaryRaw: cleanSummary(item?.summary),
    publishedAt: item?.publishedAt || null,
    image: item?.image || null,
    domain,
    cleanVersion: CLEAN_VERSION
  };
}

module.exports = {
  CLEAN_VERSION,
  canonicalizeUrl,
  cleanTitle,
  cleanSummary,
  structureItem,
  decodeEntities,
  stripMarkup,
  foldFullWidthAlnum,
  collapseSpace
};
