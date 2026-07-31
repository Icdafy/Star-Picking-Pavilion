'use strict';

const { fetch: undiciFetch } = require('undici');
const { readBoundedBody } = require('../server/collectors/fetch-util');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

function positiveInteger(value, fallback, label) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return resolved;
}

function createDailyArchiveBundleRequester(serverPort, apiToken, {
  fetchImpl = undiciFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65_535) {
    throw new TypeError('serverPort must be a valid TCP port');
  }
  if (typeof apiToken !== 'string' || !apiToken) {
    throw new TypeError('apiToken must be a non-empty string');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is unavailable');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('timer functions are required');
  }
  const requestTimeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const responseLimit = positiveInteger(
    maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    'maxResponseBytes'
  );

  return async date => {
    const url = `http://127.0.0.1:${serverPort}/api/daily/archive?date=${encodeURIComponent(date)}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          'x-star-picking-pavilion-token': apiToken
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`新闻简报服务返回 HTTP ${response.status}`);
      }
      const body = await readBoundedBody(response, responseLimit);
      try {
        return JSON.parse(body.toString('utf8'));
      } catch (error) {
        throw new Error('新闻简报服务返回了无效 JSON', { cause: error });
      }
    } catch (error) {
      if (timedOut || error?.name === 'AbortError') {
        throw new Error(`新闻简报请求超时（${requestTimeoutMs} 毫秒）`, { cause: error });
      }
      throw error;
    } finally {
      clearTimer(timer);
    }
  };
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  createDailyArchiveBundleRequester
};
