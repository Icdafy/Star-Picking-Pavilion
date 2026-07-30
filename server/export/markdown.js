'use strict';
// 情报导出 —— 把日报和信息流渲染成可以直接贴进微信群、周报或笔记的文本。
// 纯函数，不碰数据库：调用方负责取数，这里只负责排版，因此可以逐条断言。
//
// 两种格式共用同一份结构（标题 / 概要 / 分组 / 条目），只在序列化时分叉：
//   markdown —— 保留链接语法与层级，适合贴进 Markdown 笔记与仓库
//   text     —— 纯文本，链接单独成行，适合贴进微信群与邮件

const DOMAIN_NAMES = { lowaltitude: '低空经济', aerospace: '商业航天' };
const EXPORT_VERSION = '0.0.12';
const FORMATS = new Set(['markdown', 'text']);
// 只转义行内有语义的字符：标题里出现 [] 或 * 时不转义会把链接和强调撑破，
// 而 # - . 之类只在行首有语义，本模块每一行都自带前缀（`# `/`> `/`N. `/`   - `），
// 连带转义它们只会把 2026-07-25 写成 2026\-07\-25，白白劣化可读性。
const MARKDOWN_ESCAPE = /[\\`*_[\]<]/g;
// 控制字符不是空白，\s 清不掉，但会把「一条一行」的排版撑破
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/gu;

function normalizeFormat(value) {
  return FORMATS.has(value) ? value : 'markdown';
}

function flatten(value) {
  if (value == null) return '';
  return String(value)
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeMarkdown(value) {
  return flatten(value).replace(MARKDOWN_ESCAPE, character => `\\${character}`);
}

// 只导出绝对 HTTP(S) 链接。javascript: 之类进不了剪贴板，也就进不了同事的浏览器
function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

function formatStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 「来源（T1） · 低空经济 · 政策法规 · 质量分 82」
function describeEntry(item) {
  const parts = [];
  const source = flatten(item.source || item.source_name || item.sourceName);
  const tier = flatten(item.tier || item.sourceTier);
  if (source) parts.push(tier ? `${source}（${tier}）` : source);
  const domain = DOMAIN_NAMES[item.domain];
  if (domain) parts.push(domain);
  const category = flatten(item.category);
  if (category) parts.push(category);
  const quality = Number(item.quality ?? item.quality_score);
  if (Number.isFinite(quality)) parts.push(`质量分 ${Math.round(quality)}`);
  const clusterSize = Number(item.clusterSize ?? item.cluster_size);
  if (Number.isFinite(clusterSize) && clusterSize > 1) parts.push(`${clusterSize} 个信源`);
  const breakthroughBonus = Number(item.breakthroughBonus ?? item.breakthrough_bonus);
  if (Number.isFinite(breakthroughBonus) && breakthroughBonus > 0) {
    parts.push(`技术突破 +${Math.round(breakthroughBonus * 10) / 10}`);
  }
  return parts;
}

function entryLines(item, index, format) {
  const title = flatten(item.title) || '（无标题）';
  const url = safeUrl(item.url);
  const meta = describeEntry(item).join(' · ');
  const summary = flatten(
    item.summary || item.ai_summary || item.aiSummary || item.rawSummary
  );
  const reason = flatten(item.reason || item.ai_reason || item.aiReason);
  const lines = [];

  if (format === 'markdown') {
    const label = escapeMarkdown(title);
    lines.push(`${index}. ${url ? `**[${label}](${url})**` : `**${label}**`}`);
    if (meta) lines.push(`   - ${escapeMarkdown(meta)}`);
    if (summary) lines.push(`   - ${escapeMarkdown(summary)}`);
    if (reason) lines.push(`   - 研判：${escapeMarkdown(reason)}`);
    return lines;
  }

  lines.push(`${index}. ${title}`);
  if (meta) lines.push(`   ${meta}`);
  if (summary) lines.push(`   ${summary}`);
  if (reason) lines.push(`   研判：${reason}`);
  if (url) lines.push(`   ${url}`);
  return lines;
}

function serialize(document, format) {
  const heading = format === 'markdown' ? `# ${escapeMarkdown(document.title)}` : document.title;
  const blocks = [heading];

  if (document.summary.length) {
    blocks.push(document.summary
      .map(line => format === 'markdown' ? `> ${escapeMarkdown(line)}` : line)
      .join('\n'));
  }

  let rendered = 0;
  for (const section of document.sections) {
    const entries = section.items.map((item, offset) =>
      entryLines(item, offset + 1, format).join('\n'));
    if (!entries.length) continue;
    rendered += entries.length;
    if (section.title) {
      blocks.push(format === 'markdown'
        ? `## ${escapeMarkdown(section.title)}`
        : `【${section.title}】`);
    }
    blocks.push(entries.join('\n'));
  }
  if (!rendered) blocks.push(document.emptyHint);

  blocks.push(format === 'markdown' ? `---\n\n${document.footer}` : `— ${document.footer}`);
  return `${blocks.join('\n\n')}\n`;
}

function footerLine({ productName, homepage } = {}) {
  const name = flatten(productName) || '摘星阁';
  const parts = [`由 ${name} v${EXPORT_VERSION} 生成`];
  const link = safeUrl(homepage);
  if (link) parts.push(link);
  return parts.join(' · ');
}

function renderDaily(report, options = {}) {
  const format = normalizeFormat(options.format);
  const name = flatten(options.productName) || '摘星阁';
  const sections = Array.isArray(report?.sections) ? report.sections : [];
  const byDomain = report?.byDomain || {};
  const summary = [
    `共 ${Number(report?.total) || 0} 条精选`
    + ` · 低空经济 ${Number(byDomain.lowaltitude) || 0} 条`
    + ` · 商业航天 ${Number(byDomain.aerospace) || 0} 条`
  ];
  const generatedAt = formatStamp(report?.generatedAt);
  if (generatedAt) summary.push(`生成于 ${generatedAt}`);

  return serialize({
    title: `${name} · 情报日报 ${flatten(report?.date)}`,
    summary,
    sections: sections.map(section => ({
      title: flatten(section?.category),
      items: Array.isArray(section?.items) ? section.items : []
    })),
    emptyHint: '该日期没有达到精选阈值的情报。',
    footer: footerLine(options)
  }, format);
}

function renderDailyArchive(bundle, options = {}) {
  const name = flatten(options.productName) || '摘星阁';
  const summary = bundle?.summary || {};
  const byDomain = summary.byDomain || {};
  const readable = bundle?.readable || {};
  const windowStart = formatStamp(bundle?.window?.start);
  const windowEnd = formatStamp(bundle?.window?.end);
  const summaryLines = [
    `窗口 ${windowStart || '未知'} 至 ${windowEnd || '未知'}（按采集时间，前开后闭）`,
    `采集 ${Number(summary.total) || 0} 条 · 行业相关 ${Number(summary.relevant) || 0} 条`
      + ` · 精选 ${Number(summary.featured) || 0} 条`,
    `待分析 ${Number(summary.pending) || 0} 条 · 无关 ${Number(summary.irrelevant) || 0} 条`
      + ` · 技术突破 ${Number(summary.breakthroughs) || 0} 条`,
    `低空经济 ${Number(byDomain.lowaltitude) || 0} 条 · 商业航天 ${Number(byDomain.aerospace) || 0} 条`
  ];
  const generatedAt = formatStamp(bundle?.generatedAt);
  if (generatedAt) summaryLines.push(`生成于 ${generatedAt}`);

  const sections = [];
  if (Array.isArray(readable.hot) && readable.hot.length) {
    sections.push({ title: '当日热点', items: readable.hot });
  }
  if (Array.isArray(readable.breakthroughs) && readable.breakthroughs.length) {
    sections.push({ title: '可信技术突破', items: readable.breakthroughs });
  }
  for (const section of Array.isArray(readable.sections) ? readable.sections : []) {
    sections.push({
      title: flatten(section?.category),
      items: Array.isArray(section?.items) ? section.items : []
    });
  }
  if (Array.isArray(readable.relevantIndex) && readable.relevantIndex.length) {
    sections.push({ title: '完整行业索引', items: readable.relevantIndex });
  }

  return serialize({
    title: `${name} · 每日新闻简报 ${flatten(bundle?.date)}`,
    summary: summaryLines,
    sections,
    emptyHint: '过去 24 小时未采集到新闻记录。',
    footer: `${footerLine(options)} · 全量机器数据见 news.jsonl`
  }, 'markdown');
}

function renderArticles(items, options = {}) {
  const format = normalizeFormat(options.format);
  const name = flatten(options.productName) || '摘星阁';
  const list = Array.isArray(items) ? items : [];
  const summary = [`共 ${list.length} 条`];
  if (options.subtitle) summary.push(flatten(options.subtitle));
  const exportedAt = formatStamp(options.exportedAt || new Date());
  if (exportedAt) summary.push(`导出于 ${exportedAt}`);

  return serialize({
    title: `${name} · ${flatten(options.title) || '情报摘录'}`,
    summary,
    sections: [{ title: '', items: list }],
    emptyHint: '当前筛选条件下没有情报。',
    footer: footerLine(options)
  }, format);
}

// 文件名要能直接落到 Windows 磁盘：去掉保留字符，保留可读的中文标题
function exportFilename(label, stamp, format) {
  const safeLabel = flatten(label).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-') || 'export';
  const safeStamp = flatten(stamp).replace(/[^0-9A-Za-z-]/g, '');
  const extension = normalizeFormat(format) === 'markdown' ? 'md' : 'txt';
  return `${[safeLabel, safeStamp].filter(Boolean).join('-')}.${extension}`;
}

module.exports = {
  EXPORT_VERSION,
  FORMATS,
  normalizeFormat,
  escapeMarkdown,
  renderDaily,
  renderDailyArchive,
  renderArticles,
  exportFilename
};
