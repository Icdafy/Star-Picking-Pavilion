'use strict';
// 新闻推送 · 渠道适配器（v0.2.35）
// 每个渠道只做四件事：校验并规范化连接信息、按官方协议拼请求（含加签）、把返回码翻译成可操作的中文提示、
// 生成可展示的掩码摘要。连接信息（Webhook、密钥、Token、QQ 号）全部经 safeStorage 加密保存，
// 这里拿到的只是内存里的副本，任何返回给界面的字段都必须先经过 describe()。
//
// 协议依据（2026-10 核对）：
//   飞书自定义机器人：POST https://open.feishu.cn/open-apis/bot/v2/hook/<token>；
//     加签 = Base64(HmacSHA256(key = `${秒级时间戳}\n${secret}`, message = ''))，timestamp 与 sign 写进 JSON；
//     成功 code=0；19021 签名/时间不符，19024 关键词不符，19022 IP 白名单，11232 限流；请求体 ≤ 20 KB。
//   钉钉自定义机器人：POST https://oapi.dingtalk.com/robot/send?access_token=<token>；
//     加签 = urlEncode(Base64(HmacSHA256(key = secret, message = `${毫秒时间戳}\n${secret}`)))，拼到查询串；
//     成功 errcode=0；310000 安全设置未通过（关键词 / 签名 / IP），130101 发送过快；每分钟 20 条。
//   QQ：QQ 开放平台已于 2025-04-21 停止机器人主动推送，个人定时推送只能经 OneBot v11 实现
//     （NapCat / Lagrange / LLOneBot 的 HTTP 服务）：POST {base}/send_private_msg 或 /send_group_msg，
//     鉴权头 Authorization: Bearer <access_token>；成功 status=ok 且 retcode=0。
const crypto = require('node:crypto');

const PRODUCT_KEYWORD = '摘星阁';
const MAX_RESPONSE_BYTES = 64 * 1024;

class PushChannelError extends Error {
  constructor(message, { retryable = false, code = null, status = null } = {}) {
    super(message);
    this.name = 'PushChannelError';
    this.retryable = retryable;
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function printable(value, { field, maximum, required = false, pattern = null }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(`${field}不能为空`);
    return '';
  }
  if (typeof value !== 'string') throw invalid(`${field}必须是文本`);
  const text = value.trim();
  if (!text) {
    if (required) throw invalid(`${field}不能为空`);
    return '';
  }
  if (text.length > maximum || /[\s\p{Cc}]/u.test(text) || !/^[\x21-\x7e]+$/.test(text)) {
    throw invalid(`${field}格式错误：只能包含英文字母、数字和符号，且不超过 ${maximum} 个字符`);
  }
  if (pattern && !pattern.test(text)) throw invalid(`${field}格式错误，请从机器人设置页完整复制`);
  return text;
}

function parseUrl(value, field) {
  const text = printable(value, { field, maximum: 2048, required: true });
  try {
    return new URL(text);
  } catch {
    throw invalid(`${field}不是有效的网址，请从机器人设置页完整复制`);
  }
}

function tail(value, size = 4) {
  const text = String(value || '');
  return text.length <= size ? '••••' : `••••${text.slice(-size)}`;
}

function maskDigits(value) {
  const text = String(value || '');
  if (text.length <= 4) return '••••';
  return `${text.slice(0, 2)}${'•'.repeat(Math.min(6, text.length - 4))}${text.slice(-2)}`;
}

function hmacBase64(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('base64');
}

// ---------- 飞书 / Lark ----------
const FEISHU_HOSTS = new Set(['open.feishu.cn', 'open.larksuite.com']);
const FEISHU_PATH = /^\/open-apis\/bot\/v2\/hook\/([A-Za-z0-9_-]{8,128})$/;

const feishu = Object.freeze({
  id: 'feishu',
  name: '飞书机器人',
  shortName: '飞书',
  normalize(input = {}) {
    const url = parseUrl(input.webhook, 'Webhook 地址');
    const match = FEISHU_PATH.exec(url.pathname);
    if (url.protocol !== 'https:' || !FEISHU_HOSTS.has(url.hostname) || url.port || url.username || url.password
      || url.search || url.hash || !match) {
      throw invalid('飞书 Webhook 应形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxx，请在群设置 → 群机器人 → 自定义机器人中复制');
    }
    const secret = printable(input.secret, { field: '加签密钥', maximum: 256 });
    return { webhook: `https://${url.hostname}${url.pathname}`, secret };
  },
  describe(config) {
    const token = FEISHU_PATH.exec(new URL(config.webhook).pathname)?.[1] || '';
    return {
      target: `${new URL(config.webhook).hostname} · hook/${tail(token)}`,
      security: config.secret ? '已启用加签' : '未加签（需设置关键词“摘星阁”或 IP 白名单）'
    };
  },
  buildRequest(message, config, { nowMs = Date.now() } = {}) {
    const body = { ...message.feishu };
    if (config.secret) {
      const timestamp = String(Math.floor(nowMs / 1000));
      body.timestamp = timestamp;
      body.sign = hmacBase64(`${timestamp}\n${config.secret}`, '');
    }
    return { url: config.webhook, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
  },
  interpret(status, payload) {
    const code = Number(payload?.code ?? payload?.StatusCode ?? (status >= 200 && status < 300 ? 0 : NaN));
    if (status >= 200 && status < 300 && code === 0) return;
    const detail = String(payload?.msg || payload?.StatusMessage || '').slice(0, 160);
    const explain = {
      19021: '签名校验失败：请确认“加签”密钥完整，且本机时间准确（误差需在 1 小时内）',
      19022: '请求 IP 不在机器人白名单内：建议把安全设置改为“签名校验”',
      19024: `关键词校验失败：请在机器人安全设置的“自定义关键词”中加入“${PRODUCT_KEYWORD}”，或改用签名校验`,
      19001: 'Webhook 无效或机器人已被移除：请重新复制 Webhook 地址',
      9499: '请求格式被拒绝：消息体可能超过 20 KB，请减少单次推送条数',
      11232: '飞书限流：发送过于频繁，稍后会自动重试'
    }[code];
    const retryable = code === 11232 || status === 429 || status >= 500;
    throw new PushChannelError(explain || `飞书返回错误${Number.isFinite(code) ? ` ${code}` : `（HTTP ${status}）`}${detail ? `：${detail}` : ''}`,
      { retryable, code: Number.isFinite(code) ? code : null, status });
  }
});

// ---------- 钉钉 ----------
const DINGTALK_HOST = 'oapi.dingtalk.com';
const DINGTALK_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

const dingtalk = Object.freeze({
  id: 'dingtalk',
  name: '钉钉机器人',
  shortName: '钉钉',
  normalize(input = {}) {
    const url = parseUrl(input.webhook, 'Webhook 地址');
    const token = url.searchParams.get('access_token') || '';
    const extra = [...url.searchParams.keys()].filter(key => key !== 'access_token');
    if (url.protocol !== 'https:' || url.hostname !== DINGTALK_HOST || url.port || url.username || url.password
      || url.pathname !== '/robot/send' || url.hash || extra.length || !DINGTALK_TOKEN.test(token)) {
      throw invalid('钉钉 Webhook 应形如 https://oapi.dingtalk.com/robot/send?access_token=xxxx，请在群设置 → 机器人 → 自定义机器人中复制');
    }
    const secret = printable(input.secret, { field: '加签密钥', maximum: 256 });
    return { webhook: `https://${DINGTALK_HOST}/robot/send?access_token=${token}`, secret };
  },
  describe(config) {
    const token = new URL(config.webhook).searchParams.get('access_token');
    return {
      target: `${DINGTALK_HOST} · access_token=${tail(token)}`,
      security: config.secret ? '已启用加签' : '未加签（需设置关键词“摘星阁”或 IP 地址段）'
    };
  },
  buildRequest(message, config, { nowMs = Date.now() } = {}) {
    let url = config.webhook;
    if (config.secret) {
      const timestamp = String(Math.floor(nowMs));
      const sign = encodeURIComponent(hmacBase64(config.secret, `${timestamp}\n${config.secret}`));
      url += `&timestamp=${timestamp}&sign=${sign}`;
    }
    return { url, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(message.dingtalk) };
  },
  interpret(status, payload) {
    const code = Number(payload?.errcode ?? (status >= 200 && status < 300 ? 0 : NaN));
    if (status >= 200 && status < 300 && code === 0) return;
    const detail = String(payload?.errmsg || '').slice(0, 160);
    let explain = null;
    if (code === 310000) {
      if (/keyword/i.test(detail)) explain = `关键词校验失败：请在机器人安全设置的“自定义关键词”中加入“${PRODUCT_KEYWORD}”，或改用加签`;
      else if (/sign|timestamp/i.test(detail)) explain = '签名校验失败：请确认“加签”密钥（SEC 开头）完整，且本机时间准确';
      else if (/ip/i.test(detail)) explain = '请求 IP 不在机器人允许的地址段内：建议把安全设置改为“加签”';
      else explain = '钉钉安全设置校验未通过：请检查加签密钥、关键词或 IP 地址段';
    } else if (code === 300001 || code === 400102 || /token/i.test(detail)) {
      explain = 'Webhook 无效或机器人已被移除：请重新复制 Webhook 地址';
    } else if (code === 130101 || code === 410100) {
      explain = '钉钉限流：每个机器人每分钟最多 20 条，稍后会自动重试';
    }
    const retryable = code === 130101 || code === 410100 || status === 429 || status >= 500;
    throw new PushChannelError(explain || `钉钉返回错误${Number.isFinite(code) ? ` ${code}` : `（HTTP ${status}）`}${detail ? `：${detail}` : ''}`,
      { retryable, code: Number.isFinite(code) ? code : null, status });
  }
});

// ---------- QQ（OneBot v11）----------
const QQ_NUMBER = /^[1-9]\d{4,11}$/;
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

const qq = Object.freeze({
  id: 'qq',
  name: 'QQ 机器人',
  shortName: 'QQ',
  normalize(input = {}) {
    const url = parseUrl(input.baseUrl, 'OneBot HTTP 地址');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw invalid('OneBot HTTP 地址应形如 http://127.0.0.1:3000（NapCat / Lagrange / LLOneBot 的 HTTP 服务端地址）');
    }
    if (url.protocol === 'http:' && !PRIVATE_HOST.test(url.hostname)) {
      throw invalid('公网上的 OneBot 服务必须使用 HTTPS；本机或局域网地址可以使用 HTTP');
    }
    const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    const targetType = input.targetType === 'group' ? 'group' : 'private';
    const targetId = printable(String(input.targetId ?? ''), {
      field: targetType === 'group' ? 'QQ 群号' : '接收消息的 QQ 号', maximum: 12, required: true, pattern: QQ_NUMBER
    });
    const accessToken = printable(input.accessToken, { field: 'Access Token', maximum: 512 });
    return { baseUrl, targetType, targetId, accessToken };
  },
  describe(config) {
    return {
      target: `${new URL(config.baseUrl).host} · ${config.targetType === 'group' ? '群' : '私聊'} ${maskDigits(config.targetId)}`,
      security: config.accessToken ? '已设置 Access Token' : '未设置 Access Token（仅建议本机使用）'
    };
  },
  buildRequest(message, config, { part = 0 } = {}) {
    const action = config.targetType === 'group' ? 'send_group_msg' : 'send_private_msg';
    const target = config.targetType === 'group' ? { group_id: Number(config.targetId) } : { user_id: Number(config.targetId) };
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
    const text = message.qq[part] ?? message.qq[0];
    return { url: `${config.baseUrl}/${action}`, headers,
      body: JSON.stringify({ ...target, message: [{ type: 'text', data: { text } }], auto_escape: true }) };
  },
  parts(message) {
    return message.qq.length;
  },
  interpret(status, payload) {
    if (status >= 200 && status < 300 && (payload?.status === 'ok' || payload?.status === 'async') && Number(payload?.retcode ?? 0) === 0) return;
    const detail = String(payload?.wording || payload?.message || payload?.msg || '').slice(0, 160);
    if (status === 401 || status === 403) {
      throw new PushChannelError('OneBot 拒绝访问：Access Token 与 NapCat / Lagrange 中配置的不一致', { status });
    }
    if (status === 404) throw new PushChannelError('OneBot 地址可以连接，但找不到发送接口：请确认填写的是 HTTP 服务端（不是 WebSocket）地址', { status });
    const retryable = status === 429 || status >= 500;
    throw new PushChannelError(`QQ 消息发送失败${payload?.retcode != null ? `（retcode ${payload.retcode}）` : `（HTTP ${status}）`}${detail ? `：${detail}` : '；请确认机器人账号在线，且与接收人互为好友或已在群内'}`,
      { retryable, code: payload?.retcode ?? null, status });
  }
});

const CHANNELS = Object.freeze({ feishu, dingtalk, qq });
const CHANNEL_IDS = Object.freeze(Object.keys(CHANNELS));

function channelById(id) {
  return Object.hasOwn(CHANNELS, id) ? CHANNELS[id] : null;
}

async function readBounded(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); break; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function describeNetworkError(error, channel) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new PushChannelError(`${channel.shortName}请求超时：请检查网络${channel.id === 'qq' ? '，并确认 OneBot 服务正在运行' : ''}`, { retryable: true });
  }
  const code = error?.cause?.code || error?.code || '';
  if (channel.id === 'qq' && /ECONNREFUSED/.test(code)) {
    return new PushChannelError('连接不到 OneBot 服务：请确认 NapCat / Lagrange 已启动，并开启了 HTTP 服务端', { retryable: true });
  }
  return new PushChannelError(`无法连接${channel.shortName}服务${code ? `（${code}）` : ''}：请检查网络或代理设置`, { retryable: true });
}

// 单次投递：不跟随重定向（避免 Webhook 被引到别处），响应体有上限，超时可被外部中止。
async function deliver(channel, config, message, { fetchImpl = globalThis.fetch, signal, timeoutMs = 15_000, nowMs, pauseMs = 700, sleep } = {}) {
  const parts = typeof channel.parts === 'function' ? channel.parts(message) : 1;
  for (let part = 0; part < parts; part++) {
    if (part > 0 && sleep) await sleep(pauseMs);
    const request = channel.buildRequest(message, config, { nowMs: nowMs ?? Date.now(), part });
    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: 'POST', headers: request.headers, body: request.body, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
    } catch (error) {
      if (signal?.aborted) throw new PushChannelError('推送已取消');
      throw describeNetworkError(error, channel);
    }
    const text = await readBounded(response).catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    channel.interpret(response.status, payload);
  }
}

module.exports = {
  CHANNELS, CHANNEL_IDS, PRODUCT_KEYWORD, PushChannelError,
  channelById, deliver, hmacBase64, maskDigits
};
