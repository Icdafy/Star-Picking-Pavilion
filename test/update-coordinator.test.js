'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUpdateInstallCoordinator,
  publicVersionFromPackage,
  publicVersionFromUpdateInfo
} = require('../electron/update-coordinator');

test('update status exposes the public GitHub release version instead of updater SemVer', () => {
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
  assert.equal(publicVersionFromPackage({ build: { buildVersion: '0.1.2' } }, '0.1.4'), '0.1.2');
});

test('update installer waits for graceful shutdown before launching NSIS and releasing quit', async () => {
  const calls = [];
  let finishShutdown;
  const coordinator = createUpdateInstallCoordinator({
    autoUpdater: { quitAndInstall: () => calls.push('install') },
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
  assert.deepEqual(calls, ['status:installing', 'quit:true', 'install']);
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
