'use strict';
// 每日情报日报 —— 学习 AIHOT：纯代码分桶排序，1 秒生成，无需大模型
// 版块：政策法规 / 发射与任务 / 企业动态 / 技术研发 / 资本市场 / 应用场景 / 观点报告
const { db, now } = require('../db');
const { localDateString } = require('../date-time');
const { loadScoring } = require('../config');
const { buildDailyBundle } = require('../archive/daily-bundle');

const PER_SECTION = 8;

function generateDaily(dateStr) {
  // dateStr: YYYY-MM-DD（日报覆盖该日期 8:00 往前 24 小时；默认今天）。
  // v3 以 fetched_at 归档，每条入库记录只属于一个窗口，迟到新闻不会永久漏失。
  const date = dateStr || localDateString();
  const bundle = buildDailyBundle({
    database: db,
    date,
    scoring: loadScoring()
  });
  const sections = bundle.readable.featuredSections.map(section => ({
    category: section.category,
    items: section.items.slice(0, PER_SECTION)
  }));
  const featuredItems = sections.flatMap(section => section.items);

  const content = {
    date,
    windowVersion: 3,
    window: bundle.window,
    generatedAt: now(),
    total: featuredItems.length,
    totalCollected: bundle.summary.total,
    totalRelevant: bundle.summary.relevant,
    totalPending: bundle.summary.pending,
    totalBreakthroughs: bundle.summary.breakthroughs,
    byDomain: {
      lowaltitude: featuredItems.filter(r =>
        r.domain === 'lowaltitude' || r.domain === 'both').length,
      aerospace: featuredItems.filter(r =>
        r.domain === 'aerospace' || r.domain === 'both').length
    },
    sections
  };

  db.prepare(`INSERT INTO daily_reports (date, content_json, created_at) VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET content_json=excluded.content_json, created_at=excluded.created_at`)
    .run(date, JSON.stringify(content), now());
  return content;
}

function getDaily(dateStr) {
  const date = dateStr || localDateString();
  const row = db.prepare('SELECT content_json FROM daily_reports WHERE date=?').get(date);
  if (row) {
    try {
      const report = JSON.parse(row.content_json);
      if (report && report.date === date && report.windowVersion === 3 && Number.isFinite(report.total)
        && report.byDomain && Array.isArray(report.sections)) return report;
    } catch {}
  }
  return generateDaily(date);
}

function listDailyDates() {
  return db.prepare('SELECT date FROM daily_reports ORDER BY date DESC LIMIT 60').all().map(r => r.date);
}

module.exports = { generateDaily, getDaily, listDailyDates };
