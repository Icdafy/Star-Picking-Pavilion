'use strict';

const crypto = require('node:crypto');

const API_TOKEN_HEADER = 'x-star-picking-pavilion-token';
const MAX_JSON_BYTES = 64 * 1024;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http: https:",
  "font-src 'self'",
  "connect-src 'self'"
].join('; ');
const RESPONSE_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
});

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function constantTimeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function authorize(request, policy) {
  const port = Number(policy?.port);
  if (!Number.isInteger(port) || port <= 0) return false;
  const expectedHost = `127.0.0.1:${port}`;
  if (String(request?.host || '').toLowerCase() !== expectedHost) return false;

  const expectedToken = String(policy?.expectedToken || '');
  if (expectedToken) return constantTimeEqual(request?.token, expectedToken);

  if (!request?.origin) return true;
  try {
    return new URL(request.origin).origin === `http://${expectedHost}`;
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    req.resume();
    throw new HttpError(415, '请求体必须使用 application/json');
  }

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    req.resume();
    throw new HttpError(413, `请求体不得超过 ${MAX_JSON_BYTES} 字节`);
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new HttpError(413, `请求体不得超过 ${MAX_JSON_BYTES} 字节`);

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, '请求体不是有效的 JSON');
  }
}

function validateAiBaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

module.exports = {
  API_TOKEN_HEADER,
  MAX_JSON_BYTES,
  CONTENT_SECURITY_POLICY,
  RESPONSE_SECURITY_HEADERS,
  HttpError,
  authorize,
  readJsonBody,
  validateAiBaseUrl
};
