'use strict';
const { clampPublishedAt } = require('./date-time');
const { loadSelection } = require('./industry');
const { publicationUpperBound } = require('./collectors/publication-date');
const { settleAll } = require('./async-work');

const RETRY_MS = 24 * 60 * 60 * 1000;
function needsPublicationCheck(row, at = Date.now()) {
  return !row.published_at && (!row.publication_checked_at || at - Date.parse(row.publication_checked_at) >= RETRY_MS);
}

// 补发布时间独立于模型与事件修复版本，保留原分析、收藏与首次收录时间。
// 同步历史标记 / 热度信号，让新发现的旧报道不会继续贡献今天的热度。
function savePublicationTime(database, row, publication, checkedAt = new Date().toISOString()) {
  database.exec('SAVEPOINT publication_time');
  try {
    const result = saveInTransaction(database, row, publication, checkedAt);
    database.exec('RELEASE publication_time');
    return result;
  } catch (error) {
    database.exec('ROLLBACK TO publication_time');
    database.exec('RELEASE publication_time');
    throw error;
  }
}

function saveInTransaction(database, row, publication, checkedAt) {
  if (row.published_at) return false;
  const { publishedAt: value, publicationPrecision = null, publicationDateText = null } = typeof publication === 'string' ? { publishedAt: publication } : publication || {};
  const published = Date.parse(value);
  const date = value && Number.isFinite(published) ? clampPublishedAt(new Date(published).toISOString(), row.fetched_at) : null;
  database.prepare('UPDATE articles SET publication_checked_at=? WHERE id=?').run(checkedAt, row.id);
  if (!date) return false;
  const historical = row.imported_backfill || Date.parse(row.fetched_at) - publicationUpperBound(date, publicationPrecision) > loadSelection().historicalHours * 3600e3;
  const result = database.prepare('UPDATE articles SET published_at=?,historical=?,publication_precision=?,publication_date_text=? WHERE id=? AND published_at IS NULL')
    .run(date, historical ? 1 : 0, publicationPrecision, publicationDateText, row.id);
  if (!result.changes) return false;
  if (historical || publicationPrecision === 'month') database.prepare('DELETE FROM story_signals WHERE article_id=?').run(row.id);
  else database.prepare('UPDATE story_signals SET observed_at=? WHERE article_id=?').run(date, row.id);
  return true;
}

async function repairPublicationTimes(database, { enrich, network, limit = 10, onProgress = null } = {}) {
  const cutoff = new Date(Date.now() - RETRY_MS).toISOString();
  const rows = database.prepare(`SELECT a.*,s.intl FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.published_at IS NULL AND (a.relevant=1 OR a.starred=1)
      AND s.enabled=1 AND s.removed_at IS NULL AND s.type<>'external'
      AND (a.publication_checked_at IS NULL OR a.publication_checked_at<=?)
    ORDER BY a.starred DESC, (s.tier='T1') DESC, a.featured DESC, a.id DESC LIMIT ?`).all(cutoff, limit);
  let attempted = 0, repaired = 0, done = 0;
  const report = progress => {
    // 进度订阅故障不能改变已保存的日期或把核验记为失败。
    try { onProgress?.({ stage: 'publication-repair', done, total: rows.length, ...progress }); }
    catch (error) { console.warn('[publication] 进度通知失败:', String(error.message || error).slice(0, 180)); }
  };
  report({ status: 'running', message: `正在核验 ${rows.length} 条历史资料的原文发布时间` });
  let position = 0;
  try {
    await settleAll(Array.from({ length: Math.min(2, rows.length) }, async () => {
      while (position < rows.length) {
        const row = rows[position++];
        const task = { taskId: `publication:${row.id}`, current: { id: row.id, title: row.title || '历史资料' } };
        report({ ...task, status: 'running', message: '正在读取原文并核验发布时间' });
        try {
          const content = await enrich(row, { network });
          const waiting = content.status === 'network-wait';
          if (!waiting) {
            attempted++;
            repaired += savePublicationTime(database, row, content) ? 1 : 0;
          }
          done++;
          report({ ...task, status: 'completed', skipped: waiting,
            message: waiting ? '等待海外网络恢复后核验' : content.publishedAt ? '原文发布时间核验完成' : '原文未提供可确认的发布时间' });
        } catch (error) {
          done++;
          report({ ...task, status: 'failed', message: '原文发布时间核验失败，已保留原数据' });
          throw error;
        }
      }
    }));
    report({ status: 'completed', message: `发布时间核验完成：检查 ${attempted} 条，补齐 ${repaired} 条` });
  } catch (error) {
    report({ status: 'failed', message: '发布时间核验未完成，已保留原数据' });
    throw error;
  }
  return { attempted, repaired };
}

module.exports = { needsPublicationCheck, savePublicationTime, repairPublicationTimes };
