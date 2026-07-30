'use strict';
// 数据库层 —— 使用 Node 内置 SQLite（含 FTS5），零原生依赖
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// 数据目录：打包后由 Electron 主进程注入 userData 路径（可写）；开发/直跑回退到 ../data
const DATA_DIR = process.env.STAR_PICKING_PAVILION_DATA_DIR
  || process.env.WINDCATCHER_DATA_DIR
  || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DATABASE_PATH = path.join(DATA_DIR, 'star-picking-pavilion.db');
const db = new DatabaseSync(DATABASE_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const integrity = db.prepare('PRAGMA quick_check').get();
if (integrity.quick_check !== 'ok') {
  db.close();
  throw new Error(`数据库完整性检查失败: ${integrity.quick_check}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rss',          -- rss | bing | html
  url TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'T2',           -- T1 | T1.5 | T2
  domain TEXT NOT NULL DEFAULT 'both',       -- lowaltitude | aerospace | both
  enabled INTEGER NOT NULL DEFAULT 1,
  selector_json TEXT,                        -- html 类型的选择器配置
  note TEXT,
  last_fetch_at TEXT,
  last_status TEXT,                          -- ok | error: xxx
  fetch_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  summary_raw TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  domain TEXT,                               -- lowaltitude | aerospace
  category TEXT,                             -- 政策法规|企业动态|技术研发|资本市场|发射与任务|应用场景|观点报告
  relevant INTEGER,                          -- NULL=待判 1=相关 0=无关
  analyzed INTEGER NOT NULL DEFAULT 0,       -- 0=待分析 1=完成 2=失败 3=启发式
  scores_json TEXT,                          -- 五维分 {importance,novelty,credibility,impact,timeliness}
  quality_score REAL,                        -- 代码公式计算的最终质量分
  featured INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  tags_json TEXT,
  cluster_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_feat ON articles(featured, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_analyzed ON articles(analyzed, relevant);
-- 统计面板每 18 秒按 fetched_at 计数；无此索引会全表扫描
CREATE INDEX IF NOT EXISTS idx_articles_fetched ON articles(fetched_at);
-- 信息流时间线按 COALESCE(published_at, fetched_at) 倒序；表达式索引让排序走索引而非全表排序
CREATE INDEX IF NOT EXISTS idx_articles_timeline
  ON articles(COALESCE(published_at, fetched_at) DESC);
-- 保留清理与聚类窗口都按「相关性 + 时间」取子集
CREATE INDEX IF NOT EXISTS idx_articles_relevant_fetched ON articles(relevant, fetched_at);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, summary, tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  main_article_id INTEGER,
  size INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                        -- feedback | source_report
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// ---------- 迁移：为已存在的库幂等补列（兼容旧数据，不丢数据） ----------
function migrate() {
  const cols = new Set(db.prepare('PRAGMA table_info(articles)').all().map(c => c.name));
  const addCol = (name, def) => { if (!cols.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${def}`); };
  addCol('ai_reason', 'TEXT');   // 情报研判（推荐理由 / 编者按）
  addCol('image_url', 'TEXT');   // 文章缩略图
  // 星标留存：用户显式收起来的情报。starred_at 既是「星标」视图的排序依据，
  // 也让保留清理能识别并永久跳过这些条目（见 retention.selectExpiredIds）
  addCol('starred', 'INTEGER NOT NULL DEFAULT 0');
  addCol('starred_at', 'TEXT');
  // v0.0.13 技术突破热度证据。质量分本身保持原语义，突破只影响热点公式；
  // 持久化以后，SQL 排序、卡片解释和每日研究样本读取同一份判定。
  addCol('breakthrough_score', 'REAL NOT NULL DEFAULT 0');
  addCol('breakthrough_bonus', 'REAL NOT NULL DEFAULT 0');
  addCol('breakthrough_signals_json', 'TEXT');
  addCol('scoring_version', 'INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_articles_starred ON articles(starred, starred_at DESC)');
  // sources 表补 intl 列（标记国外情报源）
  const srcCols = new Set(db.prepare('PRAGMA table_info(sources)').all().map(c => c.name));
  if (!srcCols.has('intl')) db.exec('ALTER TABLE sources ADD COLUMN intl INTEGER NOT NULL DEFAULT 0');
  // 失败退避：连续失败次数与下次允许采集时间（长期挂掉的源不再每轮空转）
  if (!srcCols.has('consecutive_errors')) {
    db.exec('ALTER TABLE sources ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0');
  }
  if (!srcCols.has('next_fetch_at')) db.exec('ALTER TABLE sources ADD COLUMN next_fetch_at TEXT');
}
migrate();

// ---------- 通用助手 ----------
function now() { return new Date().toISOString(); }

function insertArticle(a) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO articles
    (source_id, title, url, summary_raw, published_at, fetched_at, domain, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(a.sourceId, a.title, a.url, a.summaryRaw || null,
    a.publishedAt || null, now(), a.domain || null, a.image || null);
  if (r.changes > 0) {
    db.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)')
      .run(r.lastInsertRowid, a.title, a.summaryRaw || '');
  }
  return r.changes > 0;
}

function updateArticleFts(id, title, summary) {
  db.prepare('DELETE FROM articles_fts WHERE rowid = ?').run(id);
  db.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)')
    .run(id, title, summary || '');
}

// 删除文章时必须同步删掉 FTS 影子行，否则 trigram 索引会越积越大且检索到已删条目
function deleteArticles(ids) {
  if (!ids.length) return 0;
  const removeFts = db.prepare('DELETE FROM articles_fts WHERE rowid = ?');
  const removeArticle = db.prepare('DELETE FROM articles WHERE id = ?');
  let removed = 0;
  for (const id of ids) {
    removeFts.run(id);
    removed += removeArticle.run(id).changes;
  }
  return removed;
}

// WAL 在长期运行中只增不减，清理后主动截断，让磁盘占用真正回落
function checkpointWal() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return true;
  } catch {
    return false;
  }
}

function databaseFileBytes() {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { total += fs.statSync(`${DATABASE_PATH}${suffix}`).size; } catch {}
  }
  return total;
}

let databaseClosed = false;
function closeDatabase() {
  if (databaseClosed) return;
  databaseClosed = true;
  db.close();
}

module.exports = {
  db, now, insertArticle, updateArticleFts, deleteArticles,
  checkpointWal, databaseFileBytes, closeDatabase, DATA_DIR, DATABASE_PATH
};
