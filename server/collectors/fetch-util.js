'use strict';
// 抓取工具：带 UA / 超时 / 编码识别（GBK 政府网站友好）
const iconv = require('iconv-lite');

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function requireWebUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('采集地址不是有效 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('采集地址必须是无内嵌凭据的 HTTP 或 HTTPS URL');
  }
  return url.href;
}

async function readBoundedBody(response, maxResponseBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    throw new Error(`HTTP 响应过大，不得超过 ${maxResponseBytes} 字节`);
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const rawChunk of response.body) {
    const chunk = Buffer.from(rawChunk);
    total += chunk.length;
    if (total > maxResponseBytes) {
      try { await response.body.cancel?.(); } catch {}
      throw new Error(`HTTP 响应过大，不得超过 ${maxResponseBytes} 字节`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function fetchText(url, settings, options = {}) {
  const target = requireWebUrl(url);
  const fetchImpl = options.fetchImpl || fetch;
  const maxResponseBytes = options.maxResponseBytes || MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error('采集响应大小上限无效');
  }
  const ctrl = new AbortController();
  const requestedTimeout = Number(settings?.collect?.requestTimeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(120_000, Math.max(1_000, requestedTimeout))
    : 20_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(target, {
      headers: {
        'User-Agent': settings.collect.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      redirect: 'follow',
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    requireWebUrl(res.url || target);
    const buf = await readBoundedBody(res, maxResponseBytes);
    return decodeBuffer(buf, res.headers.get('content-type') || '');
  } finally {
    clearTimeout(timer);
  }
}

function decodeBuffer(buf, contentType) {
  let charset = (contentType.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    // 在头部嗅探 <meta charset> / xml encoding
    const head = buf.slice(0, 2048).toString('ascii');
    charset = (head.match(/charset=["']?([\w-]+)/i) || head.match(/encoding=["']([\w-]+)/i) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (charset === 'gb2312' || charset === 'gbk' || charset === 'gb18030') {
    return iconv.decode(buf, 'gb18030');
  }
  return buf.toString('utf8');
}

module.exports = { MAX_RESPONSE_BYTES, fetchText, readBoundedBody };
