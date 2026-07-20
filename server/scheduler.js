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
const { loadSettings } = require('./config');

let collectRunning = false;
let analyzeRunning = false;
let lastRun = null;        // 最近一次采集摘要
let lastAnalyzeAt = null;  // 最近一次分析循环时间
let schedulerStarted = false;
let analyzeTimer = null;
let startupTimer = null;
const cronTasks = new Set();

// ---------- 采集一次 ----------
async function collectOnce(trigger = 'cron') {
  if (collectRunning) return { skipped: true, reason: '采集进行中' };
  collectRunning = true;
  const started = Date.now();
  try {
    console.log(`[collect] 开始（${trigger}）`);
    const collected = await collectAll(p =>
      p.error ? console.log(`  ✗ ${p.source}: ${p.error}`)
              : (p.added ? console.log(`  ✓ ${p.source}: 新增 ${p.added}`) : null));
    const added = collected.reduce((s, r) => s + (r.added || 0), 0);
    lastRun = {
      at: new Date().toISOString(), trigger, ms: Date.now() - started,
      collected: added, errors: collected.filter(r => r.error).length
    };
    console.log(`[collect] 完成：新增 ${added} 条，耗时 ${Math.round(lastRun.ms / 1000)}s`);
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
  await collectOnce(trigger);
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
  const interval = Math.max(5, settings.collect.intervalMinutes || 10);
  const analyzeSec = Math.max(20, settings.collect.analyzeIntervalSeconds || 75);

  // 采集循环（分钟级）
  cronTasks.add(cron.schedule(`*/${interval} * * * *`, () => collectOnce('cron').catch(e => console.error('[collect]', e))));
  // 分析循环（秒级，setInterval 自调度；锁防重入）
  analyzeTimer = setInterval(() => analyzeOnce('loop').catch(e => console.error('[analyze]', e)), analyzeSec * 1000);
  // 日报（每天定点纯代码生成）
  cronTasks.add(cron.schedule(`5 ${settings.dailyReportHour || 8} * * *`, () => {
    try { generateDaily(); console.log('[daily] 日报已生成'); }
    catch (e) { console.error('[daily]', e); }
  }));
  // 启动后先跑一轮全量
  startupTimer = setTimeout(() => runPipeline('startup').catch(e => console.error('[pipeline]', e)), 2500);
  console.log(`[scheduler] 已启动：每 ${interval} 分钟采集，每 ${analyzeSec} 秒分析一批，每天 ${settings.dailyReportHour || 8}:05 出日报`);
}

function stopScheduler() {
  if (!schedulerStarted) return;
  schedulerStarted = false;
  if (analyzeTimer) clearInterval(analyzeTimer);
  if (startupTimer) clearTimeout(startupTimer);
  analyzeTimer = null;
  startupTimer = null;
  for (const task of cronTasks) {
    task.stop?.();
    task.destroy?.();
  }
  cronTasks.clear();
  console.log('[scheduler] 已停止');
}

async function waitForSchedulerIdle() {
  while (collectRunning || analyzeRunning) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

module.exports = {
  startScheduler, stopScheduler, waitForSchedulerIdle, runPipeline, collectOnce, analyzeOnce,
  getStatus: () => ({
    running: collectRunning || analyzeRunning,
    schedulerStarted,
    collectRunning,
    analyzeRunning,
    lastRun,
    lastAnalyzeAt
  })
};
