'use strict';
// DeepSeek 客户端 —— OpenAI 兼容协议，baseUrl/model 均可在设置中替换为任意兼容服务
// （硅基流动、火山方舟、本地 Ollama 等都遵循同一协议）
const { validateAiBaseUrl } = require('../http-security');
const { readBoundedBody } = require('../collectors/fetch-util');
const { fetch: undiciFetch } = require('undici');

const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;

// M2：429/5xx 与网络错误做指数退避重试；400 对参数类错误（或无法识别的报错）删参重发一次，
// 内容审核拒绝不重发
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

// 各兼容服务（DeepSeek/硅基流动/火山方舟/Ollama…）对不识别参数的常见 400 报错形态
const PARAM_ERROR_400 = /thinking|unknown parameter|unsupported|invalid.{0,24}param|unrecognized|参数/i;
// 内容审核拒绝：服务端因内容主动拒绝，不是请求参数的问题，删参重发只会再撞一次墙
const MODERATION_400 = /moderation|content[ _-]?filter|safety|敏感|违规|审核/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry-After 可能是秒数，也可能是 HTTP 日期；统一换算成毫秒并封顶
function retryAfterMs(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), MAX_RETRY_DELAY_MS));
  return null;
}

async function chat(messages, {
  settings,
  model,
  temperature = 0.2,
  reasoning = false,
  maxTokens = 4000,
  fetchImpl = undiciFetch,
  maxResponseBytes = MAX_AI_RESPONSE_BYTES
}) {
  const { apiKey, baseUrl, requestTimeoutMs } = settings.ai;
  if (!apiKey) throw new Error('NO_API_KEY');
  if (!validateAiBaseUrl(baseUrl)) throw new Error('AI 基础地址必须使用 HTTPS（本机回环地址除外）');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new Error('AI 响应大小上限无效');
  const ctrl = new AbortController();
  const requestedTimeout = Number(requestTimeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(120_000, Math.max(1_000, requestedTimeout))
    : 60_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      thinking: { type: reasoning ? 'enabled' : 'disabled' },
      ...(reasoning ? { reasoning_effort: 'high' } : {})
    };
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const doFetch = () => fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    let attempt = 0;
    let thinkingDropped = false;
    for (;;) {
      // 网络层错误（连不上、被重置等）参与退避重试；总超时触发的 abort 除外——
      // 时间预算是整次调用共享的，重试只会再次撞上同一个截止时间
      let res;
      try {
        res = await doFetch();
      } catch (error) {
        if (ctrl.signal.aborted || attempt >= MAX_RETRIES) throw error;
        attempt += 1;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      if (res.status === 400) {
        const raw400 = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
        // 审核拒绝优先于参数匹配：即使文案碰巧含相似字样也不得重发
        if (!PARAM_ERROR_400.test(raw400) && MODERATION_400.test(raw400)) {
          throw new Error(`DeepSeek HTTP 400: ${raw400.slice(0, 200)}`);
        }
        if (payload.thinking && !thinkingDropped) {
          // 命中参数类错误形态 → 删参重发；两类都不命中 → 同样保留一次无条件删参重发
          // （thinkingDropped 守卫至多一次）：第三方兼容服务的报错文案可能完全不含
          // thinking 字样，兼容兜底确保它们永不静默退化为启发式
          thinkingDropped = true;
          delete payload.thinking;
          delete payload.reasoning_effort;
          continue;
        }
        throw new Error(`DeepSeek HTTP 400: ${raw400.slice(0, 200)}`);
      }
      if (RETRYABLE_STATUS.has(res.status)) {
        const waitMs = retryAfterMs(res.headers && res.headers.get ? res.headers.get('retry-after') : null);
        let bodyText = '';
        try { bodyText = (await readBoundedBody(res, maxResponseBytes)).toString('utf8'); } catch {}
        if (attempt >= MAX_RETRIES) {
          throw new Error(`DeepSeek HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
        }
        attempt += 1;
        await sleep(waitMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      const raw = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
      if (!res.ok) {
        throw new Error(`DeepSeek HTTP ${res.status}: ${raw.slice(0, 200)}`);
      }
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('模型服务返回了无效 JSON'); }
      const choice = data.choices?.[0] || {};
      const msg = choice.message || {};
      if (msg.content) return msg.content;
      // L6：只有在输出被 token 上限截断（finish_reason=length）时才从思考内容里兜底取 JSON；
      // 其余空响应返回空串，由上层按解析失败降级，避免拿半成品思考链冒充最终答案
      if (choice.finish_reason === 'length' && msg.reasoning_content) return msg.reasoning_content;
      return '';
    }
  } finally {
    clearTimeout(timer);
  }
}

// 括号配平的线性扫描：从 start 处的 {/[ 出发，计数嵌套深度并跳过字符串字面量与转义字符，
// 找到第一个配平终点。相比逐位回溯尝试 parse 的 O(n²) 退化，这里只走一遍且只 parse 一次
function balancedJsonEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 扫描路径的输入上限：超长输出（模型抽风复读）不值得再花 CPU 去配平
const EXTRACT_SCAN_LIMIT = 64 * 1024;

// 宽容地从模型输出中抠出 JSON
function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const trimmed = text.trim();
  if (trimmed !== text) { try { return JSON.parse(trimmed); } catch {} }
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  if (text.length > EXTRACT_SCAN_LIMIT) return null;
  const start = text.search(/[{[]/);
  if (start >= 0) {
    const end = balancedJsonEnd(text, start);
    if (end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

async function testConnection(settings) {
  const out = await chat(
    [{ role: 'user', content: '请只回复 JSON：{"ok":true}' }],
    { settings, model: settings.ai.model, maxTokens: 100 }
  );
  const j = extractJson(out);
  if (!j || j.ok !== true) throw new Error('响应异常: ' + String(out).slice(0, 100));
  return true;
}

module.exports = { MAX_AI_RESPONSE_BYTES, chat, extractJson, testConnection };
