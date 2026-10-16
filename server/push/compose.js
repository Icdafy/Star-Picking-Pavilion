'use strict';
// 新闻推送 · 消息排版：同一份摘要渲染成飞书消息卡片、钉钉 Markdown 与 QQ 纯文本三种形态。
// 标题与摘要来自外部网页，Markdown 控制字符一律换成全角等价字符，链接只接受 http(s)，
// 括号与空白做百分号编码，避免一条新闻的标题把整张卡片的排版打碎或伪造出别的链接。
const { PRODUCT_KEYWORD } = require('./channels');

const FEISHU_MAX_BYTES = 18 * 1024;      // 官方上限 20 KB，留出加签字段与余量
const DINGTALK_MAX_BYTES = 18 * 1024;
const QQ_PART_CHARS = 1500;              // 单条 QQ 消息过长会被折叠或风控，按条目边界切分
const QQ_MAX_PARTS = 4;
const SUMMARY_CHARS = 110;

const DOMAIN_LABELS = Object.freeze({ lowaltitude: '低空经济', aerospace: '商业航天', both: '低空 · 航天' });

const FULL_WIDTH = Object.freeze({
  '[': '［', ']': '］', '(': '（', ')': '）', '*': '＊', '_': '＿', '~': '～', '`': '\'',
  '<': '＜', '>': '＞', '#': '＃', '|': '｜', '\\': '＼'
});

function plain(value, maximum) {
  const text = String(value ?? '').replace(/[\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!maximum || [...text].length <= maximum) return text;
  return `${[...text].slice(0, maximum - 1).join('')}…`;
}

function markdownSafe(value, maximum) {
  return plain(value, maximum).replace(/[[\]()*_~`<>#|\\]/g, char => FULL_WIDTH[char]);
}

function safeLink(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href.replace(/[()\s<>]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  } catch {
    return '';
  }
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function formatStamp(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortTime(value, now) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function itemMeta(item, now) {
  return [
    item.source,
    DOMAIN_LABELS[item.domain] || '',
    item.category,
    Number.isFinite(item.heat) ? `热度 ${Math.round(item.heat)}` : '',
    shortTime(item.publishedAt || item.fetchedAt, now)
  ].filter(Boolean).map(part => plain(part, 24)).join(' · ');
}

function normalizeItem(item) {
  return {
    title: plain(item.titleZh || item.title, 90) || '（无标题）',
    url: safeLink(item.url),
    summary: plain(item.summary, SUMMARY_CHARS),
    source: item.source || '',
    domain: item.domain || '',
    category: item.category || '',
    heat: Number.isFinite(Number(item.heat)) && item.heat !== null ? Number(item.heat) : null,
    featured: Boolean(item.featured),
    publishedAt: item.publishedAt || null,
    fetchedAt: item.fetchedAt || null
  };
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

// ---------- 飞书消息卡片（JSON 1.0，自定义机器人 Webhook 全版本可渲染）----------
function feishuCard(digest, items, now) {
  const elements = [];
  if (digest.lead) elements.push({ tag: 'markdown', content: markdownSafe(digest.lead, 300) });
  items.forEach((item, index) => {
    if (elements.length) elements.push({ tag: 'hr' });
    const title = item.url ? `[${markdownSafe(item.title, 90)}](${item.url})` : markdownSafe(item.title, 90);
    const lines = [`**${index + 1}. ${title}**`, `<font color='grey'>${markdownSafe(itemMeta(item, now), 120)}</font>`];
    if (item.summary) lines.push(markdownSafe(item.summary, SUMMARY_CHARS));
    elements.push({ tag: 'markdown', content: lines.join('\n') });
  });
  if (digest.code) elements.push({ tag: 'markdown', content: `**验证码：${digest.code}**` });
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: plain(digest.footer, 120) }] });
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true, enable_forward: true },
      header: { template: digest.kind === 'digest' ? 'indigo' : 'turquoise', title: { tag: 'plain_text', content: plain(digest.title, 60) } },
      elements
    }
  };
}

// ---------- 钉钉 Markdown（换行需两个空格或空行；支持标题、加粗、链接、引用）----------
function dingtalkMarkdown(digest, items, now) {
  const blocks = [`### ${markdownSafe(digest.title, 60)}`];
  if (digest.lead) blocks.push(`> ${markdownSafe(digest.lead, 300)}`);
  items.forEach((item, index) => {
    const title = item.url ? `[${markdownSafe(item.title, 90)}](${item.url})` : markdownSafe(item.title, 90);
    const lines = [`**${index + 1}. ${title}**`, markdownSafe(itemMeta(item, now), 120)];
    if (item.summary) lines.push(markdownSafe(item.summary, SUMMARY_CHARS));
    blocks.push(lines.join('  \n'));
  });
  if (digest.code) blocks.push(`**验证码：${digest.code}**`);
  blocks.push(`###### ${markdownSafe(digest.footer, 120)}`);
  return {
    msgtype: 'markdown',
    markdown: { title: plain(`${digest.title}${items.length ? `（${items.length} 条）` : ''}`, 60), text: blocks.join('\n\n') }
  };
}

// ---------- QQ 纯文本（链接单独成行，QQ 客户端会自动识别为可点击）----------
function qqParts(digest, items, now) {
  const head = [`【${plain(digest.title, 60)}】`];
  if (digest.lead) head.push(plain(digest.lead, 300));
  const blocks = items.map((item, index) => [
    `${index + 1}. ${item.title}`,
    itemMeta(item, now),
    item.summary,
    item.url
  ].filter(Boolean).join('\n'));
  if (digest.code) blocks.push(`验证码：${digest.code}`);
  const footer = `—— ${plain(digest.footer, 120)}`;
  const parts = [];
  let current = head.join('\n');
  for (const block of blocks) {
    if (current && [...current].length + [...block].length + 2 > QQ_PART_CHARS) {
      parts.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  current = current ? `${current}\n\n${footer}` : footer;
  parts.push(current);
  if (parts.length <= QQ_MAX_PARTS) return parts.map((text, index) => (parts.length > 1 ? `${text}\n（${index + 1}/${parts.length}）` : text));
  return parts.slice(0, QQ_MAX_PARTS).map((text, index) => `${text}\n（${index + 1}/${QQ_MAX_PARTS}）`);
}

// digest: { kind: 'digest' | 'test' | 'verify' | 'empty', title, lead, footer, code? }
function composeMessage(digest, rawItems = [], { now = new Date() } = {}) {
  let items = rawItems.map(normalizeItem);
  const full = {
    ...digest,
    footer: digest.footer || `${PRODUCT_KEYWORD} · 低空经济与商业航天情报 · 由你本机的摘星阁发送`
  };
  // 单条请求体超限时从末尾逐条舍弃，宁可少推几条也不让整次推送被平台拒收
  let feishu = feishuCard(full, items, now);
  let dingtalk = dingtalkMarkdown(full, items, now);
  while (items.length > 1 && (bytes(feishu) > FEISHU_MAX_BYTES || bytes(dingtalk) > DINGTALK_MAX_BYTES)) {
    items = items.slice(0, -1);
    feishu = feishuCard(full, items, now);
    dingtalk = dingtalkMarkdown(full, items, now);
  }
  return { feishu, dingtalk, qq: qqParts(full, items, now), count: items.length };
}

function digestHeadline({ items, scope, now = new Date() }) {
  const label = scope === 'relevant' ? '相关动态' : '精选情报';
  const domains = new Set(items.map(item => item.domain));
  const parts = [];
  const low = items.filter(item => item.domain === 'lowaltitude' || item.domain === 'both').length;
  const space = items.filter(item => item.domain === 'aerospace' || item.domain === 'both').length;
  if (domains.size > 1 || low && space) parts.push(`低空 ${low} · 航天 ${space}`);
  return {
    kind: 'digest',
    title: `${PRODUCT_KEYWORD} · ${label}推送`,
    lead: `${formatStamp(now)} · 本期 ${items.length} 条${parts.length ? `（${parts.join('')}）` : ''}，按热度排序`
  };
}

module.exports = {
  composeMessage, digestHeadline, formatStamp, markdownSafe, safeLink, plain,
  FEISHU_MAX_BYTES, DINGTALK_MAX_BYTES, QQ_PART_CHARS, QQ_MAX_PARTS
};
