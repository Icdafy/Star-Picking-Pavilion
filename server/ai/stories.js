'use strict';
// 事件归组 —— AIHOT events/group.ts 的桌面版。同一件事，官网发一篇、媒体转十篇、公众号再写三篇，
// 读者只需要看到一次：报道归到“事件”（story，沿用 clusters 表），后续进展挂在同一个事件下。
//
// 召回：最近 recallDays 天内已归组的报道，两路信号——
//   · 字面：中文标题 + 摘要的字符 bigram，overlap 系数（交集 / 较短者）+ 绝对交集下限
//   · 结构：主事件键相同（主体 · 动作类 · 客体）；同一主体公司 + 同一动作类
// 判定：主事件键相同、或字面相似 ≥ autoOverlap 且日期与状态不冲突 → 直接归入；
//       落在灰区的，交给模型三分类（同一件事 / 后续进展 / 两件事），置信度够才合并；
//       没有 Key 时灰区一律不合并（宁可两条，也不错并）。
// 规则：
//   · 历史资料（发现时已发布超过 48 小时）可以挂到已有事件，但不开新事件、不计热度
//   · 同一条报道同时强指向两个事件时，两个事件合并（小的并进大的，merged_into 留痕）
//   · 事件容量有上限，防止相似度误判串链吞掉半个库
//   · 串行运行（调度器的分析锁），归组结果只在变化时写库
const { db, now } = require('../db');
const { bigrams } = require('./cluster');
const industry = require('../industry');
const { chat, extractJson } = require('./deepseek');
const { withReceipt } = require('./receipts');
const { modelFor } = require('./model-policy');
const { neutralize } = require('./editorial');
const { observedAt } = require('./companies');

const TIER_RANK = { T1: 3, 'T1.5': 2, T2: 1 };
const RELATIONS = new Set(['same', 'development', 'different']);

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function docOf(row) {
  const events = parseJson(row.events_json, []);
  const event = Array.isArray(events) ? events[0] : null;
  const subjects = parseJson(row.subjects_json, []);
  return {
    id: row.id,
    storyId: row.cluster_id || null,
    domain: row.domain || null,
    title: row.title_zh || row.title,
    summary: row.ai_summary || '',
    grams: bigrams(`${row.title_zh || row.title} ${row.ai_summary || ''}`),
    eventKey: row.event_key || null,
    actionClass: event?.actionClass || null,
    eventDate: event?.date || null,
    eventStatus: event?.status || 'unknown',
    eventText: event ? `${event.actor || ''}${event.action || ''}${event.object || ''}` : '',
    subjects: new Set((Array.isArray(subjects) ? subjects : []).filter(s => s?.id && s.role === 'primary').map(s => s.id)),
    tier: row.tier,
    attention: Number(row.attention_score ?? row.quality_score) || 0,
    observed: observedAt(row),
    historical: Boolean(row.historical || row.imported_backfill),
    participantKey: row.participant_key || `source:${row.source_id}`,
    participantName: row.publisher_id || row.source_name || '',
    sourceName: row.source_name
  };
}

function compatible(a, b) {
  if (a.eventDate && b.eventDate && a.eventDate !== b.eventDate) return false;
  if (a.eventStatus !== 'unknown' && b.eventStatus !== 'unknown' && a.eventStatus !== b.eventStatus) return false;
  return !(a.domain && b.domain && a.domain !== b.domain);
}

const ROW_COLUMNS = `a.id, a.source_id, a.title, a.title_zh, a.ai_summary, a.domain, a.category, a.cluster_id, a.event_key, a.events_json,
  a.subjects_json, a.attention_score, a.quality_score, a.published_at, a.fetched_at, a.historical, a.imported_backfill, a.participant_key, a.publisher_id,
  s.name AS source_name, s.tier`;

// ---------- 召回池 ----------
class RecallPool {
  constructor(docs, minSharedGrams) {
    this.docs = [];
    this.postings = new Map();
    this.byEventKey = new Map();
    this.minShared = minSharedGrams;
    for (const doc of docs) this.add(doc);
  }

  add(doc) {
    const index = this.docs.length;
    this.docs.push(doc);
    for (const gram of doc.grams) {
      const bucket = this.postings.get(gram);
      if (bucket) bucket.push(index); else this.postings.set(gram, [index]);
    }
    if (doc.eventKey) {
      const bucket = this.byEventKey.get(doc.eventKey);
      if (bucket) bucket.push(index); else this.byEventKey.set(doc.eventKey, [index]);
    }
  }

  // 返回按事件聚合的候选：每个事件取与 doc 最像的那篇报道作为证据
  candidates(doc) {
    const shared = new Map();
    for (const gram of doc.grams) {
      for (const index of this.postings.get(gram) || []) shared.set(index, (shared.get(index) || 0) + 1);
    }
    const byStory = new Map();
    const consider = (index, overlapValue, count, flags) => {
      const other = this.docs[index];
      if (!other.storyId || other.id === doc.id) return;
      const current = byStory.get(other.storyId) || { storyId: other.storyId, overlap: 0, shared: 0, eventKey: false, structural: false, compatible: true, evidence: other };
      if (overlapValue > current.overlap) { current.overlap = overlapValue; current.shared = count; current.evidence = other; }
      if (flags.eventKey) current.eventKey = true;
      if (flags.structural) current.structural = true;
      if (!compatible(doc, other)) current.compatible = false;
      byStory.set(other.storyId, current);
    };
    for (const [index, count] of shared) {
      const other = this.docs[index];
      const smaller = Math.min(doc.grams.size, other.grams.size);
      const value = smaller ? count / smaller : 0;
      const structural = doc.actionClass && doc.actionClass === other.actionClass && [...doc.subjects].some(id => other.subjects.has(id));
      if (count >= Math.min(3, this.minShared) || structural) consider(index, value, count, { structural });
    }
    for (const index of (doc.eventKey && this.byEventKey.get(doc.eventKey)) || []) consider(index, 0, 0, { eventKey: true });
    return [...byStory.values()].sort((a, b) =>
      Number(b.eventKey && b.compatible) - Number(a.eventKey && a.compatible) || b.overlap - a.overlap);
  }
}

function loadPool(recallDays, minSharedGrams) {
  const since = new Date(Date.now() - recallDays * 86400e3).toISOString();
  const rows = db.prepare(`SELECT ${ROW_COLUMNS}
    FROM articles a JOIN sources s ON s.id = a.source_id
    JOIN clusters c ON c.id = a.cluster_id AND c.merged_into IS NULL
    WHERE a.relevant = 1 AND a.fetched_at >= ?`).all(since);
  return new RecallPool(rows.map(docOf), minSharedGrams);
}

// ---------- 模型三分类 ----------
function describe(doc) {
  return `标题：${neutralize(doc.title)}\n摘要：${neutralize(doc.summary).slice(0, 300)}${doc.eventText ? `\n主事件：${neutralize(doc.eventText)}` : ''}${doc.eventDate ? `（${doc.eventDate}）` : ''}`;
}

function normalizeJudgement(json, count) {
  if (!json || !Array.isArray(json.results)) throw new Error('归组判断响应无效');
  const out = Array.from({ length: count }, () => ({ relation: 'different', confidence: 0 }));
  for (const r of json.results) {
    const index = Number(r?.c);
    if (!Number.isInteger(index) || index < 0 || index >= count || !RELATIONS.has(r.relation)) continue;
    const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));
    out[index] = { relation: r.relation, confidence };
  }
  return out;
}

async function judge(doc, candidates, settings, confirmation = false) {
  const prompt = industry.renderPrompt('group-pair');
  const user = `<item id="NEW">\n${describe(doc)}\n</item>\n${candidates.map((c, i) => `<candidate id="${i}">\n${describe(c.evidence)}\n</candidate>`).join('\n')}`;
  const { value } = await withReceipt({
    task: confirmation ? 'group-confirm' : 'group',
    keyParts: [prompt.version, modelFor(settings), user, confirmation ? 'independent-confirmation-v1' : 'initial'],
    validate: v => Array.isArray(v) && v.length === candidates.length,
    call: async () => normalizeJudgement(extractJson(await chat([
      { role: 'system', content: prompt.text + (confirmation ? '\n这是独立复核：必须核对主体、轮次、任务批次、日期及完成状态。没有足够证据表明是同一事件或明确后续进展时返回 different。不要因为同公司或同赛道就合并。' : '') },
      { role: 'user', content: user }
    ], { settings, model: modelFor(settings), maxTokens: 400 })), candidates.length)
  });
  return value;
}

// ---------- 写入 ----------
const mainOrder = (a, b) =>
  (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0)
  || (Number(b.attention) || 0) - (Number(a.attention) || 0)
  || (a.observed || 0) - (b.observed || 0);

function refreshStory(storyId) {
  const members = db.prepare(`SELECT ${ROW_COLUMNS}, a.featured, a.breakthrough_score FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE a.cluster_id = ?`).all(storyId).map(row => ({ ...docOf(row), row }));
  if (!members.length) {
    db.prepare('DELETE FROM clusters WHERE id = ? AND merged_into IS NULL').run(storyId);
    return null;
  }
  const main = [...members].sort(mainOrder)[0];
  const times = members.map(m => m.observed).filter(Number.isFinite);
  const iso = value => (Number.isFinite(value) ? new Date(value).toISOString() : null);
  db.prepare(`UPDATE clusters SET main_article_id = ?, size = ?, updated_at = ?, title = ?, domain = ?, category = ?,
      first_report_at = ?, latest_at = ? WHERE id = ?`)
    .run(main.id, members.length, now(), main.title, main.domain, main.row.category,
      iso(Math.min(...times)), iso(Math.max(...times)), storyId);
  return { id: storyId, size: members.length, mainId: main.id };
}

const upsertSignal = db.prepare(`INSERT INTO story_signals (article_id, story_id, participant_key, participant_name, tier, observed_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(article_id) DO UPDATE SET story_id = excluded.story_id, participant_key = excluded.participant_key,
    participant_name = excluded.participant_name, tier = excluded.tier, observed_at = excluded.observed_at`);

function attach(doc, storyId, relation) {
  db.prepare('UPDATE articles SET cluster_id = ?, story_relation = ?, grouped_at = ? WHERE id = ?').run(storyId, relation, now(), doc.id);
  // 历史资料不是“现在有人在说”的证据：归入事件，但不产生热度信号
  if (!doc.historical && Number.isFinite(doc.observed)) {
    upsertSignal.run(doc.id, storyId, doc.participantKey, doc.participantName.slice(0, 60), doc.tier || 'T2', new Date(doc.observed).toISOString());
  } else {
    db.prepare('DELETE FROM story_signals WHERE article_id = ?').run(doc.id);
  }
  doc.storyId = storyId;
}

function createStory(doc) {
  const stamp = now();
  const storyId = Number(db.prepare(`INSERT INTO clusters (main_article_id, size, updated_at, title, domain, created_at)
    VALUES (?, 1, ?, ?, ?, ?)`).run(doc.id, stamp, doc.title, doc.domain, stamp).lastInsertRowid);
  attach(doc, storyId, 'primary');
  return storyId;
}

// 两个事件被同一条报道牢牢绑住：小的并进大的，旧地址留下 merged_into 指向新事件
function mergeStories(targetId, sourceId) {
  if (targetId === sourceId) return targetId;
  const size = id => db.prepare('SELECT COUNT(*) c FROM articles WHERE cluster_id = ?').get(id).c;
  const [into, from] = size(targetId) >= size(sourceId) ? [targetId, sourceId] : [sourceId, targetId];
  db.prepare("UPDATE articles SET cluster_id = ?, story_relation = CASE WHEN story_relation = 'primary' THEN 'report' ELSE story_relation END WHERE cluster_id = ?").run(into, from);
  db.prepare('UPDATE story_signals SET story_id = ? WHERE story_id = ?').run(into, from);
  db.prepare('DELETE FROM story_heat_hourly WHERE story_id = ?').run(from);
  db.prepare('UPDATE clusters SET merged_into = ?, size = 0, updated_at = ? WHERE id = ?').run(into, now(), from);
  db.prepare('UPDATE clusters SET merged_into = ? WHERE merged_into = ?').run(into, from);
  return into;
}

function storySize(storyId) {
  return db.prepare('SELECT size FROM clusters WHERE id = ?').get(storyId)?.size || 0;
}

// ---------- 主流程 ----------
async function groupPending({ settings = null, limit = 200 } = {}) {
  const config = industry.loadSelection().stories;
  migrateLegacyClusters();
  const recallCutoff = new Date(Date.now() - config.recallDays * 86400e3).toISOString();
  // 召回窗口之外的老资料不再开事件（也就没有热度），只标记已处理，避免升级后的一次性积压
  db.prepare('UPDATE articles SET grouped_at = ? WHERE relevant = 1 AND analyzed >= 1 AND grouped_at IS NULL AND fetched_at < ?')
    .run(now(), recallCutoff);
  const rows = db.prepare(`SELECT ${ROW_COLUMNS} FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE a.relevant = 1 AND a.analyzed IN (1, 3) AND a.grouped_at IS NULL AND COALESCE(a.translation_status, '') <> 'pending'
    ORDER BY COALESCE(a.published_at, a.fetched_at), a.id LIMIT ?`).all(limit);
  const stats = { processed: 0, attached: 0, created: 0, judged: 0, merged: 0, skipped: 0 };
  if (!rows.length) return stats;
  const hasKey = Boolean(settings?.ai?.apiKey);
  let judgeBudget = hasKey ? config.judgeLimitPerRound : 0;
  const pool = loadPool(config.recallDays, config.minSharedGrams);
  const touched = new Set();

  for (const row of rows) {
    const doc = docOf(row);
    stats.processed++;
    // 已被手工或旧版本挂到事件上的：只补信号与标记
    if (doc.storyId) {
      attach(doc, doc.storyId, 'report');
      touched.add(doc.storyId);
      pool.add(doc);
      continue;
    }
    const candidates = pool.candidates(doc).filter(c => storySize(c.storyId) < config.maxStorySize);
    const auto = candidates.filter(c => c.compatible && (c.eventKey
      || (c.overlap >= config.autoOverlap && c.shared >= config.minSharedGrams)));
    let target = null;
    let relation = 'report';
    if (auto.length) {
      target = auto[0].storyId;
      for (const extra of auto.slice(1)) {
        if (extra.storyId !== target && (extra.eventKey || extra.overlap >= Math.max(config.autoOverlap, 0.8))) {
          target = mergeStories(target, extra.storyId);
          stats.merged++;
        }
      }
    } else {
      const grey = candidates
        .filter(c => c.structural || (c.overlap >= config.judgeOverlap && c.shared >= Math.ceil(config.minSharedGrams / 2)))
        .slice(0, 3);
      if (grey.length && judgeBudget > 0) {
        judgeBudget--;
        stats.judged++;
        try {
          const verdicts = await judge(doc, grey, settings);
          const best = verdicts
            .map((v, i) => ({ ...v, candidate: grey[i] }))
            .filter(v => v.relation !== 'different' && v.confidence >= config.sameMinConfidence)
            .sort((a, b) => Number(b.relation === 'same') - Number(a.relation === 'same') || b.confidence - a.confidence)[0];
          if (best) {
            // AIHOT 的灰区复核：不向第二次请求泄露第一次结论；独立回执避免重复付费。
            const confirmation = best.confidence < 0.85 ? (await judge(doc, [best.candidate], settings, true))[0] : best;
            if (confirmation.relation === best.relation && confirmation.confidence >= config.sameMinConfidence) {
              target = best.candidate.storyId;
              relation = best.relation === 'development' ? 'development' : 'report';
            }
          }
        } catch (error) {
          if (error?.budgetExceeded) { judgeBudget = 0; break; }
          // 判不了就留到下一轮：不写 grouped_at
          console.warn(`[stories] 归组判断失败 #${doc.id}:`, error.message);
          continue;
        }
      }
    }
    if (target) {
      attach(doc, target, relation);
      touched.add(target);
      stats.attached++;
    } else if (doc.historical) {
      db.prepare('UPDATE articles SET grouped_at = ? WHERE id = ?').run(now(), doc.id);
      stats.skipped++;
    } else {
      touched.add(createStory(doc));
      stats.created++;
    }
    pool.add(doc);
  }
  for (const storyId of touched) refreshStory(storyId);
  return stats;
}

// ---------- 事件合并（v0.2.2） ----------
// 归组是“新报道 → 已有报道”的增量判断：同一批里各自开出的事件、或综述后标题趋同的事件，
// 之后再也不会互相比较，于是热榜上出现同一件事的两三个条目（例：星舰第 14 次试飞占了 9 个热点中的 6 个）。
// 这里对近几天活跃的事件做一次事件级比较：标题几乎相同、或主报道事件键相同且日期状态不冲突 → 直接合并；
// 相似但不确定的，有 Key 时交给同一套三分类（并独立复核），没有 Key 宁可不并。
async function consolidateStories({ settings = null, nowMs = Date.now() } = {}) {
  const config = industry.loadSelection().stories;
  const rules = { windowDays: 4, titleOverlap: 0.8, judgeOverlap: 0.5, minShared: 6, judgeLimit: 6, ...(config.consolidate || {}) };
  const since = new Date(nowMs - rules.windowDays * 86400e3).toISOString();
  const stories = db.prepare(`SELECT c.id, c.title, c.digest, c.domain, c.size, c.main_article_id FROM clusters c
    WHERE c.merged_into IS NULL AND c.size >= 1 AND c.latest_at >= ? ORDER BY c.size DESC, c.id LIMIT 800`).all(since);
  const stats = { compared: stories.length, merged: 0, judged: 0 };
  if (stories.length < 2) return stats;
  const mainRow = db.prepare(`SELECT ${ROW_COLUMNS} FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ?`);
  const items = stories.map(story => {
    const row = story.main_article_id ? mainRow.get(story.main_article_id) : null;
    const main = row ? docOf(row) : null;
    return { ...story, main, titleGrams: bigrams(story.title || main?.title || ''), fullGrams: bigrams(`${story.title || ''} ${story.digest || main?.summary || ''}`) };
  }).filter(item => item.main && item.titleGrams.size);
  const pairs = [];
  const postings = new Map();
  items.forEach((item, i) => {
    const shared = new Map();
    for (const gram of item.titleGrams) for (const j of postings.get(gram) || []) shared.set(j, (shared.get(j) || 0) + 1);
    for (const [j, count] of shared) {
      const other = items[j];
      if (item.domain && other.domain && item.domain !== other.domain) continue;
      const titleOverlap = count / Math.min(item.titleGrams.size, other.titleGrams.size);
      let fullShared = 0;
      for (const gram of item.fullGrams) if (other.fullGrams.has(gram)) fullShared++;
      const fullOverlap = fullShared / Math.min(item.fullGrams.size, other.fullGrams.size);
      const sameKey = Boolean(item.main.eventKey && item.main.eventKey === other.main.eventKey);
      if (titleOverlap >= rules.judgeOverlap || fullOverlap >= rules.judgeOverlap || sameKey) {
        pairs.push({ a: other, b: item, titleOverlap, fullOverlap, shared: count, sameKey });
      }
    }
    for (const gram of item.titleGrams) {
      const bucket = postings.get(gram);
      if (bucket) bucket.push(i); else postings.set(gram, [i]);
    }
  });
  pairs.sort((x, y) => Number(y.sameKey) - Number(x.sameKey) || y.titleOverlap - x.titleOverlap || y.fullOverlap - x.fullOverlap);
  const rootOf = id => {
    let current = id;
    for (let hops = 0; hops < 20; hops++) {
      const next = db.prepare('SELECT merged_into FROM clusters WHERE id = ?').get(current)?.merged_into;
      if (!next) return current;
      current = next;
    }
    return current;
  };
  const hasKey = Boolean(settings?.ai?.apiKey);
  let budget = hasKey ? rules.judgeLimit : 0;
  for (const pair of pairs) {
    const a = rootOf(pair.a.id), b = rootOf(pair.b.id);
    if (a === b) continue;
    if (!compatible(pair.a.main, pair.b.main)) continue;
    if (storySize(a) + storySize(b) > config.maxStorySize) continue;
    let merge = pair.sameKey || (pair.titleOverlap >= rules.titleOverlap && pair.shared >= rules.minShared);
    if (!merge && budget > 0) {
      budget--;
      stats.judged++;
      try {
        const candidate = { evidence: pair.a.main };
        const [first] = await judge(pair.b.main, [candidate], settings);
        if (first.relation !== 'different' && first.confidence >= config.sameMinConfidence) {
          const confirmation = first.confidence < 0.85 ? (await judge(pair.b.main, [candidate], settings, true))[0] : first;
          merge = confirmation.relation === first.relation && confirmation.confidence >= config.sameMinConfidence;
        }
      } catch (error) {
        if (error?.budgetExceeded) budget = 0;
        else console.warn(`[stories] 事件合并判断失败 #${a}/#${b}:`, error.message);
      }
    }
    if (!merge) continue;
    const into = mergeStories(a, b);
    refreshStory(into);
    stats.merged++;
  }
  return stats;
}

// v0.1.x 的簇原样升级为事件：成员补上关系、信号与标记，不重新判断归属
function migrateLegacyClusters() {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'storiesMigrated'").get();
  if (done) return 0;
  const clusters = db.prepare('SELECT id FROM clusters WHERE title IS NULL AND merged_into IS NULL').all();
  const selection = industry.loadSelection();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { id } of clusters) {
      const members = db.prepare(`SELECT ${ROW_COLUMNS} FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.cluster_id = ?`).all(id);
      for (const row of members) {
        const doc = docOf(row);
        const published = Date.parse(row.published_at);
        const fetched = Date.parse(row.fetched_at);
        doc.historical = doc.historical || (Number.isFinite(published) && Number.isFinite(fetched) && fetched - published > selection.historicalHours * 3600e3);
        attach(doc, id, 'report');
      }
      refreshStory(id);
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('storiesMigrated', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now());
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return clusters.length;
}

// ---------- 事件综述 ----------
async function digestStories({ settings = null } = {}) {
  const config = industry.loadSelection().stories;
  if (!settings?.ai?.apiKey || config.digestLimitPerRound <= 0) return { digested: 0 };
  const since = new Date(Date.now() - 3 * 86400e3).toISOString();
  const stories = db.prepare(`SELECT id, size FROM clusters
    WHERE merged_into IS NULL AND size >= ? AND size != digest_size AND latest_at >= ?
    ORDER BY size DESC, latest_at DESC LIMIT ?`).all(config.digestMinReports, since, config.digestLimitPerRound);
  const prompt = industry.renderPrompt('story-digest');
  let digested = 0;
  for (const story of stories) {
    const reports = db.prepare(`SELECT a.title, a.title_zh, a.ai_summary, s.name AS source_name FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ? ORDER BY a.attention_score DESC, a.id LIMIT 8`).all(story.id);
    const user = reports.map((r, i) => `<item id="${i}">来源：${neutralize(r.source_name)}\n标题：${neutralize(r.title_zh || r.title)}\n摘要：${neutralize(r.ai_summary).slice(0, 300)}</item>`).join('\n');
    try {
      const { value } = await withReceipt({
        task: 'digest',
        keyParts: [prompt.version, modelFor(settings), user],
        validate: v => v && typeof v.digest === 'string' && v.digest.trim(),
        call: async () => extractJson(await chat([
          { role: 'system', content: prompt.text },
          { role: 'user', content: user }
        ], { settings, model: modelFor(settings), maxTokens: 700 }))
      });
      const digest = [...String(value.digest).trim()].slice(0, 240).join('');
      const title = typeof value.title === 'string' && value.title.trim() ? [...value.title.trim()].slice(0, 40).join('') : null;
      db.prepare('UPDATE clusters SET digest = ?, title = COALESCE(?, title), digest_size = ?, digest_at = ? WHERE id = ?')
        .run(digest, title, story.size, now(), story.id);
      digested++;
    } catch (error) {
      if (error?.budgetExceeded) break;
      console.warn(`[stories] 事件综述失败 #${story.id}:`, error.message);
      db.prepare('UPDATE clusters SET digest_size = ? WHERE id = ?').run(story.size, story.id);
    }
  }
  return { digested };
}

module.exports = {
  groupPending,
  consolidateStories,
  judge,
  digestStories,
  migrateLegacyClusters,
  mergeStories,
  refreshStory,
  normalizeJudgement,
  RecallPool,
  docOf,
  compatible
};
