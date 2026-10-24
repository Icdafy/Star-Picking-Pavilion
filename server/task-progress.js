'use strict';

// A task-local observer keeps request telemetry out of prompts, credentials and persisted news.
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
let sequence = 0;
const LABELS = Object.freeze({ waiting: '等待当前任务', collecting: '信源采集', analyzing: '文章分析',
  translation: '海外翻译', prefilter: '行业预筛', content: '补抓正文', vision: '图片分析', cleaning: '文本清洗',
  'image-download': '配图下载', 'report-leads': '刊期导语',
  scoring: '双次独立评分', understanding: '内容理解', grouping: '事件归组',
  consolidating: '事件合并', editorial: '事件综述', leads: '导语完善',
  'timing-repair': '事件时间修补', 'publication-repair': '发布时间核验', 'network-check': '海外网络探测',
  maintenance: '历史资料维护', ranking: '门槛重判与热度', request: '模型请求' });
const clean = (value, max = 160) => String(value ?? '')
  .replace(/[\r\n\u0000-\u001f]/g, ' ')
  .replace(/https?:\/\/\S+/gi, '[地址已隐藏]')
  .replace(/\b(?:sk[-_]|gh[pousr]_)[a-z0-9_-]+/gi, '[密钥已隐藏]')
  .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0, max);
const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
const TERMINAL = new Set(['completed', 'failed', 'skipped', 'paused', 'stopped']);
const NUMERIC_FIELDS = ['sourcesCompleted', 'sourcesTotal', 'collected', 'analyzed', 'featured', 'batches', 'remaining', 'batchDone', 'batchTotal'];
function publicPatch(event) {
  const patch = {};
  for (const key of NUMERIC_FIELDS) if (count(event[key]) != null) patch[key] = count(event[key]);
  for (const key of ['phase', 'startedAt', 'message']) if (typeof event[key] === 'string') patch[key] = clean(event[key], key === 'message' ? 240 : 48);
  return patch;
}

function runWithProgress(observer, operation) { return context.run(observer, operation); }
function beginTask(spec = {}) {
  const observer = context.getStore();
  const taskId = `request:${++sequence}`;
  const send = patch => { try { observer?.({ ...spec, taskId, ...patch }); } catch { /* telemetry cannot fail work */ } };
  send({ status: 'running' });
  return { update: patch => send(patch), end: status => send({ status: status || 'completed' }) };
}

function createProgressTracker(initial = {}, { now = Date.now } = {}) {
  const started = now();
  let data = publicPatch(initial);
  let currentStage = null;
  let stoppedAt = null;
  const stages = new Map();
  const tasks = new Map();
  const warnings = new Set();
  const hasTasks = stage => [...tasks.values()].some(task => task.stage === stage && !task.taskOnly);
  const open = (row, at) => { if (row.activeSince == null) row.activeSince = at; row.status = 'running'; };
  const close = (row, at, status = 'completed') => {
    if (row.activeSince != null) row.elapsedMs += Math.max(0, at - row.activeSince);
    row.activeSince = null;
    row.status = row.failure || row.pause || status;
  };
  function focus(stage, at) {
    if (stage !== currentStage) {
      const previous = stages.get(currentStage);
      if (previous && !hasTasks(currentStage) && previous.status === 'running'
        && !(previous.total > 0 && previous.done < previous.total)) close(previous, at);
      currentStage = stage;
    }
  }
  function update(event = {}) {
    // All branches are drained by the scheduler; a late observer still cannot rewrite a finished receipt.
    if (stoppedAt != null) return;
    const at = now();
    const stage = clean(event.stage || event.analysisStage || '', 48);
    const terminalTask = TERMINAL.has(event.status);
    if (event.warning) {
      warnings.add(clean(event.warning));
      if (warnings.size > 32) warnings.delete(warnings.values().next().value);
    }
    if (event.taskId) {
      const id = clean(event.taskId, 100);
      if (terminalTask) tasks.delete(id);
      else {
        const prior = tasks.get(id);
        const current = typeof event.current === 'object' ? event.current?.title : event.current;
        tasks.set(id, { ...prior, id, stage: stage || prior?.stage,
          taskOnly: Boolean(event.taskOnly ?? prior?.taskOnly),
          label: clean(event.label || LABELS[stage] || prior?.label || '处理中'),
          current: current == null ? prior?.current || '' : clean(current, 100),
          started: prior?.started ?? at, status: event.status || prior?.status || 'running',
          attempt: count(event.attempt) ?? prior?.attempt,
          retryAt: count(event.retryInMs) != null ? at + count(event.retryInMs) : event.status === 'running' ? null : prior?.retryAt });
      }
    }
    if (stage && !event.taskOnly) {
      if (!stages.has(stage)) stages.set(stage, { stage, label: LABELS[stage] || clean(event.label || stage),
        done: null, total: null, elapsedMs: 0, activeSince: null, status: 'running', batchId: null });
      const row = stages.get(stage);
      // A new analysis batch can begin with individual requests before its first aggregate update.
      // Discard the previous batch denominator immediately, while retaining cumulative stage time.
      const batchId = count(event.batchId);
      if (batchId != null && batchId !== row.batchId) {
        row.batchId = batchId;
        row.done = null;
        row.total = null;
      }
      // Per-request 1/1 describes one task, never the whole batch or whole run.
      const aggregate = !event.taskId || stage === 'collecting';
      if (aggregate && count(event.done) != null) row.done = count(event.done);
      if (aggregate && count(event.total) != null) row.total = count(event.total);
      if (event.status === 'failed') row.failure = 'failed';
      if (event.status === 'paused') row.pause = 'paused';
      if (!event.taskId || !terminalTask) focus(stage, at);
      if (!terminalTask || hasTasks(stage) || (event.taskId && aggregate && row.done < row.total)) open(row, at);
      else close(row, at, event.status);
      // A terminal task cannot hide work that is still running in another parallel stage.
      if (event.taskId && terminalTask && stage === currentStage && !hasTasks(stage)) {
        const active = [...tasks.values()].filter(task => !task.taskOnly).at(-1);
        if (active) focus(active.stage, at);
      }
    }
    data = { ...data, ...publicPatch(event), updatedAt: new Date(at).toISOString() };
    if (['completed', 'paused', 'failed', 'stopped'].includes(event.phase)) {
      stoppedAt = at;
      for (const row of stages.values()) if (row.activeSince != null) close(row, at,
        event.phase === 'completed' ? 'completed' : event.phase === 'failed' ? 'failed' : event.phase);
      tasks.clear();
    }
  }
  function snapshot() {
    const at = stoppedAt ?? now();
    const elapsed = row => row ? row.elapsedMs + (row.activeSince == null ? 0 : Math.max(0, at - row.activeSince)) : 0;
    const current = stages.get(currentStage);
    return { ...data, analysisStage: currentStage, stageLabel: current?.label,
      stageDone: current?.done ?? null, stageTotal: current?.total ?? null,
      elapsedMs: Math.max(0, at - started), stageElapsedMs: elapsed(current),
      stages: [...stages.values()].map(({ activeSince, failure, pause, batchId, ...row }) => ({ ...row,
        elapsedMs: elapsed(stages.get(row.stage)) })),
      activeTaskCount: tasks.size,
      activeTasks: [...tasks.values()].sort((a, b) => Number(b.status === 'retrying') - Number(a.status === 'retrying'))
        .slice(0, 16).map(({ started, retryAt, taskOnly, ...task }) => ({ ...task,
        elapsedMs: Math.max(0, at - started), retryInMs: retryAt == null ? null : Math.max(0, retryAt - at) })),
      warnings: [...warnings].slice(-16) };
  }
  return { update, snapshot };
}

module.exports = { LABELS, runWithProgress, beginTask, createProgressTracker };
