'use strict';

(function exposeDailyArchiveController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.DailyArchiveController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDailyArchiveModule() {
  const REQUIRED_ELEMENTS = Object.freeze([
    'enabled',
    'rootDirectory',
    'chooseButton',
    'saveButton',
    'retryButton',
    'nextRun',
    'lastSuccess',
    'pending',
    'status'
  ]);
  const REQUIRED_BRIDGE_METHODS = Object.freeze([
    'getDailyArchiveSettings',
    'chooseDailyArchiveDirectory',
    'setDailyArchiveEnabled',
    'saveCurrentDailyArchive',
    'retryDailyArchives'
  ]);
  const STATUS_CLASS = 'test-result daily-archive-live';
  const PUBLIC_ERROR_MESSAGES = Object.freeze([
    '所选位置不是可用的普通文件夹，请重新选择。',
    '所选位置当前不可用或不可写，请检查磁盘后重试。',
    '请先选择每日新闻简报的保存位置。',
    '新闻简报暂时无法生成，请稍后重试。',
    '新闻简报数据校验失败，请稍后重试。',
    '新闻简报保存失败，请检查磁盘空间和目录权限。',
    '补存目录创建失败，请稍后重试。',
    '新闻简报归档操作失败，请稍后重试。',
    '新闻简报归档服务尚未就绪，请稍后重试。'
  ]);
  const DEFAULT_SNAPSHOT = Object.freeze({
    schemaVersion: 1,
    enabled: false,
    rootDirectory: '',
    enabledAt: null,
    lastSuccessfulDate: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    runningDate: null,
    nextRunAt: null,
    pendingDates: Object.freeze([]),
    lastResult: null
  });

  function defaultFormatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '尚未安排';
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function normalizeSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      schemaVersion: 1,
      enabled: source.enabled === true,
      rootDirectory: typeof source.rootDirectory === 'string'
        ? source.rootDirectory
        : '',
      enabledAt: typeof source.enabledAt === 'string' ? source.enabledAt : null,
      lastSuccessfulDate: typeof source.lastSuccessfulDate === 'string'
        ? source.lastSuccessfulDate
        : null,
      lastAttemptAt: typeof source.lastAttemptAt === 'string' ? source.lastAttemptAt : null,
      lastErrorCode: typeof source.lastErrorCode === 'string' ? source.lastErrorCode : null,
      lastErrorAt: typeof source.lastErrorAt === 'string' ? source.lastErrorAt : null,
      runningDate: typeof source.runningDate === 'string' ? source.runningDate : null,
      nextRunAt: typeof source.nextRunAt === 'string' ? source.nextRunAt : null,
      pendingDates: Array.isArray(source.pendingDates)
        ? source.pendingDates.filter(date => typeof date === 'string')
        : [],
      lastResult: source.lastResult && typeof source.lastResult === 'object'
        ? { ...source.lastResult }
        : null
    };
  }

  function publicFailureMessage(error, fallback) {
    const raw = typeof error?.message === 'string' ? error.message : '';
    return PUBLIC_ERROR_MESSAGES.find(message => raw.includes(message)) || fallback;
  }

  function createDailyArchiveController({
    elements,
    bridge,
    formatDateTime = defaultFormatDateTime
  } = {}) {
    if (!elements || typeof elements !== 'object') {
      throw new TypeError('daily archive elements are required');
    }
    for (const name of REQUIRED_ELEMENTS) {
      if (!elements[name]) throw new TypeError(`daily archive element is required: ${name}`);
    }
    if (!bridge || typeof bridge !== 'object') {
      throw new TypeError('daily archive bridge is required');
    }
    for (const name of REQUIRED_BRIDGE_METHODS) {
      if (typeof bridge[name] !== 'function') {
        throw new TypeError(`daily archive bridge method is required: ${name}`);
      }
    }
    if (typeof formatDateTime !== 'function') {
      throw new TypeError('formatDateTime must be a function');
    }

    let confirmed = normalizeSnapshot(DEFAULT_SNAPSHOT);
    let busy = null;
    let notice = null;
    let queue = Promise.resolve();

    function snapshotStatus() {
      if (confirmed.runningDate) {
        return {
          message: `正在归档 ${confirmed.runningDate}…`,
          tone: ''
        };
      }
      if (confirmed.lastErrorCode) {
        const failedAt = confirmed.lastErrorAt
          ? `（${formatDateTime(confirmed.lastErrorAt)}）`
          : '';
        return {
          message: `上次归档未完成${failedAt}，请检查保存位置后重试。`,
          tone: 'error'
        };
      }
      if (confirmed.enabled) {
        return {
          message: '自动归档已开启。应用保持运行时，每天 08:00 自动保存。',
          tone: 'ok'
        };
      }
      return {
        message: '自动归档已关闭。',
        tone: ''
      };
    }

    function render() {
      const configured = Boolean(confirmed.rootDirectory);
      const settingBusy = ['load', 'toggle', 'choose'].includes(busy);
      elements.enabled.checked = confirmed.enabled;
      elements.enabled.disabled = settingBusy;
      elements.chooseButton.disabled = settingBusy;
      elements.saveButton.disabled = !configured || busy === 'save';
      elements.retryButton.disabled = (
        !confirmed.enabled
        || confirmed.pendingDates.length === 0
        || busy === 'retry'
      );
      elements.saveButton.setAttribute('aria-busy', String(busy === 'save'));
      elements.retryButton.setAttribute('aria-busy', String(busy === 'retry'));

      elements.rootDirectory.textContent = configured
        ? confirmed.rootDirectory
        : '尚未选择保存位置';
      elements.rootDirectory.title = configured ? confirmed.rootDirectory : '';
      elements.nextRun.textContent = confirmed.nextRunAt
        ? formatDateTime(confirmed.nextRunAt)
        : (confirmed.enabled ? '等待重新调度' : '未启用');
      elements.lastSuccess.textContent = confirmed.lastSuccessfulDate || '尚无归档';
      elements.pending.textContent = confirmed.pendingDates.length
        ? `待补存 ${confirmed.pendingDates.length} 天`
        : '无待补存';

      const displayed = notice || snapshotStatus();
      elements.status.textContent = displayed.message;
      elements.status.className = `${STATUS_CLASS}${displayed.tone ? ` ${displayed.tone}` : ''}`;
      elements.status.setAttribute('aria-busy', String(Boolean(busy)));
    }

    function enqueue(operation) {
      const current = queue.catch(() => {}).then(operation);
      queue = current;
      return current;
    }

    function begin(kind, message) {
      busy = kind;
      notice = { message, tone: '' };
      render();
    }

    function finish(snapshot, message = null, tone = 'ok') {
      confirmed = normalizeSnapshot(snapshot);
      busy = null;
      notice = message ? { message, tone } : null;
      render();
    }

    async function restoreAfterFailure(message) {
      try {
        confirmed = normalizeSnapshot(await bridge.getDailyArchiveSettings());
      } catch {
        // The last confirmed snapshot is safer than rendering optimistic input.
      }
      busy = null;
      notice = { message, tone: 'error' };
      render();
    }

    function load() {
      return enqueue(async () => {
        begin('load', '正在读取自动归档状态…');
        try {
          const snapshot = await bridge.getDailyArchiveSettings();
          finish(snapshot);
          return snapshot;
        } catch (error) {
          busy = null;
          notice = {
            message: '自动归档状态读取失败，请稍后重试。',
            tone: 'error'
          };
          render();
          throw error;
        }
      });
    }

    async function chooseInsideQueue() {
      begin('choose', '正在等待选择保存位置…');
      const result = await bridge.chooseDailyArchiveDirectory();
      if (result?.canceled) {
        finish(
          result.settings || confirmed,
          '未选择保存位置，自动归档设置保持不变。',
          ''
        );
        return result;
      }
      finish(result?.settings, '保存位置已更新，自动归档已开启。');
      return result;
    }

    function chooseDirectory() {
      return enqueue(async () => {
        try {
          return await chooseInsideQueue();
        } catch (error) {
          await restoreAfterFailure(publicFailureMessage(
            error,
            '保存位置设置失败，请重试。'
          ));
          throw error;
        }
      });
    }

    function toggle(enabled) {
      if (typeof enabled !== 'boolean') {
        return Promise.reject(new TypeError('enabled must be a boolean'));
      }
      return enqueue(async () => {
        if (enabled && !confirmed.rootDirectory) {
          try {
            return await chooseInsideQueue();
          } catch (error) {
            await restoreAfterFailure(publicFailureMessage(
              error,
              '自动归档设置保存失败，请重试。'
            ));
            throw error;
          }
        }

        begin('toggle', enabled ? '正在开启自动归档…' : '正在关闭自动归档…');
        try {
          const snapshot = await bridge.setDailyArchiveEnabled(enabled);
          finish(
            snapshot,
            enabled ? '自动归档已开启。' : '自动归档已关闭。',
            enabled ? 'ok' : ''
          );
          return snapshot;
        } catch (error) {
          await restoreAfterFailure(publicFailureMessage(
            error,
            '自动归档设置保存失败，请重试。'
          ));
          throw error;
        }
      });
    }

    function saveCurrent() {
      return enqueue(async () => {
        begin('save', '正在保存最近一个归档日…');
        try {
          const response = await bridge.saveCurrentDailyArchive();
          const result = response?.result || {};
          const status = result.status === 'existing'
            ? '已校验，无需重复保存'
            : (result.status === 'saved-conflict' ? '已安全补存' : '已保存');
          finish(
            response?.settings,
            `${result.date || '最近一期'} ${status}。`
          );
          return response;
        } catch (error) {
          await restoreAfterFailure(publicFailureMessage(
            error,
            '新闻简报保存失败，请检查保存位置后重试。'
          ));
          throw error;
        }
      });
    }

    function retry() {
      return enqueue(async () => {
        begin('retry', '正在补存遗漏的新闻简报…');
        try {
          const response = await bridge.retryDailyArchives();
          const count = Array.isArray(response?.results) ? response.results.length : 0;
          finish(
            response?.settings,
            count ? `已补存 ${count} 天新闻简报。` : '没有需要补存的日期。'
          );
          return response;
        } catch (error) {
          await restoreAfterFailure(publicFailureMessage(
            error,
            '补存失败，请检查保存位置后重试。'
          ));
          throw error;
        }
      });
    }

    render();
    return Object.freeze({
      load,
      toggle,
      chooseDirectory,
      saveCurrent,
      retry
    });
  }

  return Object.freeze({
    DEFAULT_SNAPSHOT,
    createDailyArchiveController,
    normalizeSnapshot
  });
});
