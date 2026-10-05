'use strict';
// AIHOT external 入口的本机适配：显式创建并启用信源后才能导入。
// 只接受原始事实；评分、相关性、公司、融资均由既有管线判断，客户端不能直接写精选结论。
const { db, insertArticle, now } = require('./db');
const { HttpError } = require('./http-security');
const { structureItem, stripMarkup, decodeEntities } = require('./ai/normalize');
const { loadSelection } = require('./industry');

function fail(message) { throw new HttpError(400, message); }
function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label}格式或长度无效`);
  return value.trim();
}

function sanitizeItem(item, source, at) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('每个条目须为对象');
  const title = text(item.title, '标题', 300, true);
  const address = text(item.url, '原文地址', 2048, true);
  let url;
  try { url = new URL(address); } catch { fail('原文地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('原文须为无内嵌凭据的 HTTP(S) 地址');
  let publishedAt = null;
  if (item.publishedAt != null && item.publishedAt !== '') {
    const date = text(item.publishedAt, '发布时间', 40, true);
    const time = Date.parse(date);
    // 带时区的 ISO 时间；拒绝 2 月 30 日等会被 Date 自动归一的非法日期。
    const calendar = date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(date)
      || !Number.isFinite(time) || time > at + 300000
      || new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) fail('发布时间须为有效且不晚于当前时间的 ISO 时间（含时区）');
    publishedAt = new Date(time).toISOString();
  }
  if (item.backfill != null && typeof item.backfill !== 'boolean') fail('backfill 必须是布尔值');
  const upstreamBackfill = item.raw?._aihot?.backfill;
  if (upstreamBackfill != null && typeof upstreamBackfill !== 'boolean') fail('raw._aihot.backfill 必须是布尔值');
  const structured = structureItem({ title, url: url.href, publishedAt,
    summary: text(item.summary, '摘要', 4000),
    contentText: stripMarkup(decodeEntities(text(item.contentText, '正文', 12000))).trim()
  }, { sourceName: source.name, domain: source.domain === 'both' ? null : source.domain });
  if (!structured) fail('清洗后标题或原文地址为空');
  const importedBackfill = Boolean(item.backfill || upstreamBackfill);
  return { sourceId: source.id, ...structured, importedBackfill,
    historical: importedBackfill || (publishedAt && at - Date.parse(publishedAt) > loadSelection().historicalHours * 3600000) };
}

// 本机单用户服务的全局限流；不按调用者自报的 sourceId 分桶，以免换源绕过。
let windowStart = 0, requests = 0;
function ingestItems(body, at = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求体必须是对象');
  if (!Number.isSafeInteger(body.sourceId) || body.sourceId <= 0) fail('sourceId 须为已创建信源的数字编号');
  const source = db.prepare('SELECT * FROM sources WHERE id = ? AND removed_at IS NULL').get(body.sourceId);
  if (!source) throw new HttpError(404, '信源不存在，请先在信源页创建外部导入源');
  if (source.type !== 'external') throw new HttpError(409, '只能向外部导入信源提交内容');
  if (!source.enabled) throw new HttpError(409, '该信源已停用，请启用后再导入');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) fail('每次须提交 1–50 条内容');
  // 完整校验在写入之前，避免第 50 条格式错误时前 49 条已写入。
  const items = body.items.map(item => sanitizeItem(item, source, at));
  if (at - windowStart >= 60000) { windowStart = at; requests = 0; }
  if (requests >= 10) throw new HttpError(429, '外部导入每分钟最多 10 次，请稍后重试');
  requests++;
  let created = 0;
  for (const item of items) if (insertArticle(item)) created++;
  db.prepare(`UPDATE sources SET last_fetch_at=?, last_status='ok', fetch_count=fetch_count+1,
    item_count=item_count+?, consecutive_errors=0, next_fetch_at=NULL WHERE id=?`).run(now(), created, source.id);
  return { ok: true, received: items.length, created, duplicates: items.length - created };
}

module.exports = { ingestItems };
