'use strict';
// 信源健康度与失败退避 —— 采集循环并发有限，长期 404 或超时的源每轮都会占满一个工作位。
// 连续失败按指数拉长下次尝试间隔，成功即刻复位；用户手动「立即采集」始终绕过退避。

const MAX_BACKOFF_MS = 6 * 3600_000;
// 连续失败到达该次数即视为「持续失败」，界面上单独提示用户处理
const UNHEALTHY_AFTER_ERRORS = 5;

function backoffDelayMs(consecutiveErrors, intervalMs) {
  const errors = Number(consecutiveErrors);
  const base = Number(intervalMs);
  if (!Number.isFinite(errors) || errors < 1) return 0;
  if (!Number.isFinite(base) || base <= 0) return 0;
  // 第 1 次失败等一个采集周期，之后逐次翻倍，封顶 6 小时
  const exponent = Math.min(errors - 1, 20);
  return Math.min(MAX_BACKOFF_MS, Math.round(base * 2 ** exponent));
}

function nextFetchAtIso(consecutiveErrors, intervalMs, nowMs = Date.now()) {
  const delay = backoffDelayMs(consecutiveErrors, intervalMs);
  return delay > 0 ? new Date(nowMs + delay).toISOString() : null;
}

function isDue(source, nowMs = Date.now()) {
  if (!source?.next_fetch_at) return true;
  const due = new Date(source.next_fetch_at).getTime();
  return !Number.isFinite(due) || due <= nowMs;
}

function describeHealth(source, nowMs = Date.now()) {
  const errors = Number(source?.consecutive_errors) || 0;
  if (!source?.enabled) return { state: 'disabled', consecutiveErrors: errors, pausedUntil: null };
  const paused = !isDue(source, nowMs);
  return {
    state: errors >= UNHEALTHY_AFTER_ERRORS ? 'failing' : errors > 0 ? 'degraded' : 'ok',
    consecutiveErrors: errors,
    pausedUntil: paused ? source.next_fetch_at : null
  };
}

module.exports = {
  MAX_BACKOFF_MS,
  UNHEALTHY_AFTER_ERRORS,
  backoffDelayMs,
  nextFetchAtIso,
  isDue,
  describeHealth
};
