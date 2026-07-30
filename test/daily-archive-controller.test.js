'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let DailyArchiveController;
const previousGlobal = globalThis.DailyArchiveController;
try {
  DailyArchiveController = require('../renderer/daily-archive-controller');
} catch {
  DailyArchiveController = null;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createElement() {
  return {
    checked: false,
    disabled: false,
    textContent: '',
    className: '',
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
  };
}

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

function createFixture(snapshot = DEFAULT_SNAPSHOT, overrides = {}) {
  assert.ok(DailyArchiveController, 'daily archive controller must exist');
  const elements = {
    enabled: createElement(),
    rootDirectory: createElement(),
    chooseButton: createElement(),
    saveButton: createElement(),
    retryButton: createElement(),
    nextRun: createElement(),
    lastSuccess: createElement(),
    pending: createElement(),
    status: createElement()
  };
  const calls = [];
  let current = snapshot;
  const bridge = {
    async getDailyArchiveSettings() {
      calls.push(['get']);
      return current;
    },
    async chooseDailyArchiveDirectory() {
      calls.push(['choose']);
      const result = overrides.choose
        ? await overrides.choose()
        : { canceled: false, settings: current };
      if (result?.settings) current = result.settings;
      return result;
    },
    async setDailyArchiveEnabled(enabled) {
      calls.push(['setEnabled', enabled]);
      const result = overrides.setEnabled
        ? await overrides.setEnabled(enabled)
        : { ...current, enabled };
      current = result;
      return result;
    },
    async saveCurrentDailyArchive() {
      calls.push(['save']);
      const result = overrides.save
        ? await overrides.save()
        : {
            result: { status: 'saved', date: '2026-07-31' },
            settings: current
          };
      if (result?.settings) current = result.settings;
      return result;
    },
    async retryDailyArchives() {
      calls.push(['retry']);
      const result = overrides.retry
        ? await overrides.retry()
        : { results: [], settings: current };
      if (result?.settings) current = result.settings;
      return result;
    }
  };
  if (overrides.get) bridge.getDailyArchiveSettings = async () => {
    calls.push(['get']);
    const result = await overrides.get();
    current = result;
    return result;
  };

  const controller = DailyArchiveController.createDailyArchiveController({
    elements,
    bridge,
    formatDateTime: value => `格式化:${value}`
  });
  return { elements, bridge, calls, controller };
}

test('module is CommonJS-safe and exposes a frozen API', () => {
  assert.ok(DailyArchiveController, 'daily archive controller must exist');
  assert.equal(globalThis.DailyArchiveController, previousGlobal);
  assert.equal(Object.isFrozen(DailyArchiveController), true);
  assert.equal(Object.isFrozen(createFixture().controller), true);
});

test('load renders path, next run, last success, failure and pending count', async () => {
  const snapshot = {
    ...DEFAULT_SNAPSHOT,
    enabled: true,
    rootDirectory: 'D:\\Research\\Daily',
    lastSuccessfulDate: '2026-07-30',
    nextRunAt: '2026-08-01T00:00:00.000Z',
    pendingDates: ['2026-07-29', '2026-07-31'],
    lastErrorCode: 'directory-unavailable',
    lastErrorAt: '2026-07-31T02:00:00.000Z'
  };
  const fixture = createFixture(snapshot);
  await fixture.controller.load();

  assert.equal(fixture.elements.enabled.checked, true);
  assert.equal(fixture.elements.rootDirectory.textContent, 'D:\\Research\\Daily');
  assert.equal(
    fixture.elements.nextRun.textContent,
    '格式化:2026-08-01T00:00:00.000Z'
  );
  assert.equal(fixture.elements.lastSuccess.textContent, '2026-07-30');
  assert.equal(fixture.elements.pending.textContent, '待补存 2 天');
  assert.match(fixture.elements.status.textContent, /上次归档未完成/);
  assert.equal(fixture.elements.status.className.includes('error'), true);
  assert.equal(fixture.elements.retryButton.disabled, false);
  assert.equal(fixture.elements.status.getAttribute('aria-busy'), 'false');
});

test('first enable opens the native chooser and cancellation restores the off switch', async () => {
  const fixture = createFixture(DEFAULT_SNAPSHOT, {
    choose: async () => ({
      canceled: true,
      settings: DEFAULT_SNAPSHOT
    })
  });

  fixture.elements.enabled.checked = true;
  const result = await fixture.controller.toggle(true);

  assert.equal(result.canceled, true);
  assert.deepEqual(fixture.calls, [['choose']]);
  assert.equal(fixture.elements.enabled.checked, false);
  assert.match(fixture.elements.status.textContent, /未选择保存位置/);
  assert.equal(fixture.elements.enabled.disabled, false);
});

test('configured switch changes serialize and restore the confirmed snapshot after failure', async () => {
  const enabled = {
    ...DEFAULT_SNAPSHOT,
    enabled: true,
    rootDirectory: 'D:\\Research'
  };
  let reads = 0;
  const fixture = createFixture(enabled, {
    setEnabled: async () => {
      throw new Error('sensitive bridge detail');
    },
    get: async () => {
      reads += 1;
      return enabled;
    }
  });

  await assert.rejects(fixture.controller.toggle(false), /sensitive bridge detail/);

  assert.deepEqual(fixture.calls, [['setEnabled', false], ['get']]);
  assert.equal(reads, 1);
  assert.equal(fixture.elements.enabled.checked, true);
  assert.equal(fixture.elements.status.textContent, '自动归档设置保存失败，请重试。');
  assert.doesNotMatch(fixture.elements.status.textContent, /sensitive/);
});

test('manual save disables only its own control while pending', async () => {
  const snapshot = {
    ...DEFAULT_SNAPSHOT,
    enabled: true,
    rootDirectory: 'D:\\Research',
    pendingDates: ['2026-07-31']
  };
  const pending = deferred();
  const fixture = createFixture(snapshot, {
    save: () => pending.promise
  });
  await fixture.controller.load();

  const operation = fixture.controller.saveCurrent();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fixture.elements.saveButton.disabled, true);
  assert.equal(fixture.elements.retryButton.disabled, false);
  assert.equal(fixture.elements.chooseButton.disabled, false);
  assert.equal(fixture.elements.status.getAttribute('aria-busy'), 'true');

  pending.resolve({
    result: { status: 'saved', date: '2026-07-31' },
    settings: { ...snapshot, lastSuccessfulDate: '2026-07-31', pendingDates: [] }
  });
  await operation;
  assert.equal(fixture.elements.saveButton.disabled, false);
  assert.equal(fixture.elements.status.getAttribute('aria-busy'), 'false');
  assert.match(fixture.elements.status.textContent, /2026-07-31.*已保存/);
});

test('retry disables only its own control and reports the completed catch-up count', async () => {
  const snapshot = {
    ...DEFAULT_SNAPSHOT,
    enabled: true,
    rootDirectory: 'D:\\Research',
    pendingDates: ['2026-07-29', '2026-07-30']
  };
  const pending = deferred();
  const fixture = createFixture(snapshot, {
    retry: () => pending.promise
  });
  await fixture.controller.load();

  const operation = fixture.controller.retry();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.elements.retryButton.disabled, true);
  assert.equal(fixture.elements.saveButton.disabled, false);

  pending.resolve({
    results: [
      { status: 'saved', date: '2026-07-29' },
      { status: 'saved', date: '2026-07-30' }
    ],
    settings: { ...snapshot, pendingDates: [], lastSuccessfulDate: '2026-07-30' }
  });
  await operation;

  assert.equal(fixture.elements.retryButton.disabled, true);
  assert.match(fixture.elements.status.textContent, /已补存 2 天/);
});

test('directory changes render only the confirmed native selection', async () => {
  const selected = {
    ...DEFAULT_SNAPSHOT,
    enabled: true,
    rootDirectory: 'E:\\Confirmed'
  };
  const fixture = createFixture(DEFAULT_SNAPSHOT, {
    choose: async () => ({ canceled: false, settings: selected })
  });
  await fixture.controller.chooseDirectory();

  assert.equal(fixture.elements.rootDirectory.textContent, 'E:\\Confirmed');
  assert.equal(fixture.elements.enabled.checked, true);
  assert.match(fixture.elements.status.textContent, /保存位置已更新/);
});

test('controller validates every required element and bridge method', () => {
  assert.throws(
    () => DailyArchiveController.createDailyArchiveController(),
    /elements/
  );
  const elements = {
    enabled: createElement(),
    rootDirectory: createElement(),
    chooseButton: createElement(),
    saveButton: createElement(),
    retryButton: createElement(),
    nextRun: createElement(),
    lastSuccess: createElement(),
    pending: createElement(),
    status: createElement()
  };
  assert.throws(
    () => DailyArchiveController.createDailyArchiveController({ elements, bridge: {} }),
    /getDailyArchiveSettings/
  );
});
