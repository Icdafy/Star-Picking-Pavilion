'use strict';
// 调度：默认在线待命。手动或明确开启的自动任务统一运行采集→分析，任务外不调用模型。
//   · 自动循环：每轮完整结束后等待 intervalMinutes 分钟，默认关闭
//   · 定时：每小时热度快照；每天 08:00 日报；每周一 10:00 周报；每月 1 日 10:30 月报（学 AIHOT 的刊期）
//   · runPipeline：手动「立即采集分析」一次性全量（采集→抽干分析→归组），供 /api/collect 与脚本用
// 模型只在这里的任务里被调用；读者打开页面只读库里已有的结果。
const cron = require('node-cron');
const { collectAll } = require('./collectors');
const { analyzePending, rescoreAfterClustering } = require('./ai/pipeline');
const { groupPending, digestStories, consolidateStories } = require('./ai/stories');
const { computeHotRanking, snapshotHeat } = require('./ai/hot');
const { generateDaily } = require('./ai/daily');
const { generatePeriod, previousPeriodKey, enhanceLeads } = require('./ai/reports');
const { pruneReceipts } = require('./ai/receipts');
const { pruneDatabase } = require('./retention');
const { loadSettings } = require('./config');
const { collectionIntervalMs } = require('./schedule-policy');
const { db, DATABASE_PATH } = require('./db');
const { compactDatabase } = require('./database-maintenance');

let collectRunning = false;
let analyzeRunning = false;
let pruneRunning = false;
let compactRunning = false;
let pipelinePromise = null;
let pipelineRunning = false;
let schedulerStopping = false;
let lastPipeline = null;
let activeSchedule = null;
let lastRun = null;        // 最近一次采集摘要
let lastAnalyzeAt = null;  // 最近一次分析循环时间
let lastPrune = null;      // 最近一次数据保留清理摘要
let lastCompact = null;    // 最近一次数据库深度压缩摘要
let lastGroup = null;      // 最近一次事件归组摘要
let lastHotAt = 0;         // 最近一次热点榜计算时间
let lastEditorialAt = 0;   // 最近一次导语改写与事件综述
let schedulerStarted = false;
let collectTimer = null;
let nextCollectAt = null;
const cronTasks = new Set();
const statusListeners = new Set();
let statusRevision = 0;

function getStatus() {
  return {
    revision: statusRevision,
    activity: collectRunning || analyzeRunning || pipelineRunning ? 'collecting' : 'online',
    running: collectRunning || analyzeRunning || pruneRunning || compactRunning || pipelineRunning,
    schedulerStarted, schedulerStopping, pipelineRunning, activeSchedule, nextCollectAt, lastPipeline,
    collectRunning, analyzeRunning, pruneRunning, compactRunning,
    lastRun, lastAnalyzeAt, lastPrune, lastCompact, lastGroup
  };
}

function notifyStatus() {
  statusRevision += 1;
  const status = getStatus();
  for (const listener of statusListeners) {
    try { listener(status); } catch { /* 已关闭的状态连接不能中断任务 */ }
  }
}

function subscribeStatus(listener) {
  statusListeners.add(listener);
  listener(getStatus());
  return () => statusListeners.delete(listener);
}

// ---------- 数据保留清理 ----------
// 单轮有删除上限，剩余部分继续清，避免首次在大库上一次性长时间持锁
function pruneOnce(trigger = 'cron') {
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
  if (collectRunning || analyzeRunning || pipelineRunning) return { skipped: true, reason: 'busy' };
  if (pruneRunning) return { skipped: true, reason: '清理进行中' };
  pruneRunning = true;
  try {
    const settings = loadSettings();
    let totalArticles = 0;
    let totalReports = 0;
    let result;
    for (let pass = 0; pass < 20; pass++) {
      result = pruneDatabase({ settings });
      totalArticles += result.removedArticles;
      totalReports += result.removedReports;
      if (!result.hasMore) break;
    }
    lastPrune = {
      at: new Date().toISOString(), trigger,
      removedArticles: totalArticles, removedReports: totalReports,
      retentionDays: result.retentionDays, irrelevantRetentionDays: result.irrelevantRetentionDays
    };
    if (totalArticles || totalReports) {
      console.log(`[retention] 清理完成：文章 ${totalArticles} 条、日报 ${totalReports} 份`);
    }
    return lastPrune;
  } finally {
    pruneRunning = false;
  }
}

// ---------- 数据库深度压缩 ----------
function compactOnce(trigger = 'manual', { mode = trigger === 'manual' ? 'manual' : 'auto' } = {}) {
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  if (pipelineRunning) return { skipped: true, reason: 'busy' };
  if (collectRunning || analyzeRunning || pruneRunning || compactRunning) {
    return { skipped: true, reason: 'busy' };
  }
  compactRunning = true;
  try {
    const result = compactDatabase({
      database: db,
      databasePath: DATABASE_PATH,
      mode
    });
    lastCompact = {
      at: new Date().toISOString(),
      trigger,
      mode,
      ...result
    };
    if (!result.skipped) {
      console.log(`[maintenance] 数据库压缩完成：释放 ${result.reclaimedBytes} 字节`);
    }
    return lastCompact;
  } finally {
    compactRunning = false;
  }
}

// ---------- 采集一次 ----------
// force：手动触发时忽略失败退避，把暂停中的信源也重试一遍
async function collectOnce(trigger = 'cron', { force = false, pipeline = false } = {}) {
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  if (pipelineRunning && !pipeline) return { skipped: true, reason: 'pipeline' };
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
  if (collectRunning) return { skipped: true, reason: '采集进行中' };
  cancelCollectionTimer();
  collectRunning = true;
  notifyStatus();
  const started = Date.now();
  try {
    console.log(`[collect] 开始（${trigger}）`);
    const { results, skippedBackoff, skippedNetwork, network, publicationRepair } = await collectAll(p =>
      p.error ? console.log(`  ✗ ${p.source}: ${p.error}`)
              : (p.added ? console.log(`  ✓ ${p.source}: 新增 ${p.added}`) : null), { force });
    const added = results.reduce((s, r) => s + (r.added || 0), 0);
    lastRun = {
      at: new Date().toISOString(), trigger, ms: Date.now() - started,
      collected: added, errors: results.filter(r => r.error).length,
      backoffSkipped: skippedBackoff, networkSkipped: skippedNetwork, network, publicationRepair
    };
    if (publicationRepair?.repaired) {
      computeHotRanking();
      lastHotAt = Date.now();
    }
    console.log(`[collect] 完成：新增 ${added} 条，退避跳过 ${skippedBackoff} 个源，等待外网 ${skippedNetwork} 个源，耗时 ${Math.round(lastRun.ms / 1000)}s`);
    return lastRun;
  } finally {
    collectRunning = false;
    notifyStatus();
    if (!pipelineRunning) scheduleNextCollection();
  }
}

// ---------- 分析一批（实时循环调用）----------
async function analyzeOnce(trigger = 'loop', limit = 60, { pipeline = false } = {}) {
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  if (pipelineRunning && !pipeline) return { skipped: true, reason: 'pipeline' };
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
  if (analyzeRunning) return { skipped: true };
  analyzeRunning = true;
  notifyStatus();
  try {
    const r = await analyzePending(null, limit);
    lastAnalyzeAt = new Date().toISOString();
    if (schedulerStopping) return r;
    const settings = loadSettings();
    // 归组：新判完的资料挂到事件上（或开新事件），热度信号随之写入
    const group = await groupPending({ settings });
    if (schedulerStopping) return { ...r, group };
    // 事件级合并：同一批次各自开出的同一事件在这里并成一条（有新归组时才跑）
    if (group.processed > 0) {
      const consolidated = await consolidateStories({ settings }).catch(e => { console.warn('[stories]', e.message); return { merged: 0 }; });
      group.consolidated = consolidated.merged;
    }
    lastGroup = { at: lastAnalyzeAt, ...group };
    if (r.analyzed > 0 || group.processed > 0) {
      const rescore = rescoreAfterClustering();
      console.log(`[analyze] (${trigger}) 判断 ${r.analyzed} 条（${r.mode}），入选 ${r.featured ?? 0}，`
        + `归组 ${group.processed}（新事件 ${group.created}、归入 ${group.attached}、模型判定 ${group.judged}），`
        + `门槛重判 ${rescore.changed}/${rescore.rescored}`);
    }
    if (group.processed > 0 || Date.now() - lastHotAt > 10 * 60e3) {
      computeHotRanking();
      lastHotAt = Date.now();
    }
    // 花钱的编辑工作（事件综述、导语改写）节流到每 15 分钟一次
    if (!schedulerStopping && settings.ai.apiKey && !r.budgetPaused && Date.now() - lastEditorialAt > 15 * 60e3) {
      lastEditorialAt = Date.now();
      await digestStories({ settings }).catch(e => console.warn('[stories]', e.message));
      if (!schedulerStopping) await enhanceLeads({ settings }).catch(e => console.warn('[reports]', e.message));
    }
    return { ...r, group };
  } finally {
    analyzeRunning = false;
    notifyStatus();
  }
}

// ---------- 手动全量：采集 → 抽干分析 → 聚类（立即采集分析按钮）----------
function runPipeline(trigger = 'manual') {
  if (schedulerStopping) return Promise.resolve({ skipped: true, reason: 'stopping' });
  if (pipelinePromise) return pipelinePromise;
  if (compactRunning) return Promise.resolve({ skipped: true, reason: 'maintenance' });
  // 一轮任务接管自动计时，避免刚完成又被旧计时器触发。
  cancelCollectionTimer();
  pipelineRunning = true;
  notifyStatus();
  const started = Date.now();
  pipelinePromise = (async () => {
    try {
      // 等当前小批次结束；整轮持锁后，定时器不会抢入下一批。
      while (collectRunning || analyzeRunning || pruneRunning) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const result = await executePipeline(trigger);
      lastPipeline = { at: new Date().toISOString(), trigger, ms: Date.now() - started, ok: !result.skipped, ...result };
      return result;
    } catch (error) {
      lastPipeline = { at: new Date().toISOString(), trigger, ms: Date.now() - started, ok: false };
      throw error;
    } finally {
      pipelineRunning = false;
      pipelinePromise = null;
      scheduleNextCollection();
      notifyStatus();
    }
  })();
  return pipelinePromise;
}

async function executePipeline(trigger) {
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  await collectOnce(trigger, { force: trigger === 'manual', pipeline: true });
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  let total = 0;
  // 抽干：反复分析直到没有 analyzed=0（每批 200）
  for (let pass = 0; pass < 12; pass++) {
    const r = await analyzeOnce(trigger, 200, { pipeline: true });
    if (schedulerStopping) return { skipped: true, reason: 'stopping' };
    if (r.skipped) break;
    total += r.analyzed || 0;
    if (!r.analyzed) break;
  }
  await groupPending({ settings: loadSettings(), limit: 1000 });
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  await consolidateStories({ settings: loadSettings() }).catch(e => console.warn('[stories]', e.message));
  if (schedulerStopping) return { skipped: true, reason: 'stopping' };
  const rescore = rescoreAfterClustering();
  computeHotRanking();
  lastHotAt = Date.now();
  console.log(`[pipeline] 手动全量完成：分析 ${total} 条，门槛重判 ${rescore.changed} 条`);
  return { ...lastRun, analyzed: total, rescored: rescore.changed };
}

function cancelCollectionTimer() {
  if (collectTimer) clearTimeout(collectTimer);
  collectTimer = null;
  nextCollectAt = null;
}

function scheduleNextCollection() {
  cancelCollectionTimer();
  if (!schedulerStarted || schedulerStopping || collectRunning || pipelineRunning) return;
  const intervalMs = activeSchedule?.enabled && activeSchedule.collectionIntervalMs;
  if (!intervalMs) return;
  nextCollectAt = new Date(Date.now() + intervalMs).toISOString();
  collectTimer = setTimeout(async () => {
    collectTimer = null;
    nextCollectAt = null;
    if (!activeSchedule?.enabled || schedulerStopping) return;
    try { await runPipeline('timer'); }
    catch (error) { console.error('[collect]', error); }
    finally { if (!collectTimer) scheduleNextCollection(); }
  }, intervalMs);
}

function refreshSchedulerSettings() {
  if (!schedulerStarted || schedulerStopping) return false;
  const settings = loadSettings();
  const enabled = settings.collect.automatic === true;
  const intervalMs = collectionIntervalMs(settings.collect.intervalMinutes);
  const analyzeMs = Math.max(20, settings.collect.analyzeIntervalSeconds || 75) * 1000;
  if (activeSchedule?.enabled === enabled && activeSchedule?.collectionIntervalMs === intervalMs
    && activeSchedule?.analysisIntervalMs === analyzeMs) return false;
  const collectionChanged = activeSchedule?.enabled !== enabled || activeSchedule?.collectionIntervalMs !== intervalMs;
  activeSchedule = { enabled, collectionIntervalMs: intervalMs, analysisIntervalMs: analyzeMs };
  for (const task of cronTasks) enabled ? task.start?.() : task.stop?.();
  if (collectionChanged) scheduleNextCollection();
  notifyStatus();
  return true;
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerStopping = false;
  const settings = loadSettings();
  const intervalMs = collectionIntervalMs(settings.collect.intervalMinutes);
  const interval = intervalMs / 60_000;
  // 日报（每天定点纯代码生成）
  cronTasks.add(cron.schedule(`0 ${settings.dailyReportHour ?? 8} * * *`, () => {
    if (!activeSchedule?.enabled || schedulerStopping) return;
    try { generateDaily(); console.log('[daily] 日报已生成'); }
    catch (e) { console.error('[daily]', e); }
  }));
  // 每小时第 5 分钟：事件热度快照（热点走势图）
  cronTasks.add(cron.schedule('5 * * * *', () => {
    if (!activeSchedule?.enabled || schedulerStopping) return;
    try { snapshotHeat(); } catch (e) { console.error('[hot]', e); }
  }));
  // 周报：每周一 10:00 出上周；月报：每月 1 日 10:30 出上月
  cronTasks.add(cron.schedule('0 10 * * 1', () => {
    if (!activeSchedule?.enabled || schedulerStopping) return;
    try { generatePeriod('weekly', previousPeriodKey('weekly'), { overwrite: true }); console.log('[report] 周报已生成'); }
    catch (e) { console.error('[report]', e); }
  }));
  cronTasks.add(cron.schedule('30 10 1 * *', () => {
    if (!activeSchedule?.enabled || schedulerStopping) return;
    try { generatePeriod('monthly', previousPeriodKey('monthly'), { overwrite: true }); console.log('[report] 月报已生成'); }
    catch (e) { console.error('[report]', e); }
  }));
  // 保留清理（日报之后 25 分钟，避开采集与日报的忙时）
  cronTasks.add(cron.schedule(`25 ${settings.dailyReportHour ?? 8} * * *`, () => {
    if (!activeSchedule?.enabled || schedulerStopping) return;
    try {
      pruneReceipts();
      const result = pruneOnce('cron');
      if (!result.skipped) compactOnce('cron', { mode: 'auto' });
    } catch (e) { console.error('[retention]', e); }
  }));
  refreshSchedulerSettings();
  console.log(settings.collect.automatic
    ? `[scheduler] 自动调度：每轮完成后等待 ${interval} 分钟；每天 ${settings.dailyReportHour ?? 8}:00 出日报`
    : '[scheduler] 在线待命：自动调度关闭，无启动采集或独立分析轮询');
}

function stopScheduler() {
  schedulerStopping = true;
  schedulerStarted = false;
  cancelCollectionTimer();
  collectTimer = null;
  activeSchedule = null;
  for (const task of cronTasks) {
    task.stop?.();
    task.destroy?.();
  }
  cronTasks.clear();
  notifyStatus();
  console.log('[scheduler] 已停止');
}

async function waitForSchedulerIdle() {
  while (collectRunning || analyzeRunning || pruneRunning || compactRunning || pipelineRunning) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

module.exports = {
  startScheduler, stopScheduler, waitForSchedulerIdle,
  refreshSchedulerSettings,
  runPipeline, collectOnce, analyzeOnce, pruneOnce, compactOnce,
  getStatus, subscribeStatus
};
