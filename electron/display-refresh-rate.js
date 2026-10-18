'use strict';

// Read the display containing most of this window, rather than the primary
// monitor. Only the ID and refresh rate cross the sandbox boundary.
function readDisplayRefreshRate({ screen, window } = {}) {
  try {
    if (!window || window.isDestroyed()) return { displayId: '', refreshRate: null };
    const display = screen.getDisplayMatching(window.getBounds());
    const rate = display?.displayFrequency;
    return {
      displayId: display?.id == null ? '' : String(display.id),
      refreshRate: typeof rate === 'number' && Number.isFinite(rate) && rate >= 24 && rate <= 1000
        ? rate : null
    };
  } catch { return { displayId: '', refreshRate: null }; }
}

function registerDisplayRefreshRateIpc({ ipcMain, screen, getWindow } = {}) {
  ipcMain.handle('display-refresh-rate:get', () => readDisplayRefreshRate({ screen, window: getWindow() }));
}

function watchDisplayRefreshRate({ screen, window, setTimeout: schedule = setTimeout,
  clearTimeout: cancel = clearTimeout, setInterval: repeat = setInterval, clearInterval: stop = clearInterval } = {}) {
  let disposed = false, timer = null, previous = '';
  const listeners = [];
  function publish() {
    if (disposed || window.isDestroyed() || window.webContents.isDestroyed()) return;
    const snapshot = readDisplayRefreshRate({ screen, window });
    const signature = JSON.stringify(snapshot);
    if (previous === signature) return;
    previous = signature;
    window.webContents.send('display-refresh-rate:changed', snapshot);
  }
  function soon() {
    if (disposed) return;
    if (timer != null) cancel(timer);
    timer = schedule(() => { timer = null; publish(); }, 80);
  }
  function listen(target, event, handler) {
    target.on(event, handler);
    listeners.push(() => target.removeListener(event, handler));
  }
  for (const event of ['move', 'resize', 'show', 'restore', 'focus']) listen(window, event, soon);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) listen(screen, event, soon);
  // Some drivers do not emit metrics changes for a refresh-only setting change.
  // A cheap foreground native read also covers that case without a rAF loop.
  const interval = repeat(() => {
    if (!window.isDestroyed() && window.isVisible() && window.isFocused()) publish();
  }, 5000);
  interval?.unref?.();
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer != null) cancel(timer);
    stop(interval);
    listeners.splice(0).forEach(remove => remove());
  }
  listen(window, 'closed', dispose);
  return Object.freeze({ dispose });
}

module.exports = { readDisplayRefreshRate, registerDisplayRefreshRateIpc, watchDisplayRefreshRate };
