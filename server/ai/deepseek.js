'use strict';
// DeepSeek 客户端 —— OpenAI 兼容协议，baseUrl/model 均可在设置中替换为任意兼容服务
// （硅基流动、火山方舟、本地 Ollama 等都遵循同一协议）
const { validateAiBaseUrl } = require('../http-security');
const { readBoundedBody } = require('../collectors/fetch-util');

const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;

async function chat(messages, {
  settings,
  model,
  temperature = 0.2,
  maxTokens = 4000,
  fetchImpl = fetch,
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
      // DeepSeek V4 系列默认开启思考模式，会把 token 花在 reasoning_content 上；
      // 本系统的任务（预筛/五维打分）不需要长思考，显式关闭以省钱提速
      thinking: { type: 'disabled' }
    };
    let res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (res.status === 400) {
      await readBoundedBody(res, maxResponseBytes);
      // 兼容不认识 thinking 参数的 OpenAI 兼容服务（硅基流动、Ollama 等）
      delete payload.thinking;
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
    }
    const raw = (await readBoundedBody(res, maxResponseBytes)).toString('utf8');
    if (!res.ok) {
      throw new Error(`DeepSeek HTTP ${res.status}: ${raw.slice(0, 200)}`);
    }
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('模型服务返回了无效 JSON'); }
    const msg = data.choices?.[0]?.message || {};
    // content 为空但有思考内容时（推理模型截断等），从思考内容里兜底取 JSON
    return msg.content || msg.reasoning_content || '';
  } finally {
    clearTimeout(timer);
  }
}

// 宽容地从模型输出中抠出 JSON
function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  const start = text.search(/[{[]/);
  if (start >= 0) {
    for (let end = text.length; end > start; end--) {
      try { return JSON.parse(text.slice(start, end)); } catch {}
    }
  }
  return null;
}

async function testConnection(settings) {
  const out = await chat(
    [{ role: 'user', content: '请只回复 JSON：{"ok":true}' }],
    { settings, model: settings.ai.prefilterModel, maxTokens: 100 }
  );
  const j = extractJson(out);
  if (!j || j.ok !== true) throw new Error('响应异常: ' + String(out).slice(0, 100));
  return true;
}

module.exports = { MAX_AI_RESPONSE_BYTES, chat, extractJson, testConnection };
