'use strict';
// 回执与预算熔断 —— 学 AIHOT 的 providers/receipts.ts：
//   · 花钱的请求有回执：任务名 + 提示词版本 + 模型 + 输入的哈希作键，拿到结果先存再用。
//     进程重启、失败重试、手动重跑时，已付过钱的结果直接复用，不重复花钱。
//   · 预算熔断：每小时、每天的调用上限（config/industry/selection.json 的 budget），
//     超过就抛 BudgetExceededError，资料保持待分析，下一个窗口继续，不写任何终态。
// 回执只存模型的原始 JSON 结论，不存 Key、不存请求头；保留 30 天后随清理删除。
const crypto = require('node:crypto');
const { db, now, withTransaction } = require('../db');
const { loadSelection } = require('../industry');

class BudgetExceededError extends Error {
  constructor(scope, limit) {
    super(`模型调用预算已用尽（${scope === 'hour' ? '本小时' : '今日'}上限 ${limit} 次），暂停到下一个窗口`);
    this.name = 'BudgetExceededError';
    this.budgetExceeded = true;
    this.scope = scope;
  }
}

function receiptKey(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(String(part ?? '')).update('\u0000');
  return hash.digest('hex');
}

function buckets(nowMs = Date.now()) {
  const iso = new Date(nowMs).toISOString();
  return { hour: `h:${iso.slice(0, 13)}`, day: `d:${iso.slice(0, 10)}` };
}

const readUsage = db.prepare('SELECT calls FROM model_usage WHERE bucket = ?');
const bumpUsage = db.prepare(`INSERT INTO model_usage (bucket, calls) VALUES (?, 1)
  ON CONFLICT(bucket) DO UPDATE SET calls = calls + 1`);

// 先占额度再发请求：并发的三个评分 worker 同时打过来，也不会一起越过上限
function reserveCall(nowMs = Date.now(), budget = loadSelection().budget) {
  const { hour, day } = buckets(nowMs);
  return withTransaction(() => {
    const hourCalls = readUsage.get(hour)?.calls || 0;
    if (hourCalls >= budget.maxCallsPerHour) throw new BudgetExceededError('hour', budget.maxCallsPerHour);
    const dayCalls = readUsage.get(day)?.calls || 0;
    if (dayCalls >= budget.maxCallsPerDay) throw new BudgetExceededError('day', budget.maxCallsPerDay);
    bumpUsage.run(hour);
    bumpUsage.run(day);
  });
}

const readReceipt = db.prepare('SELECT response_json FROM model_receipts WHERE receipt_key = ?');
const writeReceipt = db.prepare(`INSERT INTO model_receipts (receipt_key, task, response_json, created_at)
  VALUES (?, ?, ?, ?) ON CONFLICT(receipt_key) DO UPDATE SET response_json = excluded.response_json, created_at = excluded.created_at`);
const inFlight = new Map();

// call() 返回已解析、已校验的对象。只有校验通过的结果才落回执——
// 半截 JSON 存下来会让之后每一次重试都拿到同一份坏结果。
async function withReceipt({ task, keyParts, call, validate = value => value != null }) {
  const key = receiptKey([task, ...keyParts]);
  const hit = readReceipt.get(key);
  if (hit) {
    try {
      const cached = JSON.parse(hit.response_json);
      if (validate(cached)) return { value: cached, cached: true };
    } catch {}
  }
  if (inFlight.has(key)) {
    const result = await inFlight.get(key);
    return { ...result, shared: true };
  }
  const operation = (async () => {
    reserveCall();
    const value = await call();
    if (validate(value)) writeReceipt.run(key, task, JSON.stringify(value), now());
    return { value, cached: false };
  })();
  inFlight.set(key, operation);
  try { return await operation; }
  finally { inFlight.delete(key); }
}

function usageSnapshot(nowMs = Date.now()) {
  const { hour, day } = buckets(nowMs);
  const budget = loadSelection().budget;
  return {
    hourCalls: readUsage.get(hour)?.calls || 0,
    dayCalls: readUsage.get(day)?.calls || 0,
    maxCallsPerHour: budget.maxCallsPerHour,
    maxCallsPerDay: budget.maxCallsPerDay,
    receipts: db.prepare('SELECT COUNT(*) c FROM model_receipts').get().c
  };
}

function pruneReceipts(days = 30) {
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  const removed = db.prepare('DELETE FROM model_receipts WHERE created_at < ?').run(cutoff).changes;
  const dayCutoff = `d:${new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10)}`;
  const hourCutoff = `h:${new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 13)}`;
  db.prepare("DELETE FROM model_usage WHERE (bucket LIKE 'd:%' AND bucket < ?) OR (bucket LIKE 'h:%' AND bucket < ?)")
    .run(dayCutoff, hourCutoff);
  return removed;
}

module.exports = { BudgetExceededError, receiptKey, reserveCall, withReceipt, usageSnapshot, pruneReceipts, buckets };
