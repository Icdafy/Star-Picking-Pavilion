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

const SQLITE_BUSY_PATTERN = /SQLITE_BUSY/;
const SQLITE_CORRUPT_PATTERN = /SQLITE_CORRUPT|SQLITE_NOTADB|SQLITE_DAMAGED|database disk image is malformed|file is not a database|database table is corrupted/i;

function openConnection() {
  const database = new DatabaseSync(DATABASE_PATH);
  try {
    // 打开后第一件事就是设 busy_timeout：之后任何操作撞锁都会重试 5 秒再报错，
    // 而不是立刻 SQLITE_BUSY（桌面端多进程共享同一个库文件是常态）
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA foreign_keys = ON');
    // 断言 WAL 真正生效，否则并发写入会退回到排它锁，问题要能在日志里被看见
    const mode = database.prepare('PRAGMA journal_mode = WAL').get();
    if (String(mode?.journal_mode).toLowerCase() !== 'wal') {
      console.warn(`[db] journal_mode 未能设置为 WAL（当前值: ${mode?.journal_mode}），并发写入能力会下降`);
    }
    return database;
  } catch (error) {
    // 初始 PRAGMA 阶段就会暴露「文件不是数据库」类损坏；失败必须先断开句柄，
    // 否则 Windows 上文件被占用，后续的隔离重命名会跟着失败
    try { database.close(); } catch {}
    throw error;
  }
}

// 损坏恢复第一步是把现场原样隔离（db/-wal/-shm 一起改名），留给事后取证，
// 而不是直接抛错让启动陷入「损坏→启动失败→再启动还是损坏」的死循环
function quarantineCorruptFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantined = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DATABASE_PATH}${suffix}`;
    if (!fs.existsSync(file)) continue;
    const target = `${file}.corrupt-${stamp}`;
    try {
      fs.renameSync(file, target);
      quarantined.push(target);
    } catch (error) {
      console.error(`[db] 隔离损坏文件失败: ${file}`, error);
    }
  }
  return quarantined;
}

function checkIntegrity(database) {
  try {
    const row = database.prepare('PRAGMA quick_check').get();
    return row?.quick_check === 'ok' ? null : (row?.quick_check || 'unknown');
  } catch (error) {
    return String(error?.message || error);
  }
}

let db;
function initializeDatabase() {
  try {
    db = openConnection();
  } catch (error) {
    const message = String(error?.message || error);
    // 「被锁」是可重试的环境问题，给出明确提示；「损坏」走隔离重建，两种失败不能混为一谈
    if (SQLITE_BUSY_PATTERN.test(message)) {
      throw new Error(`数据库被其它进程占用（SQLITE_BUSY），请关闭占用该文件的进程后重试: ${DATABASE_PATH}`);
    }
    if (!SQLITE_CORRUPT_PATTERN.test(message)) throw error;
    console.error(`[db] 打开数据库失败，疑似文件损坏: ${message}；隔离现场并以空库重建`);
    db = null;
  }
  if (db) {
    const problem = checkIntegrity(db);
    if (!problem) return;
    console.error(`[db] 完整性检查未通过: ${problem}；隔离损坏文件并以空库重建`);
    db.close(); // 重命名前必须先断开连接，否则 Windows 上文件句柄会让 rename 失败
    db = null;
  }
  const quarantined = quarantineCorruptFiles();
  console.error(`[db] 损坏文件已隔离至: ${quarantined.length ? quarantined.join(', ') : '(无可隔离文件)'}`);
  db = openConnection();
}
initializeDatabase();

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
  addCol('analysis_version', 'INTEGER NOT NULL DEFAULT 0');
  addCol('event_schema_version', 'INTEGER NOT NULL DEFAULT 0');
  addCol('ai_reason', 'TEXT');   // 情报研判（推荐理由 / 编者按）
  for (const name of ['content_text','images_json','vision_json','content_status','publisher_id','event_date']) addCol(name, 'TEXT');
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
  // v0.0.14 结构化管线的落库字段。canonical_url 是去掉跟踪参数后的去重键
  // （url 仍是跳转用的原始地址）；entities/events 是标注、实体提取与原子事件分离的产物；
  // event_key 是主事件键，聚类的精确通道直接按它对齐。
  // clean_version 记录这行是用哪一版清洗规则洗的，抬版本号即可让历史数据被顺带重洗。
  addCol('canonical_url', 'TEXT');
  addCol('entities_json', 'TEXT');
  addCol('topics_json', 'TEXT');
  addCol('events_json', 'TEXT');
  addCol('event_key', 'TEXT');
  if (cols.has('verification_json')) {
    db.exec('ALTER TABLE articles DROP COLUMN verification_json');
  }
  addCol('clean_version', 'INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_articles_starred ON articles(starred, starred_at DESC)');
  // 入库去重每条都要查一次 canonical_url；主事件键则是聚类精确通道的分桶依据
  db.exec('CREATE INDEX IF NOT EXISTS idx_articles_canonical ON articles(canonical_url)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_articles_event_key ON articles(event_key)');
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

// articles 与 articles_fts 必须原子双写：任一失败整体回滚，
// 否则主表行和全文影子行会永久错位（检索到不存在的条目，或条目永远搜不到）
function withTransaction(action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function insertArticle(a) {
  // url 上的唯一约束只能挡住「一字不差」的重复。真实世界里同一篇文章会带着不同的
  // utm/spm/share 参数从多个入口进来，规范化后的 canonical_url 才是可靠的去重键。
  const canonicalUrl = a.canonicalUrl || null;
  if (canonicalUrl) {
    const existing = db.prepare('SELECT id FROM articles WHERE canonical_url = ? LIMIT 1').get(canonicalUrl);
    if (existing) return false;
  }
  return withTransaction(() => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO articles
      (source_id, title, url, canonical_url, summary_raw, published_at, fetched_at, domain, image_url, clean_version, images_json, content_text, publisher_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const r = stmt.run(a.sourceId, a.title, a.url, canonicalUrl, a.summaryRaw || null,
      a.publishedAt || null, now(), a.domain || null, a.image || null,
      Number.isInteger(a.cleanVersion) ? a.cleanVersion : 0, JSON.stringify(a.images || []), a.contentText || null, a.publisherId || null);
    if (r.changes > 0) {
      db.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)')
        .run(r.lastInsertRowid, a.title, a.summaryRaw || '');
    }
    return r.changes > 0;
  });
}

function updateArticleFts(id, title, summary) {
  withTransaction(() => {
    db.prepare('DELETE FROM articles_fts WHERE rowid = ?').run(id);
    db.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)')
      .run(id, title, summary || '');
  });
}

// 删除文章时必须同步删掉 FTS 影子行，否则 trigram 索引会越积越大且检索到已删条目。
// 集合式分批删除（每批不超过 SQLite 参数上限），每批一个事务，失败只回滚当批
const DELETE_BATCH_SIZE = 900;
function deleteArticles(ids) {
  if (!ids.length) return 0;
  let removed = 0;
  for (let start = 0; start < ids.length; start += DELETE_BATCH_SIZE) {
    const batch = ids.slice(start, start + DELETE_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    removed += withTransaction(() => {
      db.prepare(`DELETE FROM articles_fts WHERE rowid IN (${placeholders})`).run(...batch);
      return db.prepare(`DELETE FROM articles WHERE id IN (${placeholders})`).run(...batch).changes;
    });
  }
  return removed;
}

// WAL 在长期运行中只增不减，清理后主动截断，让磁盘占用真正回落
function checkpointWal() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return true;
  } catch (error) {
    console.warn('[db] WAL checkpoint 失败:', error?.message || error);
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
  checkpointWal, databaseFileBytes, closeDatabase, withTransaction, DATA_DIR, DATABASE_PATH,
  DELETE_BATCH_SIZE
};

require('./ai/event-timing-migration').refreshEventTiming(db);
