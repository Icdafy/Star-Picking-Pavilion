'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-report-concurrency-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase, now } = require('../server/db');
const { localDateString } = require('../server/date-time');
const reportsPath = path.join(__dirname, '../server/ai/reports.js');
const actualRequire = createRequire(reportsPath);
const reports = actualRequire('./reports');

test.after(async () => { closeDatabase(); await fs.promises.rm(dataDir, { recursive: true, force: true }); });

function fixtureIssues() {
  db.exec('DELETE FROM daily_reports; DELETE FROM period_reports; DELETE FROM model_receipts; DELETE FROM model_usage');
  const daily = { kind: 'daily', key: localDateString(), date: localDateString(), edition: 2, windowVersion: 3, total: 0 };
  const issues = [daily, ...[
    ['weekly', reports.periodKeyOf('weekly')], ['weekly', reports.previousPeriodKey('weekly')], ['monthly', reports.periodKeyOf('monthly')]
  ].map(([kind, key]) => ({ kind, key }))];
  for (const issue of issues) {
    Object.assign(issue, { label: `${issue.kind}:${issue.key}`, generatedAt: now(), byDomain: {}, sections: [],
      totals: { relevant: 1, featured: 0, deals: 0 }, lead: '原始事实型导语', leadSource: 'factual' });
    writeIssue(issue);
  }
  return issues;
}

function writeIssue(issue) {
  if (issue.kind === 'daily') {
    db.prepare('INSERT OR REPLACE INTO daily_reports(date,content_json,created_at) VALUES (?,?,?)').run(issue.date, JSON.stringify(issue), now());
  } else {
    db.prepare('INSERT OR REPLACE INTO period_reports(kind,period_key,content_json,created_at) VALUES (?,?,?,?)').run(issue.kind, issue.key, JSON.stringify(issue), now());
  }
}

for (let targetIndex = 0; targetIndex < 4; targetIndex++) {
  test(`asynchronous lead editing preserves a newly regenerated report at position ${targetIndex}`, async () => {
    const issues = fixtureIssues(), target = issues[targetIndex];
    const module = { exports: {} };
    let updated = false;
    vm.runInNewContext(fs.readFileSync(reportsPath, 'utf8'), {
      module, console,
      require: name => name === './deepseek' ? {
        extractJson: JSON.parse,
        chat: async messages => {
          if (messages[1].content.includes(target.label)) {
            // 模拟模型请求尚在途时，用户点击重新生成并完成了新的事实快照。
            writeIssue({ ...target, totals: { ...target.totals, relevant: 2 }, lead: '用户刚重新生成的报告', revision: 'new' });
            updated = true;
          }
          await Promise.resolve();
          return JSON.stringify({ lead: '这是模型根据旧版资料写出的导语，不能覆盖随后重新生成的报告。' });
        }
      } : actualRequire(name)
    });
    const result = await module.exports.enhanceLeads({ settings: { ai: { apiKey: 'fixture', model: 'fixture-model' } } });
    assert.equal(updated, true);
    assert.equal(result.rewritten, 3);
    const row = target.kind === 'daily'
      ? db.prepare('SELECT content_json FROM daily_reports WHERE date=?').get(target.date)
      : db.prepare('SELECT content_json FROM period_reports WHERE kind=? AND period_key=?').get(target.kind, target.key);
    const retained = JSON.parse(row.content_json);
    assert.equal(retained.revision, 'new');
    assert.equal(retained.lead, '用户刚重新生成的报告');
    assert.equal(retained.totals.relevant, 2);
  });
}
