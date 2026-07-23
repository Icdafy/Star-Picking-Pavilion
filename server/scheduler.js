'use strict';
// 调度：采集与分析解耦成两个独立循环，让评分「实时跟上」
//   · 采集循环：每 intervalMinutes 分钟 collectAll 入库（默认 10 分钟）
//   · 分析循环：每 analyzeIntervalSeconds 秒轮询，有 analyzed=0 就持续小批量打分 + 聚类
//   · runPipeline：手动「立即采集分析」一次性全量（采集→抽干分析→聚类），供 /api/collect 与脚本用
const cron = require('node-cron');
const { collectAll } = require('./collectors');
const { analyzePending } = require('./ai/pipeline');
const { clusterRecent } = require('./ai/cluster');
const { generateDaily } = require('./ai/daily');
const { pruneDatabase } = require('./retention');
const { loadSettings } = require('./config');
const { collectionIntervalMs } = require('./schedule-policy');

let collectRunning = false;
let analyzeRunning = false;
let pruneRunning = false;
let lastRun = null;        // 最近一次采集摘要
let lastAnalyzeAt = null;  // 最近一次分析循环时间
let lastPrune = null;      // 最近一次数据保留清理摘要
let schedulerStarted = false;
let collectTimer = null;
let analyzeTimer = null;
let startupTimer = null;
let pruneTimer = null;
const cronTasks = new Set();

// ---------- 数据保留清理 ----------
// 单轮有删除上限，剩余部分继续清，避免首次在大库上一次性长时间持锁
function pruneOnce(trigger = 'cron') {
  if (pruneRunning) return { skipped: true };
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

// ---------- 采集一次 ----------
// force：手动触发时忽略失败退避，把暂停中的信源也重试一遍
async function collectOnce(trigger = 'cron', { force = false } = {}) {
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
  if (analyzeRunning) return { skipped: true };
  analyzeRunning = true;
  try {
    const r = await analyzePending(null, limit);
    lastAnalyzeAt = new Date().toISOString();
    if (r.analyzed > 0) {
      clusterRecent();
      console.log(`[analyze] (${trigger}) 打分 ${r.analyzed} 条（${r.mode}），精选累计 ${r.featured ?? '-'}`);
    }
    return r;
  } finally {
    analyzeRunning = false;
  }
}

// ---------- 手动全量：采集 → 抽干分析 → 聚类（立即采集分析按钮）----------
async function runPipeline(trigger = 'manual') {
  await collectOnce(trigger, { force: trigger === 'manual' });
  let total = 0;
  // 抽干：反复分析直到没有 analyzed=0（每批 200）
  for (let pass = 0; pass < 12; pass++) {
    const r = await analyzeOnce(trigger, 200);
    if (r.skipped) break;
    total += r.analyzed || 0;
    if (!r.analyzed) break;
  }
  clusterRecent();
  console.log(`[pipeline] 手动全量完成：分析 ${total} 条`);
  return { ...lastRun, analyzed: total };
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
  cronTasks.add(cron.schedule(`5 ${settings.dailyReportHour ?? 8} * * *`, () => {
    try { generateDaily(); console.log('[daily] 日报已生成'); }
    catch (e) { console.error('[daily]', e); }
  }));
  // 保留清理（日报之后 20 分钟，避开采集与日报的忙时）
  cronTasks.add(cron.schedule(`25 ${settings.dailyReportHour ?? 8} * * *`, () => {
    try { pruneOnce('cron'); } catch (e) { console.error('[retention]', e); }
  }));
  // 启动后先跑一轮全量
  startupTimer = setTimeout(() => runPipeline('startup').catch(e => console.error('[pipeline]', e)), 2500);
  // 启动清理放在首轮采集分析之后，避免和冷启动争 IO
  pruneTimer = setTimeout(() => {
    try { pruneOnce('startup'); } catch (e) { console.error('[retention]', e); }
  }, 90_000);
  console.log(`[scheduler] 已启动：每 ${interval} 分钟采集，每 ${analyzeSec} 秒分析一批，每天 ${settings.dailyReportHour ?? 8}:05 出日报、${settings.dailyReportHour ?? 8}:25 清理过期数据`);
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
  while (collectRunning || analyzeRunning || pruneRunning) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

module.exports = {
  startScheduler, stopScheduler, waitForSchedulerIdle, runPipeline, collectOnce, analyzeOnce, pruneOnce,
  getStatus: () => ({
    running: collectRunning || analyzeRunning,
    schedulerStarted,
    collectRunning,
    analyzeRunning,
    pruneRunning,
    lastRun,
    lastAnalyzeAt,
    lastPrune
  })
};
