'use strict';
// 模型客户端 —— 以 OpenAI Chat Completions 为主协议（DeepSeek、Kimi、智谱、百炼、火山方舟、
// 硅基流动、OpenRouter、本机 Ollama 等都遵循它），另支持 Anthropic Messages 协议。
// 端点、协议与模型由设置页「模型」一节决定，这里只按 settings.ai 的派生字段发请求。
const { validateAiBaseUrl } = require('../http-security');
const { readBoundedBody } = require('../collectors/fetch-util');
const { fetch: undiciFetch } = require('undici');
const { setTimeout: delay } = require('node:timers/promises');

const { VISION_MODEL } = require('./model-policy');
const { KEYLESS_PLACEHOLDER } = require('./model-catalog');

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;

// M2：429/5xx 与网络错误做指数退避重试；400 对参数类错误（或无法识别的报错）删参重发一次，
// 内容审核拒绝不重发
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

// 内容审核拒绝：服务端因内容主动拒绝，不是请求参数的问题，删参重发只会再撞一次墙
const MODERATION_400 = /moderation|content[ _-]?filter|safety|敏感|违规|审核/i;

function sleep(ms, signal) {
  return delay(ms, undefined, { signal });
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
  const label = settings.ai.providerName || 'DeepSeek';
  const modelId = typeof model === 'string' && model.trim() ? model.trim() : (settings.ai.model || VISION_MODEL);
  if (settings.ai.api === 'anthropic-messages') {
    return anthropicChat(messages, {
      settings, model: modelId, temperature, maxTokens, fetchImpl, maxResponseBytes, label
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), requestTimeout(requestTimeoutMs));
  try {
    // thinking / reasoning_effort 是 DeepSeek 的扩展参数：只发给 DeepSeek（或未标注提供商的
    // 旧调用方）；其它兼容服务不认识它，发过去只会换来一次 400 与重发。
    const sendsThinking = !settings.ai.activeProvider || settings.ai.activeProvider === 'deepseek';
    const payload = {
      model: modelId,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...(sendsThinking ? { thinking: { type: reasoning ? 'enabled' : 'disabled' } } : {}),
      ...(sendsThinking && reasoning ? { reasoning_effort: 'high' } : {})
    };
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json', ...bearer(apiKey) };
    const doFetch = () => fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'error',
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
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1), ctrl.signal);
        continue;
      }
      if (res.status === 400) {
        const raw400 = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
        // 审核拒绝优先于参数匹配：即使文案碰巧含相似字样也不得重发
        if (MODERATION_400.test(raw400)) {
          throw new Error(`${label} HTTP 400: ${raw400.slice(0, 200)}`);
        }
        if ((payload.thinking || payload.response_format) && !thinkingDropped) {
          // 命中参数类错误形态 → 删参重发；两类都不命中 → 同样保留一次无条件删参重发
          // （thinkingDropped 守卫至多一次）：第三方兼容服务的报错文案可能完全不含
          // thinking 字样，兼容兜底确保它们永不静默退化为启发式
          thinkingDropped = true;
          delete payload.thinking;
          delete payload.reasoning_effort;
          // 少数兼容服务不支持 JSON 模式；提示词本身要求 JSON，extractJson 能宽容解析
          delete payload.response_format;
          continue;
        }
        throw new Error(`${label} HTTP 400: ${raw400.slice(0, 200)}`);
      }
      if (RETRYABLE_STATUS.has(res.status)) {
        const waitMs = retryAfterMs(res.headers && res.headers.get ? res.headers.get('retry-after') : null);
        let bodyText = '';
        try { bodyText = (await readBoundedBody(res, maxResponseBytes)).toString('utf8'); } catch {}
        if (attempt >= MAX_RETRIES) {
          throw new Error(`${label} HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
        }
        attempt += 1;
        await sleep(waitMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1), ctrl.signal);
        continue;
      }
      const raw = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
      if (!res.ok) {
        throw new Error(`${label} HTTP ${res.status}: ${raw.slice(0, 200)}`);
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

function requestTimeout(value) {
  const requested = Number(value);
  return Number.isFinite(requested) ? Math.min(120_000, Math.max(1_000, requested)) : 60_000;
}

// 本机无密钥端点（Ollama 等）不发 Authorization 头
function bearer(apiKey) {
  return apiKey && apiKey !== KEYLESS_PLACEHOLDER ? { Authorization: `Bearer ${apiKey}` } : {};
}

function anthropicHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    ...(apiKey && apiKey !== KEYLESS_PLACEHOLDER ? { 'x-api-key': apiKey } : {})
  };
}

// Anthropic 端点既可能写成 https://api.anthropic.com，也可能已经带了 /v1
function anthropicUrl(baseUrl, suffix) {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/.test(base) ? `${base}/${suffix}` : `${base}/v1/${suffix}`;
}

// OpenAI 形态的消息 → Anthropic Messages：system 单列，图片块改写为 image source
function toAnthropicMessages(messages) {
  const system = [];
  const converted = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
      continue;
    }
    const blocks = Array.isArray(message.content)
      ? message.content.map(block => {
        if (block?.type === 'image_url') {
          const url = String(block.image_url?.url || '');
          const data = url.match(/^data:([^;]+);base64,(.+)$/);
          return data
            ? { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } }
            : { type: 'image', source: { type: 'url', url } };
        }
        return { type: 'text', text: String(block?.text ?? '') };
      })
      : String(message.content ?? '');
    converted.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: blocks });
  }
  return { system: system.join('\n\n'), messages: converted };
}

async function anthropicChat(messages, { settings, model, temperature, maxTokens, fetchImpl, maxResponseBytes, label }) {
  const { apiKey, baseUrl, requestTimeoutMs } = settings.ai;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), requestTimeout(requestTimeoutMs));
  try {
    const { system, messages: converted } = toAnthropicMessages(messages);
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: converted
    });
    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await fetchImpl(anthropicUrl(baseUrl, 'messages'), {
          method: 'POST', headers: anthropicHeaders(apiKey), body, redirect: 'error', signal: ctrl.signal
        });
      } catch (error) {
        if (ctrl.signal.aborted || attempt >= MAX_RETRIES) throw error;
        attempt += 1;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1), ctrl.signal);
        continue;
      }
      const raw = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
      if ((RETRYABLE_STATUS.has(res.status) || res.status === 529) && attempt < MAX_RETRIES) {
        const waitMs = retryAfterMs(res.headers?.get ? res.headers.get('retry-after') : null);
        attempt += 1;
        await sleep(waitMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1), ctrl.signal);
        continue;
      }
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${raw.slice(0, 200)}`);
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('模型服务返回了无效 JSON'); }
      return (Array.isArray(data.content) ? data.content : [])
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('');
    }
  } finally {
    clearTimeout(timer);
  }
}

function positiveCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100_000_000 ? number : undefined;
}

// 向端点询问可用模型（OpenAI 形态 GET /models；Anthropic 形态 GET /v1/models）。
// 只采信端点自己报告的字段：id 必有，名称、上下文窗口、输出上限、输入模态有则带上。
async function discoverModels({ baseUrl, api = 'openai-completions', apiKey = '', fetchImpl = undiciFetch,
  timeoutMs = 20_000, maxResponseBytes = MAX_AI_RESPONSE_BYTES } = {}) {
  if (!validateAiBaseUrl(baseUrl)) throw new Error('API 地址必须使用 HTTPS（本机回环地址除外）');
  const anthropic = api === 'anthropic-messages';
  const url = anthropic
    ? `${anthropicUrl(baseUrl, 'models')}?limit=1000`
    : `${baseUrl.replace(/\/+$/, '')}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), requestTimeout(timeoutMs));
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: anthropic ? anthropicHeaders(apiKey) : { Accept: 'application/json', ...bearer(apiKey) },
      redirect: 'error',
      signal: ctrl.signal
    });
    const raw = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
    if (res.status === 401 || res.status === 403) throw new Error(`端点拒绝了这把 API 密钥（HTTP ${res.status}）`);
    if (res.status === 404) throw new Error('该端点没有提供模型列表接口，请手动添加模型');
    if (!res.ok) throw new Error(`获取模型列表失败（HTTP ${res.status}）：${raw.slice(0, 160)}`);
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('端点返回的模型列表不是有效 JSON'); }
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    const seen = new Set();
    const models = [];
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : typeof row?.name === 'string' ? row.name.trim() : '';
      if (!id || id.length > 200 || seen.has(id)) continue;
      seen.add(id);
      const model = { id };
      const name = typeof row.display_name === 'string' ? row.display_name
        : typeof row.name === 'string' && row.name !== id ? row.name : '';
      if (name.trim()) model.name = name.trim().slice(0, 200);
      const contextWindow = positiveCount(row.context_length ?? row.context_window ?? row.max_context_length);
      if (contextWindow) model.contextWindow = contextWindow;
      const maxTokens = positiveCount(row.top_provider?.max_completion_tokens ?? row.max_output_tokens ?? row.max_tokens);
      if (maxTokens) model.maxTokens = maxTokens;
      const modalities = row.architecture?.input_modalities ?? row.input_modalities;
      if (Array.isArray(modalities)) {
        model.input = ['text', ...(modalities.includes('image') ? ['image'] : [])];
      }
      models.push(model);
    }
    return models.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('询问端点超时，请检查 API 地址或网络');
    throw error;
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

module.exports = { MAX_AI_RESPONSE_BYTES, chat, discoverModels, extractJson, testConnection, toAnthropicMessages };
