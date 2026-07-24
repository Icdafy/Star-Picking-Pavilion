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
  onUnexpectedExit = () => {}
} = {}) {
  if (!child || typeof child.on !== 'function') throw new TypeError('需要可监听的服务进程');

  let phase = 'running';
  let shutdownPromise = null;
  let resolveShutdown = null;
  let shutdownTimer = null;
  let forced = false;
  let exitReported = false;

  const finishShutdown = result => {
    if (!resolveShutdown) return;
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = null;
    const resolve = resolveShutdown;
    resolveShutdown = null;
    phase = 'stopped';
    resolve(result);
  };

  child.on('message', message => {
    if (message?.type === 'server:stopped' && phase === 'stopping') {
      finishShutdown({ forced: false });
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
  });

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    if (phase === 'stopped') return Promise.resolve({ forced: false, alreadyStopped: true });

    phase = 'stopping';
    shutdownPromise = new Promise(resolve => { resolveShutdown = resolve; });
    child.postMessage({ type: 'server:shutdown' });
    shutdownTimer = setTimeout(() => {
      if (phase !== 'stopping') return;
      forced = true;
      child.kill();
    }, shutdownTimeoutMs);
    return shutdownPromise;
  }

  return Object.freeze({ shutdown, getPhase: () => phase });
}

module.exports = {
  focusExistingWindow,
  showExistingWindow,
  createServerProcessController
};
