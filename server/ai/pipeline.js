'use strict';
// AI 分析管线 —— 复刻 AIHOT 的两段式架构：
//   阶段1 预筛（便宜模型，批量）：只判断「是否相关 + 属于哪个领域」，无关的直接落库不再花钱
//   阶段2 评分（强模型，单条）：只打五个维度分 + 分类 + 一句话摘要 + 标签，不打总分
//   最终质量分 = 代码公式（维度权重 × 信源等级系数 + 词库贴合 + 多源印证 − 噪声）
//   精选与否 = 代码按分类阈值 + 自适应偏移判断
// 无 API Key 时整条管线降级为词库启发式，应用照常可用
const { db, now, updateArticleFts } = require('../db');
const { loadSettings, loadScoring } = require('../config');
const { chat, extractJson } = require('./deepseek');
const kw = require('./keywords');
const lexicon = require('./lexicon');
const calibration = require('./calibration');
const { computeQuality, isFeatured } = require('./scoring');
const { normalizeModelResult } = require('./model-result');

const CATEGORIES = ['政策法规', '企业动态', '技术研发', '资本市场', '发射与任务', '应用场景', '观点报告'];

// ---------- 阶段 1：相关性预筛 ----------
const PREFILTER_SYSTEM = `你是「摘星阁」情报站的预筛员，只关注两个行业（国内外均要，不限中国）：
A=低空经济（eVTOL/飞行汽车、无人机、通用航空、低空空域政策与基建、适航取证、城市空中交通 UAM、低空应用场景等；含 Joby/Archer/Lilium/Volocopter/Wisk/Beta 等海外公司）
B=商业航天（商业火箭与可回收火箭、卫星互联网与星座、商业发射与发射场、卫星制造与测控、空天信息与卫星应用等；含 SpaceX/星链 Starlink/Blue Origin/Rocket Lab/OneWeb/Kuiper 等海外动态）
判断每条资讯是否与 A 或 B 实质相关。判为无关(rel=false)的情形：
- 仅蹭概念的股评、涨停/异动快讯、龙虎榜与主力资金、彩票式预测、研报推荐个股
- 综合财经汇总：如「四大证券报摘要」「财经晚报」「头版头条精华」「重要事件一览」「早参/晚参」等多主题打包内容——即使其中一段提到航天/低空，整篇主旨并非该领域，一律判无关
- 大盘指数、黄金原油、宏观货币、地缘冲突等与本领域无关的内容
- 只在文中顺带提及一次本领域词汇、主旨却是别的行业（如某化工企业顺带说一句配套火箭材料）——主旨不在本领域即判无关
- 纯军事武器、载人探月/深空科研等与「商业」无关的国家任务（除非涉及商业公司参与）
只有当整条资讯的核心主题就是 A 或 B 的具体事件/政策/公司动态时（无论国内外），才判 rel=true。
只输出 JSON：{"results":[{"i":序号,"rel":true/false,"d":"A"或"B"或null}]}`;

async function prefilterBatch(articles, settings) {
  const lines = articles.map((a, i) =>
    `${i}. 【${a.source_name || ''}】${a.title}${a.summary_raw ? ' —— ' + a.summary_raw.slice(0, 100) : ''}`);
  const out = await chat([
    { role: 'system', content: PREFILTER_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ], { settings, model: settings.ai.prefilterModel, maxTokens: 2000 });
  const j = extractJson(out);
  if (!j || !Array.isArray(j.results)) throw new Error('预筛响应解析失败');
  const map = new Map();
  for (const r of j.results) map.set(Number(r.i), r);
  return articles.map((a, i) => {
    const r = map.get(i);
    return {
      id: a.id,
      relevant: r ? !!r.rel : false,
      domain: r?.d === 'A' ? 'lowaltitude' : r?.d === 'B' ? 'aerospace' : null
    };
  });
}

// ---------- 阶段 2：五维评分 ----------
const SCORING_SYSTEM = `你是「摘星阁」情报站的资深分析师，领域为低空经济与商业航天（国内外均覆盖）。
对给出的一条资讯，输出 JSON（不要输出其他内容）：
{
 "scores": {
   "importance": 0-100,   // 重要性：事件本身的行业分量（政策出台、首飞、入轨、适航取证、重大融资为高）
   "novelty": 0-100,      // 新颖度：是否新信息（旧闻重提、常规宣传、例行通稿为低）
   "credibility": 0-100,  // 可信度：信息本身的确凿程度（官方发布、有具体数据与主体为高，无消息源的传闻为低）
   "impact": 0-100,       // 行业影响：对产业格局/技术路线/资本市场的影响面
   "timeliness": 0-100    // 时效性：是否正在发生或刚刚发生
 },
 "category": "${CATEGORIES.join('|')}" 之一,
 "summary": "≤80字的一句话核心摘要，信息密度优先，不要套话",
 "reason": "≤60字情报研判：点明这条为什么值得看 / 接下来要盯什么 / 利好或冲击了谁。要有判断、像行业老兵的批注，禁止复述标题与空话套话",
 "tags": ["2到4个简短标签，如 eVTOL、适航取证、可回收火箭、卫星互联网"]
}
评分要克制：平庸的日常资讯应在 40-60 区间，只有真正的行业大事才配 80+。营销软文、概念炒作、蹭热点的公司表态给低分。`;

async function scoreArticle(article, settings) {
  const user = `标题：${article.title}
信源：${article.source_name}（等级 ${article.tier}）
时间：${article.published_at || '未知'}
摘要：${(article.summary_raw || '').slice(0, 500) || '（无）'}`;
  const out = await chat([
    { role: 'system', content: SCORING_SYSTEM },
    { role: 'user', content: user }
  ], { settings, model: settings.ai.scoringModel, maxTokens: 600 });
  const j = extractJson(out);
  if (!j || !j.scores) throw new Error('评分响应解析失败');
  return j;
}

// ---------- 启发式降级（无 Key / 模型失败时） ----------
function heuristicAnalyze(a) {
  const text = a.title + ' ' + (a.summary_raw || '');
  // T2 媒体源要求标题直接命中词库；T1/T1.5 官方源放宽到全文（官方标题常含蓄）
  const profile = a.tier === 'T2' ? kw.relevanceOf(a.title) : kw.relevanceOf(text);
  if (!profile.relevant) return { relevant: false };
  const tierBase = a.tier === 'T1' ? 62 : a.tier === 'T1.5' ? 54 : 46;
  // 用词库权重和而不是命中个数：命中一个「低空经济」比命中三个「航空」更能说明问题
  const v = Math.min(95, tierBase + Math.round(profile.weightSum * 0.8));
  const scores = { importance: v, novelty: v - 5, credibility: tierBase + 15, impact: v - 8, timeliness: 60 };
  let category = '企业动态';
  if (/政策|条例|办法|规划|批复|意见|通知|标准|试点/.test(text)) category = '政策法规';
  else if (/发射|入轨|首飞|升空|回收|试飞|任务|点火/.test(text)) category = '发射与任务';
  else if (/融资|轮|上市|IPO|募资|估值|投资|基金/.test(text)) category = '资本市场';
  else if (/研发|技术|试验|测试|发动机|电池|材料|专利/.test(text)) category = '技术研发';
  else if (/应用|场景|落地|示范|运营|航线|物流|取证/.test(text)) category = '应用场景';
  const summary = (a.summary_raw || a.title).slice(0, 80);
  const REASON_TPL = {
    '政策法规': '政策风向，关注配套细则与受益主体。',
    '发射与任务': '任务节点，盯后续成败与发射节奏。',
    '资本市场': '资本动作，留意估值与产业链传导。',
    '技术研发': '技术进展，看能否量产与路线之争。',
    '应用场景': '场景落地，关注商业闭环是否跑通。',
    '企业动态': '企业动向，结合赛道格局看分量。',
    '观点报告': '观点参考，注意来源与立场。'
  };
  const reason = (a.tier === 'T1' ? '官方一手 · ' : '') + (REASON_TPL[category] || '');
  return {
    relevant: true,
    domain: profile.domain === 'both' ? 'aerospace' : profile.domain,
    result: { scores, category, summary, reason, tags: profile.terms.slice(0, 4) }
  };
}

// ---------- 主流程 ----------
async function analyzePending(onProgress, limit = 200) {
  const settings = loadSettings();
  const scoring = loadScoring();
  const hasKey = !!settings.ai.apiKey;

  const pending = db.prepare(`
    SELECT a.id, a.title, a.summary_raw, a.published_at, a.domain,
           s.name AS source_name, s.tier, s.intl
    FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE a.analyzed = 0
    ORDER BY a.id DESC LIMIT ?`).all(limit);
  if (!pending.length) return { analyzed: 0, featured: 0 };

  let analyzed = 0, featuredCount = 0;

  // 第 0 步：词库粗过滤（双保险，省 token）
  const candidates = [];
  for (const a of pending) {
    const text = a.title + ' ' + (a.summary_raw || '');
    const profile = a.tier === 'T2'
      ? kw.relevanceOf(a.title + ' ' + (a.summary_raw || '').slice(0, 80))
      : kw.relevanceOf(text);
    a._profile = profile;
    // 国外源(intl)标题多为英文，中文词库命中率低，故与 T1 一样直送 AI 预筛判定（有 Key 时）
    const sendToAi = a.tier === 'T1' || a.intl;
    if (!profile.relevant) {
      if (hasKey && sendToAi) { candidates.push(a); continue; }
      markIrrelevant(a.id);
      analyzed++;
      continue;
    }
    candidates.push(a);
  }

  if (!hasKey) {
    // —— 降级模式：纯词库启发式 ——
    for (const a of candidates) {
      const h = heuristicAnalyze(a);
      if (!h.relevant) { markIrrelevant(a.id); analyzed++; continue; }
      persistResult(a, h.domain, h.result, scoring, 3);
      if (db.prepare('SELECT featured FROM articles WHERE id=?').get(a.id).featured) featuredCount++;
      analyzed++;
      onProgress && onProgress({ done: analyzed, total: pending.length });
    }
    return { analyzed, featured: featuredCount, mode: 'heuristic' };
  }

  // —— 完整模式 ——
  // 阶段 1：批量预筛
  const relevantArts = [];
  const B = settings.ai.maxBatchPrefilter || 20;
  for (let i = 0; i < candidates.length; i += B) {
    const batch = candidates.slice(i, i + B);
    try {
      const results = await prefilterBatch(batch, settings);
      for (let k = 0; k < batch.length; k++) {
        if (results[k].relevant) {
          batch[k]._domain = results[k].domain || batch[k].domain;
          relevantArts.push(batch[k]);
        } else {
          markIrrelevant(batch[k].id);
          analyzed++;
        }
      }
    } catch (e) {
      console.error('[ai] 预筛失败，本批降级启发式:', e.message);
      for (const a of batch) {
        const h = heuristicAnalyze(a);
        if (!h.relevant) { markIrrelevant(a.id); analyzed++; }
        else { a._domain = h.domain; a._heuristic = h.result; relevantArts.push(a); }
      }
    }
    onProgress && onProgress({ stage: 'prefilter', done: Math.min(i + B, candidates.length), total: candidates.length });
  }

  // 阶段 2：逐条五维评分（小并发）
  const CONC = 3;
  let idx = 0;
  async function scoreWorker() {
    while (idx < relevantArts.length) {
      const a = relevantArts[idx++];
      try {
        const result = a._heuristic || await scoreArticle(a, settings);
        persistResult(a, a._domain, result, scoring, a._heuristic ? 3 : 1);
      } catch (e) {
        console.error(`[ai] 评分失败 #${a.id}:`, e.message);
        const h = heuristicAnalyze(a);
        if (h.relevant) persistResult(a, h.domain, h.result, scoring, 3);
        else db.prepare('UPDATE articles SET analyzed=2 WHERE id=?').run(a.id);
      }
      analyzed++;
      onProgress && onProgress({ stage: 'scoring', done: analyzed, total: pending.length });
    }
  }
  await Promise.all(Array.from({ length: CONC }, scoreWorker));

  featuredCount = db.prepare(
    `SELECT COUNT(*) c FROM articles WHERE featured=1 AND julianday(fetched_at) > julianday('now','-1 day')`).get().c;
  return { analyzed, featured: featuredCount, mode: 'full' };
}

function markIrrelevant(id) {
  db.prepare('UPDATE articles SET relevant=0, analyzed=1 WHERE id=?').run(id);
}

// 打分上下文：把「模型看不到但代码算得出」的三个信号收拢在一处，
// 首次评分与聚类后重算共用同一个函数，两条路径不会算出不同的分。
function scoringContext(article, { clusterSize = 1 } = {}) {
  const text = `${article.title || ''} ${article.ai_summary || ''} ${article.summary_raw || ''}`;
  return {
    tier: article.tier,
    lexicon: lexicon.analyze(text),
    noiseHits: kw.noiseHits(text),
    clusterSize
  };
}

function persistResult(a, domain, result, scoring, analyzedFlag) {
  result = normalizeModelResult(result, CATEGORIES);
  const context = scoringContext({ ...a, ai_summary: result.summary }, { clusterSize: 1 });
  const quality = computeQuality(result.scores, context, scoring);
  const featured = isFeatured(quality, result.category, scoring, {
    heuristic: analyzedFlag === 3,
    shift: calibration.currentShift(scoring).shift
  }) ? 1 : 0;
  db.prepare(`UPDATE articles SET
      relevant=1, analyzed=?, domain=?, category=?, scores_json=?,
      quality_score=?, featured=?, ai_summary=?, ai_reason=?, tags_json=?
    WHERE id=?`).run(
    analyzedFlag, domain || context.lexicon.domain || a.domain || 'lowaltitude', result.category,
    JSON.stringify(result.scores), quality, featured,
    result.summary || null, result.reason || null, JSON.stringify(result.tags || []), a.id);
  updateArticleFts(a.id, a.title, (result.summary || '') + ' ' + (a.summary_raw || ''));
}

// ---------- 聚类之后的重算 ----------
// 多源印证只有在聚类跑完才知道，而聚类发生在打分之后。若不回头重算，
// 「五家同时报道」这个最强的信号就永远进不了质量分。这里只做纯代码重算，不再调模型。
function rescoreAfterClustering() {
  const scoring = loadScoring();
  calibration.invalidate();
  const shift = calibration.currentShift(scoring).shift;
  const rows = db.prepare(`
    SELECT a.id, a.title, a.summary_raw, a.ai_summary, a.category, a.scores_json,
           a.quality_score, a.featured, a.analyzed, s.tier,
           COALESCE(c.size, 1) AS cluster_size
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters c ON c.id = a.cluster_id
    WHERE a.relevant = 1 AND a.scores_json IS NOT NULL
      AND julianday(a.fetched_at) > julianday('now', ?)`)
    .all(`-${scoring.clusterWindowHours || 72} hours`);

  const update = db.prepare('UPDATE articles SET quality_score=?, featured=? WHERE id=?');
  let changed = 0;
  for (const row of rows) {
    let scores;
    try { scores = JSON.parse(row.scores_json); } catch { continue; }
    const quality = computeQuality(scores, scoringContext(row, { clusterSize: row.cluster_size }), scoring);
    const featured = isFeatured(quality, row.category, scoring, {
      heuristic: row.analyzed === 3, shift
    }) ? 1 : 0;
    if (quality === row.quality_score && featured === row.featured) continue;
    update.run(quality, featured, row.id);
    changed++;
  }
  return { rescored: rows.length, changed, shift };
}

module.exports = { analyzePending, rescoreAfterClustering, scoringContext, CATEGORIES };
