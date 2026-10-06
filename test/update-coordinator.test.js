'use strict';

const { createUpdateCheckCoordinator } = require('../electron/update-coordinator');

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  comparePublicVersions,
  createPublicUpdateSupport,
  createUpdateInstallCoordinator,
  publicVersionFromPackage,
  publicVersionFromUpdateInfo
} = require('../electron/update-coordinator');

test('manual update checks reject duplicates, active downloads and rapid retries', async () => {
  let finish, stamp = 0, status = 'idle', count = 0;
  const coordinator = createUpdateCheckCoordinator({
    autoUpdater: { checkForUpdates: () => { count++; return new Promise(resolve => { finish = resolve; }); } },
    getStatus: () => status, now: () => stamp, reportStatus: value => { status = value; }
  });
  const pending = coordinator.check();
  assert.equal(status, 'checking');
  assert.deepEqual(await coordinator.check(), { started: false, reason: 'busy' });
  status = 'current'; finish(); assert.deepEqual(await pending, { started: true });
  assert.deepEqual(await coordinator.check(), { started: false, reason: 'throttled' });
  stamp = 30_000;
  for (const value of ['available', 'downloading', 'downloaded', 'installing']) {
    status = value;
    assert.deepEqual(await coordinator.check(), { started: false, reason: 'busy' });
  }
  status = 'error'; const retried = coordinator.check(); status = 'current'; finish();
  assert.deepEqual(await retried, { started: true }); assert.equal(count, 2);
});

test('update checks report network failures and can retry after the request interval', async () => {
  let status = 'idle', stamp = 0, fails = true;
  const errors = [];
  const coordinator = createUpdateCheckCoordinator({
    autoUpdater: { checkForUpdates: async () => { if (fails) throw new Error('network offline'); status = 'current'; } },
    getStatus: () => status, now: () => stamp,
    reportStatus: (value, detail) => { status = value; if (detail) errors.push(detail.message); }
  });
  assert.deepEqual(await coordinator.check(), { started: false, reason: 'check-failed', message: 'network offline' });
  assert.equal(status, 'error'); assert.deepEqual(errors, ['network offline']);
  stamp = 30_000; fails = false; assert.deepEqual(await coordinator.check(), { started: true });
  assert.equal(status, 'current');
  assert.deepEqual(await createUpdateCheckCoordinator().check(), { started: false, reason: 'updater-unavailable' });
});

test('update status and installed app expose one public version', () => {
  assert.equal(publicVersionFromUpdateInfo({
    version: '0.1.4',
    tag: 'v0.1.2',
    releaseName: '摘星阁 v0.1.2'
  }), '0.1.2');
  assert.equal(publicVersionFromUpdateInfo({
    version: '0.1.4',
    releaseName: '摘星阁 v0.1.2'
  }), '0.1.2');
  assert.equal(publicVersionFromUpdateInfo({ version: '0.1.4' }), '0.1.4');
  assert.equal(publicVersionFromPackage({
    version: '0.1.3',
    build: { buildVersion: '0.1.3' }
  }, '0.1.5'), '0.1.3');
});

test('public release comparison suppresses the one-time metadata bridge after install', async () => {
  const fallbackCalls = [];
  const support = createPublicUpdateSupport({
    currentVersion: '0.1.3',
    fallback: info => {
      fallbackCalls.push(info.tag);
      return true;
    }
  });

  assert.equal(comparePublicVersions('0.1.3', '0.1.2'), 1);
  assert.equal(comparePublicVersions('0.1.3', '0.1.3'), 0);
  assert.equal(comparePublicVersions('0.1.2', '0.1.3'), -1);
  assert.equal(comparePublicVersions('0.1.3.1', '0.1.3'), 1);
  assert.equal(await support({ version: '0.1.5', tag: 'v0.1.3' }), false);
  assert.equal(await support({ version: '0.1.4', tag: 'v0.1.4' }), true);
  assert.deepEqual(fallbackCalls, ['v0.1.4']);
});

test('update installer waits for graceful shutdown before launching NSIS and releasing quit', async () => {
  const calls = [];
  let finishShutdown;
  const coordinator = createUpdateInstallCoordinator({
    autoUpdater: { quitAndInstall: (...args) => calls.push(`install:${args.join(',')}`) },
    shutdown: () => new Promise(resolve => { finishShutdown = resolve; }),
    setQuitReady: ready => calls.push(`quit:${ready}`),
    reportStatus: status => calls.push(`status:${status}`)
  });

  const pending = coordinator.install('0.1.2');
  await Promise.resolve();
  assert.deepEqual(calls, ['status:installing']);
  assert.equal(coordinator.installing, true);

  finishShutdown();
  assert.deepEqual(await pending, { started: true });
  assert.deepEqual(calls, ['status:installing', 'quit:true', 'install:true,true']);
});

test('update installer rejects duplicate clicks and reports launch failures', async () => {
  let finishShutdown;
  const statuses = [];
  const quitStates = [];
  const coordinator = createUpdateInstallCoordinator({
    autoUpdater: { quitAndInstall: () => { throw new Error('installer unavailable'); } },
    shutdown: () => new Promise(resolve => { finishShutdown = resolve; }),
    setQuitReady: ready => quitStates.push(ready),
    reportStatus: (status, data) => statuses.push([status, data])
  });

  const first = coordinator.install('0.1.2');
  assert.deepEqual(await coordinator.install('0.1.2'), {
    started: false,
    reason: 'already-installing'
  });
  finishShutdown();
  assert.deepEqual(await first, {
    started: false,
    reason: 'install-failed',
    message: 'installer unavailable'
  });
  assert.deepEqual(quitStates, [true, false]);
  assert.deepEqual(statuses, [
    ['installing', { version: '0.1.2' }],
    ['error', { message: 'installer unavailable' }]
  ]);
});

test('async updater errors end install mode and cannot fall back to install-on-exit', async () => {
  const statuses = [];
  const quitStates = [];
  const coordinator = createUpdateInstallCoordinator({
    autoUpdater: { quitAndInstall: () => {} },
    shutdown: async () => {},
    setQuitReady: ready => quitStates.push(ready),
    reportStatus: (status, data) => statuses.push([status, data])
  });

  assert.deepEqual(await coordinator.install('0.1.3'), { started: true });
  assert.equal(coordinator.installing, true);
  assert.equal(coordinator.reportFailure(new Error('spawn failed')), true);
  assert.equal(coordinator.installing, false);
  assert.equal(coordinator.reportFailure(new Error('duplicate')), false);
  assert.deepEqual(quitStates, [true, false]);
  assert.deepEqual(statuses, [
    ['installing', { version: '0.1.3' }],
    ['error', { message: 'spawn failed' }]
  ]);
});
