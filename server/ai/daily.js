'use strict';
// 每日情报日报 —— 学习 AIHOT：纯代码分桶排序，1 秒生成，无需大模型
// 版块：政策法规 / 发射与任务 / 企业动态 / 技术研发 / 资本市场 / 应用场景 / 观点报告
const { db, now } = require('../db');
const { localDateString } = require('../date-time');
const { loadScoring } = require('../config');
const { buildDailyBundle, resolveDailyWindow } = require('../archive/daily-bundle');
const { HttpError } = require('../http-security');
const { composeIssue } = require('./reports');

// v0.2.0 起日报与周报、月报同一结构：导语、热点事件、一级市场、我的关注、技术突破。
// edition 低于此值的近期日报在读取时按原窗口重新组稿（原始资料仍在库里），老日报原样保留。
const EDITION = 2;
const REBUILD_RECENT_DAYS = 30;

const PER_SECTION = 8;

function isValidReport(report, date) {
  return Boolean(report && report.date === date && report.windowVersion === 3
    && Number.isFinite(report.total) && report.byDomain && Array.isArray(report.sections));
}

function tryReadReport(date) {
  const row = db.prepare('SELECT content_json FROM daily_reports WHERE date=?').get(date);
  if (!row) return null;
  try {
    const report = JSON.parse(row.content_json);
    if (isValidReport(report, date)) return report;
  } catch {}
  // 行存在但内容解析/校验失败：返回标记让调用方知道原行已损坏，但绝不动原行
  return { corrupt: true };
}

function buildDailyContent(date) {
  // 日报覆盖该日期 8:00 往前 24 小时。
  // v3 以 fetched_at 归档，每条入库记录只属于一个窗口，迟到新闻不会永久漏失。
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
  const issue = composeIssue({
    start: bundle.window.start,
    end: bundle.window.end,
    label: `${date} 日报`,
    periodLabel: '日报',
    perSection: PER_SECTION
  });

  return {
    date,
    windowVersion: 3,
    edition: EDITION,
    window: bundle.window,
    truncated: bundle.truncated,
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
    sections,
    totals: issue.totals,
    lead: issue.lead,
    leadSource: issue.leadSource,
    hot: issue.hot,
    deals: issue.deals,
    investors: issue.investors,
    companies: issue.companies,
    portfolio: issue.portfolio,
    breakthroughs: issue.breakthroughs
  };
}

function isStaleEdition(report, date) {
  if (!report || report.corrupt || Number(report.edition) >= EDITION) return false;
  return Date.parse(localDateString()) - Date.parse(date) <= REBUILD_RECENT_DAYS * 86400e3;
}

function isUnfinishedSnapshot(report, date) {
  const generatedAt = Date.parse(report?.generatedAt);
  if (!Number.isFinite(generatedAt)) return false;
  const end = Date.parse(resolveDailyWindow(date).end);
  // 08:00 前打开的当天日报是草稿：期内短暂复用，跨过截止后补齐一次再冻结。
  return generatedAt < end && (Date.now() >= end || Date.now() - generatedAt >= 30 * 60e3);
}

function generateDaily(dateStr, { overwrite = false } = {}) {
  // dateStr: YYYY-MM-DD（默认今天）
  const date = dateStr || localDateString();
  if (date > localDateString()) {
    throw new HttpError(400, '日报日期不能晚于今天');
  }
  const existing = tryReadReport(date);
  if (existing && !existing.corrupt && !overwrite && !isStaleEdition(existing, date)
    && !isUnfinishedSnapshot(existing, date)) {
    // 已有有效日报：默认不重生成，直接返回现有行
    return existing;
  }
  const content = buildDailyContent(date);
  if (existing && existing.corrupt && !overwrite) {
    // 原行损坏但调用方没显式要求覆写：保留原行留待取证，
    // 只返回内存里的重建副本并携带警告标记
    return { ...content, warning: 'daily-report-corrupt' };
  }
  db.prepare(`INSERT INTO daily_reports (date, content_json, created_at) VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET content_json=excluded.content_json, created_at=excluded.created_at`)
    .run(date, JSON.stringify(content), now());
  return content;
}

function getDaily(dateStr) {
  const date = dateStr || localDateString();
  // 有效行直接返回；损坏行不会被覆写，重建副本带警告标记（见 generateDaily）
  return generateDaily(date);
}

function listDailyDates() {
  return db.prepare('SELECT date FROM daily_reports ORDER BY date DESC LIMIT 60').all().map(r => r.date);
}

module.exports = { generateDaily, getDaily, listDailyDates };
