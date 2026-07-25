'use strict';

const { HttpError } = require('./http-security');
// 与采集器共用同一个解析器：信源地址的写法只有一处定义，校验与采集不会各说各话
const { parseEastmoneySpec } = require('./collectors/api');

const SOURCE_TYPES = new Set(['rss', 'bing', 'html', 'api']);
const SOURCE_TIERS = new Set(['T1', 'T1.5', 'T2']);
const SOURCE_DOMAINS = new Set(['both', 'lowaltitude', 'aerospace']);
const FEED_VIEWS = new Set(['featured', 'hot', 'all', 'starred']);
const FEED_DOMAINS = new Set(['lowaltitude', 'aerospace']);
const EXPORT_KINDS = new Set(['daily', 'feed']);
const EXPORT_FORMATS = new Set(['markdown', 'text']);

function badRequest(message) {
  throw new HttpError(400, message);
}

function boundedString(value, label, { min = 0, max, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') badRequest(`${label}必须是文本`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    badRequest(`${label}长度必须在 ${min} 到 ${max} 个字符之间`);
  }
  if (/\p{Cc}/u.test(normalized)) badRequest(`${label}不能包含控制字符`);
  return normalized;
}

function validateHttpAddress(value) {
  let url;
  try { url = new URL(value); } catch { badRequest('信源地址不是有效 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    badRequest('信源地址必须是无内嵌凭据的 HTTP 或 HTTPS URL');
  }
  return url.href;
}

function validateSourceUrl(type, value) {
  const url = boundedString(value, '信源地址', { min: 1, max: 2048 });
  if (type === 'api') {
    if (!url.startsWith('eastmoney://')) badRequest('API 信源当前仅支持 eastmoney://关键词');
    // 形如 eastmoney://关键词?pages=2&mode=both&guard=off —— 关键词与可选参数分开校验，
    // 否则 "?pages=2" 会被当成关键词的一部分混过长度检查
    let spec;
    try { spec = parseEastmoneySpec(url); } catch (error) {
      badRequest(error instanceof HttpError ? error.message : 'eastmoney 信源格式无效');
    }
    boundedString(spec.keyword, 'eastmoney 关键词', { min: 1, max: 100 });
    return url;
  }
  if (type === 'rss' && url.startsWith('rsshub://')) {
    boundedString(url.slice('rsshub://'.length), 'RSSHub 路由', { min: 1, max: 500 });
    return url;
  }
  return validateHttpAddress(url);
}

function sanitizeSelector(value, current) {
  if (value === undefined) {
    if (!current?.selector_json) return null;
    try { return sanitizeSelector(JSON.parse(current.selector_json), null); } catch { return null; }
  }
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) badRequest('选择器必须是对象');
  if (Object.keys(value).some(key => !['list', 'datePattern'].includes(key))) {
    badRequest('选择器包含不支持的字段');
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) badRequest('选择器配置过长');
  const selector = {};
  if (value.list !== undefined) {
    selector.list = boundedString(value.list, 'CSS 选择器', { min: 1, max: 500 });
  }
  if (value.datePattern !== undefined) {
    selector.datePattern = boundedString(value.datePattern, '日期正则', { min: 1, max: 200 });
    try { new RegExp(selector.datePattern); } catch { badRequest('日期正则不是有效表达式'); }
  }
  return selector;
}

function sanitizeSourceInput(input, current = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) badRequest('信源请求体必须是对象');
  const name = boundedString(input.name ?? current?.name, '信源名称', { min: 1, max: 120 });
  const type = boundedString(input.type ?? current?.type ?? 'rss', '信源类型', { min: 1, max: 20 });
  if (!SOURCE_TYPES.has(type)) badRequest('不支持的信源类型');
  const url = validateSourceUrl(type, input.url ?? current?.url);
  const tier = boundedString(input.tier ?? current?.tier ?? 'T2', '信源等级', { min: 1, max: 10 });
  if (!SOURCE_TIERS.has(tier)) badRequest('不支持的信源等级');
  const domain = boundedString(input.domain ?? current?.domain ?? 'both', '信源领域', { min: 1, max: 20 });
  if (!SOURCE_DOMAINS.has(domain)) badRequest('不支持的信源领域');
  const noteValue = input.note !== undefined ? input.note : current?.note;
  const note = noteValue == null ? null : boundedString(noteValue, '信源备注', { max: 1000 });
  const selector = sanitizeSelector(input.selector, current);
  const enabledValue = input.enabled !== undefined ? input.enabled : (current ? Boolean(current.enabled) : true);
  if (typeof enabledValue !== 'boolean') badRequest('启用状态必须是布尔值');
  return { name, type, url, tier, domain, note, selector, enabled: enabledValue };
}

function parseFeedQuery(query, categories) {
  const view = query.get('view') || 'featured';
  if (!FEED_VIEWS.has(view)) badRequest('不支持的信息流视图');
  const domain = query.get('domain') || '';
  if (domain && !FEED_DOMAINS.has(domain)) badRequest('不支持的信息流领域');
  const category = query.get('category') || '';
  if (category && !categories.includes(category)) badRequest('不支持的信息流分类');
  const search = (query.get('q') || '').trim();
  if (search.length > 200) badRequest('检索关键词不得超过 200 个字符');
  const rawPage = query.get('page') || '0';
  if (!/^\d+$/.test(rawPage)) badRequest('页码必须是非负整数');
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page > 10_000) badRequest('页码超出允许范围');
  return { view, domain, category, search, page };
}

function sanitizeDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) badRequest('日期必须使用 YYYY-MM-DD 格式');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) badRequest('日期不是有效日历日期');
  return value;
}

// 导出请求：kind 决定取数路径，format 决定序列化方式，两者都必须是白名单值。
// feed 类导出复用 parseFeedQuery，因此筛选条件的校验口径与信息流完全一致。
function parseExportQuery(query, categories) {
  const kind = query.get('kind') || 'daily';
  if (!EXPORT_KINDS.has(kind)) badRequest('不支持的导出类型');
  const format = query.get('format') || 'markdown';
  if (!EXPORT_FORMATS.has(format)) badRequest('不支持的导出格式');
  if (kind === 'daily') return { kind, format, date: sanitizeDate(query.get('date')) };
  return { kind, format, feed: parseFeedQuery(query, categories) };
}

function sanitizeStarInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) badRequest('星标请求体必须是对象');
  if (typeof input.starred !== 'boolean') badRequest('星标状态必须是布尔值');
  return { starred: input.starred };
}

function sanitizeFeedback(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) badRequest('反馈请求体必须是对象');
  const kind = input.kind ?? 'feedback';
  if (kind !== 'feedback' && kind !== 'source_report') badRequest('不支持的反馈类型');
  const content = boundedString(input.content, '反馈内容', { min: 1, max: 2000 });
  return { kind, content };
}

module.exports = {
  parseFeedQuery,
  parseExportQuery,
  sanitizeDate,
  sanitizeFeedback,
  sanitizeSourceInput,
  sanitizeStarInput
};
