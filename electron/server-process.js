'use strict';

function showExistingWindow(window) {
  if (!window || window.isDestroyed?.()) return false;
  if (window.isMinimized?.()) window.restore();
  if (window.isVisible && !window.isVisible()) window.show();
  window.focus();
  return true;
}

const focusExistingWindow = showExistingWindow;

function createServerProcessController(child, {
  shutdownTimeoutMs = 5_000,
  exitTimeoutMs = 1_000,
  onUnexpectedExit = () => {}
} = {}) {
  if (!child || typeof child.on !== 'function') throw new TypeError('需要可监听的服务进程');

  let phase = 'running';
  let shutdownPromise = null;
  let resolveShutdown = null;
  let rejectShutdown = null;
  let shutdownTimer = null;
  let exitTimer = null;
  let forced = false;
  let exitReported = false;

  const clearShutdownTimers = () => {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    if (exitTimer) clearTimeout(exitTimer);
    shutdownTimer = null;
    exitTimer = null;
  };

  const finishShutdown = result => {
    if (!resolveShutdown) return;
    clearShutdownTimers();
    const resolve = resolveShutdown;
    resolveShutdown = null;
    rejectShutdown = null;
    phase = 'stopped';
    resolve(result);
  };

  const failShutdown = (message, cause) => {
    if (!rejectShutdown) return;
    clearShutdownTimers();
    const reject = rejectShutdown;
    resolveShutdown = null;
    rejectShutdown = null;
    shutdownPromise = null;
    phase = 'failed';
    const error = new Error(message, cause ? { cause } : undefined);
    error.code = 'server-shutdown-failed';
    reject(error);
  };

  const forceShutdown = cause => {
    if (phase !== 'stopping') return;
    clearShutdownTimers();
    forced = true;
    // kill() 只表示终止请求已发送。必须等实际退出或安全关闭确认，超时也不能假报成功。
    // 先登记计时器，兼容 kill() 同步触发 exit 的进程适配器。
    exitTimer = setTimeout(() => failShutdown('后端进程未在终止请求后退出，无法确认安全关闭。', cause), exitTimeoutMs);
    try {
      if (child.kill() === false) failShutdown('无法终止后端进程，无法确认安全关闭。', cause);
    } catch (error) {
      failShutdown('终止后端进程失败，无法确认安全关闭。', error);
    }
  };

  child.on('message', message => {
    if (message?.type === 'server:stopped' && phase === 'stopping') {
      finishShutdown({ forced });
    }
  });

  child.on('exit', (code, signal) => {
    if (phase === 'running' && !exitReported) {
      exitReported = true;
      phase = 'stopped';
      onUnexpectedExit({ code, signal });
      return;
    }
    if (phase === 'stopping') finishShutdown({ forced, code, signal });
    else if (phase === 'failed') phase = 'stopped';
  });

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    if (phase === 'stopped') return Promise.resolve({ forced: false, alreadyStopped: true });

    phase = 'stopping';
    forced = false;
    shutdownPromise = new Promise((resolve, reject) => { resolveShutdown = resolve; rejectShutdown = reject; });
    const pending = shutdownPromise;
    shutdownTimer = setTimeout(() => forceShutdown(), shutdownTimeoutMs);
    try { child.postMessage({ type: 'server:shutdown' }); }
    catch (error) { forceShutdown(error); }
    return pending;
  }

  return Object.freeze({ shutdown, getPhase: () => phase });
}

module.exports = {
  focusExistingWindow,
  showExistingWindow,
  createServerProcessController
};
