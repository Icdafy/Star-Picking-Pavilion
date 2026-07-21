'use strict';
// 每日情报日报 —— 学习 AIHOT：纯代码分桶排序，1 秒生成，无需大模型
// 版块：政策法规 / 发射与任务 / 企业动态 / 技术研发 / 资本市场 / 应用场景 / 观点报告
const { db, now } = require('../db');
const { localDateString, localDateTimeToIso } = require('../date-time');

const SECTION_ORDER = ['政策法规', '发射与任务', '企业动态', '技术研发', '资本市场', '应用场景', '观点报告'];
const PER_SECTION = 8;

function generateDaily(dateStr) {
  // dateStr: YYYY-MM-DD（日报覆盖该日期 8:00 往前 24 小时；默认今天）
  const date = dateStr || localDateString();
  const end = localDateTimeToIso(date, 8);
  const rows = db.prepare(`
    SELECT a.id, a.title, a.url, a.ai_summary, a.category, a.domain,
           a.quality_score, a.published_at, a.cluster_id, s.name AS source_name, s.tier
    FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE a.featured = 1
      AND julianday(COALESCE(a.published_at, a.fetched_at)) > julianday(?, '-24 hours')
      AND julianday(COALESCE(a.published_at, a.fetched_at)) <= julianday(?)
    ORDER BY a.quality_score DESC`).all(end, end);

  // 事件簇去重：每簇只留主条
  const seenCluster = new Set();
  const deduped = [];
  for (const r of rows) {
    if (r.cluster_id) {
      if (seenCluster.has(r.cluster_id)) continue;
      seenCluster.add(r.cluster_id);
    }
    deduped.push(r);
  }

  const sections = SECTION_ORDER.map(cat => ({
    category: cat,
    items: deduped.filter(r => r.category === cat).slice(0, PER_SECTION)
  })).filter(s => s.items.length > 0);

  const content = {
    date,
    windowVersion: 2,
    generatedAt: now(),
    total: deduped.length,
    byDomain: {
      lowaltitude: deduped.filter(r => r.domain === 'lowaltitude').length,
      aerospace: deduped.filter(r => r.domain === 'aerospace').length
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
      if (report && report.date === date && report.windowVersion === 2 && Number.isFinite(report.total)
        && report.byDomain && Array.isArray(report.sections)) return report;
    } catch {}
  }
  return generateDaily(date);
}

function listDailyDates() {
  return db.prepare('SELECT date FROM daily_reports ORDER BY date DESC LIMIT 60').all().map(r => r.date);
}

module.exports = { generateDaily, getDaily, listDailyDates };
