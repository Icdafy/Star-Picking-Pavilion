'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasStrictAuditFailure,
  summarizeSourceResults
} = require('../scripts/audit-sources');

test('信源审计区分正常、空结果和失败且保留明细', () => {
  const summary = summarizeSourceResults([
    { source: '正常源', fetched: 3, added: 2, ms: 50 },
    { source: '空结果源', fetched: 0, added: 0, ms: 20 },
    { source: '失败源', error: 'HTTP 404', consecutiveErrors: 1 }
  ]);

  assert.deepEqual(summary.counts, { total: 3, ok: 1, empty: 1, failed: 1 });
  assert.deepEqual(summary.failed, [{ source: '失败源', error: 'HTTP 404' }]);
  assert.deepEqual(summary.empty, [{ source: '空结果源', fetched: 0 }]);
});

test('严格信源审计把空结果和请求失败都视为门禁失败', () => {
  assert.equal(hasStrictAuditFailure({ counts: { empty: 0, failed: 0 } }), false);
  assert.equal(hasStrictAuditFailure({ counts: { empty: 1, failed: 0 } }), true);
  assert.equal(hasStrictAuditFailure({ counts: { empty: 0, failed: 1 } }), true);
});
