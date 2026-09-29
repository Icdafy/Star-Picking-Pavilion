'use strict';
// 调度：采集与分析解耦成两个独立循环，让评分「实时跟上」
//   · 采集循环：每 intervalMinutes 分钟 collectAll 入库（默认 10 分钟）
//   · 分析循环：每 analyzeIntervalSeconds 秒轮询：判断与写作 → 事件归组 → 门槛重判 → 热点榜
//   · 定时：每小时热度快照；每天 08:00 日报；每周一 10:00 周报；每月 1 日 10:30 月报（学 AIHOT 的刊期）
//   · runPipeline：手动「立即采集分析」一次性全量（采集→抽干分析→归组），供 /api/collect 与脚本用
// 模型只在这里的任务里被调用；读者打开页面只读库里已有的结果。
const cron = require('node-cron');
const { collectAll } = require('./collectors');
const { analyzePending, rescoreAfterClustering } = require('./ai/pipeline');
const { groupPending, digestStories } = require('./ai/stories');
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
let lastRun = null;        // 最近一次采集摘要
let lastAnalyzeAt = null;  // 最近一次分析循环时间
let lastPrune = null;      // 最近一次数据保留清理摘要
let lastCompact = null;    // 最近一次数据库深度压缩摘要
let lastGroup = null;      // 最近一次事件归组摘要
let lastHotAt = 0;         // 最近一次热点榜计算时间
let lastEditorialAt = 0;   // 最近一次导语改写与事件综述
let schedulerStarted = false;
let collectTimer = null;
let analyzeTimer = null;
let startupTimer = null;
let pruneTimer = null;
const cronTasks = new Set();

// ---------- 数据保留清理 ----------
// 单轮有删除上限，剩余部分继续清，避免首次在大库上一次性长时间持锁
function pruneOnce(trigger = 'cron') {
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
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
async function collectOnce(trigger = 'cron', { force = false } = {}) {
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
  if (collectRunning) return { skipped: true, reason: '采集进行中' };
  collectRunning = true;
  const started = Date.now();
  try {
    console.log(`[collect] 开始（${trigger}）`);
    const { results, skipped } = await collectAll(p =>
      p.error ? console.log(`  ✗ ${p.source}: ${p.error}`)
              : (p.added ? console.log(`  ✓ ${p.source}: 新增 ${p.added}`) : null), { force });
    const added = results.reduce((s, r) => s + (r.added || 0), 0);
    lastRun = {
      at: new Date().toISOString(), trigger, ms: Date.now() - started,
      collected: added, errors: results.filter(r => r.error).length,
      backoffSkipped: skipped
    };
    console.log(`[collect] 完成：新增 ${added} 条，退避跳过 ${skipped} 个源，耗时 ${Math.round(lastRun.ms / 1000)}s`);
    return lastRun;
  } finally {
    collectRunning = false;
  }
}

// ---------- 分析一批（实时循环调用）----------
async function analyzeOnce(trigger = 'loop', limit = 60) {
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
  if (analyzeRunning) return { skipped: true };
  analyzeRunning = true;
  try {
    const r = await analyzePending(null, limit);
    lastAnalyzeAt = new Date().toISOString();
    const settings = loadSettings();
    // 归组：新判完的资料挂到事件上（或开新事件），热度信号随之写入
    const group = await groupPending({ settings });
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
    if (settings.ai.apiKey && !r.budgetPaused && Date.now() - lastEditorialAt > 15 * 60e3) {
      lastEditorialAt = Date.now();
      await digestStories({ settings }).catch(e => console.warn('[stories]', e.message));
      await enhanceLeads({ settings }).catch(e => console.warn('[reports]', e.message));
    }
    return { ...r, group };
  } finally {
    analyzeRunning = false;
  }
}

// ---------- 手动全量：采集 → 抽干分析 → 聚类（立即采集分析按钮）----------
async function runPipeline(trigger = 'manual') {
  if (compactRunning) return { skipped: true, reason: 'maintenance' };
  await collectOnce(trigger, { force: trigger === 'manual' });
  let total = 0;
  // 抽干：反复分析直到没有 analyzed=0（每批 200）
  for (let pass = 0; pass < 12; pass++) {
    const r = await analyzeOnce(trigger, 200);
    if (r.skipped) break;
    total += r.analyzed || 0;
    if (!r.analyzed) break;
  }
  await groupPending({ settings: loadSettings(), limit: 1000 });
  const rescore = rescoreAfterClustering();
  computeHotRanking();
  lastHotAt = Date.now();
  console.log(`[pipeline] 手动全量完成：分析 ${total} 条，门槛重判 ${rescore.changed} 条`);
  return { ...lastRun, analyzed: total, rescored: rescore.changed };
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const settings = loadSettings();
  const intervalMs = collectionIntervalMs(settings.collect.intervalMinutes);
  const interval = intervalMs / 60_000;
  const analyzeSec = Math.max(20, settings.collect.analyzeIntervalSeconds || 75);

  // 采集循环（setInterval 保证 60 分钟以上及非整除分钟的间隔仍准确）
  collectTimer = setInterval(() => collectOnce('timer').catch(e => console.error('[collect]', e)), intervalMs);
  // 分析循环（秒级，setInterval 自调度；锁防重入）
  analyzeTimer = setInterval(() => analyzeOnce('loop').catch(e => console.error('[analyze]', e)), analyzeSec * 1000);
  // 日报（每天定点纯代码生成）
  cronTasks.add(cron.schedule(`0 ${settings.dailyReportHour ?? 8} * * *`, () => {
    try { generateDaily(); console.log('[daily] 日报已生成'); }
    catch (e) { console.error('[daily]', e); }
  }));
  // 每小时第 5 分钟：事件热度快照（热点走势图）
  cronTasks.add(cron.schedule('5 * * * *', () => {
    try { snapshotHeat(); } catch (e) { console.error('[hot]', e); }
  }));
  // 周报：每周一 10:00 出上周；月报：每月 1 日 10:30 出上月
  cronTasks.add(cron.schedule('0 10 * * 1', () => {
    try { generatePeriod('weekly', previousPeriodKey('weekly'), { overwrite: true }); console.log('[report] 周报已生成'); }
    catch (e) { console.error('[report]', e); }
  }));
  cronTasks.add(cron.schedule('30 10 1 * *', () => {
    try { generatePeriod('monthly', previousPeriodKey('monthly'), { overwrite: true }); console.log('[report] 月报已生成'); }
    catch (e) { console.error('[report]', e); }
  }));
  // 保留清理（日报之后 25 分钟，避开采集与日报的忙时）
  cronTasks.add(cron.schedule(`25 ${settings.dailyReportHour ?? 8} * * *`, () => {
    try {
      pruneReceipts();
      const result = pruneOnce('cron');
      if (!result.skipped) compactOnce('cron', { mode: 'auto' });
    } catch (e) { console.error('[retention]', e); }
  }));
  // 启动后先跑一轮全量
  startupTimer = setTimeout(() => runPipeline('startup').catch(e => console.error('[pipeline]', e)), 2500);
  // 启动清理放在首轮采集分析之后，避免和冷启动争 IO
  pruneTimer = setTimeout(() => {
    try {
      const result = pruneOnce('startup');
      if (!result.skipped) compactOnce('startup', { mode: 'auto' });
    } catch (e) { console.error('[retention]', e); }
  }, 90_000);
  console.log(`[scheduler] 已启动：每 ${interval} 分钟采集，每 ${analyzeSec} 秒分析一批，每天 ${settings.dailyReportHour ?? 8}:00 出日报、${settings.dailyReportHour ?? 8}:25 清理过期数据`);
}

function stopScheduler() {
  if (!schedulerStarted) return;
  schedulerStarted = false;
  if (collectTimer) clearInterval(collectTimer);
  if (analyzeTimer) clearInterval(analyzeTimer);
  if (startupTimer) clearTimeout(startupTimer);
  if (pruneTimer) clearTimeout(pruneTimer);
  collectTimer = null;
  analyzeTimer = null;
  startupTimer = null;
  pruneTimer = null;
  for (const task of cronTasks) {
    task.stop?.();
    task.destroy?.();
  }
  cronTasks.clear();
  console.log('[scheduler] 已停止');
}

async function waitForSchedulerIdle() {
  while (collectRunning || analyzeRunning || pruneRunning || compactRunning) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

module.exports = {
  startScheduler, stopScheduler, waitForSchedulerIdle,
  runPipeline, collectOnce, analyzeOnce, pruneOnce, compactOnce,
  getStatus: () => ({
    running: collectRunning || analyzeRunning || pruneRunning || compactRunning,
    schedulerStarted,
    collectRunning,
    analyzeRunning,
    pruneRunning,
    compactRunning,
    lastRun,
    lastAnalyzeAt,
    lastPrune,
    lastCompact,
    lastGroup
  })
};
