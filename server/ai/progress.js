'use strict';

// Progress is an observation only: a renderer/disconnected observer cannot fail paid work.
function reportProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  const current = event.current ? { id: event.current.id,
    title: String(event.current.title || '').slice(0, 100) } : undefined;
  try { onProgress({ ...event, ...(current ? { current } : {}) }); } catch {}
}

async function progressTask(onProgress, spec, operation) {
  reportProgress(onProgress, { ...spec, status: 'running', done: 0, total: 1 });
  try {
    const value = await operation();
    reportProgress(onProgress, { ...spec, status: 'completed', done: 1, total: 1 });
    return value;
  } catch (error) {
    const message = error?.budgetExceeded ? '模型预算已用尽，资料保留待处理' : '本步骤未完成，保留资料等待重试';
    reportProgress(onProgress, { ...spec, status: error?.budgetExceeded ? 'paused' : 'failed',
      done: 0, total: 1, message,
      warning: error?.budgetExceeded ? message : `${spec.message || '分析步骤'}未完成，已有结果保留。` });
    throw error;
  }
}

module.exports = { reportProgress, progressTask };
