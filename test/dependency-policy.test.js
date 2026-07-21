'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cron = require('node-cron');
const packageJson = require('../package.json');

test('node-cron supports the application expressions and v4 task lifecycle', t => {
  const expressions = [
    '*/5 * * * *',
    '*/20 * * * * *',
    '5 8 * * *'
  ];
  for (const expression of expressions) assert.equal(cron.validate(expression), true, expression);

  const task = cron.schedule('0 0 1 1 *', () => {});
  t.after(() => {
    task.stop?.();
    if (task.getStatus?.() !== 'destroyed') task.destroy?.();
  });

  assert.equal(typeof task.getStatus, 'function');
  assert.equal(typeof task.destroy, 'function');
  task.stop();
  assert.equal(task.getStatus(), 'stopped');
  task.start();
  assert.match(task.getStatus(), /^(?:idle|running)$/);
  task.stop();
  task.destroy();
  assert.equal(task.getStatus(), 'destroyed');
});

test('direct dependencies stay on the verified release lines', () => {
  assert.equal(packageJson.dependencies.cheerio, '^1.2.0');
  assert.equal(packageJson.dependencies['iconv-lite'], '^0.7.3');
  assert.equal(packageJson.dependencies['node-cron'], '^4.6.0');
  assert.equal(packageJson.dependencies['rss-parser'], '^3.13.0');
  assert.equal(packageJson.dependencies.semver, '~7.7.4');
  assert.equal(packageJson.devDependencies.electron, '^42.7.0');
  assert.equal(packageJson.devDependencies['electron-builder'], '^26.15.3');
  assert.deepEqual(packageJson.overrides, {
    'js-yaml': '^4.3.0',
    undici: '^7.28.0'
  });
});
