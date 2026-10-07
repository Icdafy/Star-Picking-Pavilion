'use strict';
// 判断与写作 —— AIHOT editorial/analyze.ts 的桌面版。三步花钱，其余全部是代码：
//
//   预筛（prefilter.md）      批量，宽进：PASS / BLOCK / UNKNOWN。UNKNOWN 补正文后再判，不直接丢
//   评分（selection-score.md）同一份标准、互不可见地独立打两次：模型给内容类型 + 五轴（0–10），
//                              代码按类型权重合成 0–100；两次之和 ≥ 2 × 门槛才入选
//   理解（content-understanding.md）一次读完：内容类型、作者角色、标签、自洽标题、答案先行摘要、
//                              推荐理由、主体公司、核心事实、原子事件、融资事件
//
// 评分输入故意不带信源名称与等级（AIHOT：不让名气替事件加分）；理解输入带信源，只用来理解材料。
// 每一步的输出都在这里做形状校验与收口，下游只拿到干净的结构。
const { chat, extractJson } = require('./deepseek');
const { modelFor, modelIdentity } = require('./model-policy');
const industry = require('../industry');
const { withReceipt } = require('./receipts');
const { stripTagMarkup } = require('../html-text');

const PREFILTER_LABELS = new Set(['PASS', 'BLOCK', 'UNKNOWN']);
const AUTHOR_ROLES = new Set(['principal', 'observer', 'relayer']);
const ENTITY_TYPES = new Set(['org', 'product', 'facility', 'place', 'person', 'policy']);

function parseFailure(message) {
  const error = new Error(message);
  error.parseFailure = true;
  return error;
}

function clip(value, max) {
  if (typeof value !== 'string') return '';
  return [...value.trim().replace(/\s+/g, ' ')].slice(0, max).join('');
}

// 标题、摘要、正文里的 </item> 之类标记会破坏分隔：包进去之前抹掉
function neutralize(value) {
  const text = String(value || '').replace(/<\s*(\/?)\s*(item|candidate)\b/gi, '<$1$2');
  const clean = stripTagMarkup(text, tag => /^<\/?(?:item|candidate)\b/i.test(tag) ? ' ' : tag);
  // 纯文本可能把分隔符写在其它标签的属性内；这些仍是模型可见数据，也必须失活。
  return clean.replace(/<(?=\/?(?:item|candidate)\b)/gi, '‹');
}

// ---------- 预筛 ----------

function prefilterItem(article, index) {
  const summary = neutralize(article.summary_raw).slice(0, 160);
  const body = neutralize(article.content_text).slice(0, 360);
  return `<item id="${index}">标题：${neutralize(article.title)}${summary ? `\n摘要：${summary}` : ''}${body ? `\n正文片段：${body}` : ''}</item>`;
}

// 序号必须与批次一一对应：数量不符、越界、重复、标签非法一律整批判解析失败，
// 由调用方走启发式降级——缺项若静默判无关，等于给模型没看过的内容写死终态
function normalizePrefilter(json, count) {
  if (!json || !Array.isArray(json.results) || json.results.length !== count) throw parseFailure('预筛响应解析失败');
  const seen = new Map();
  for (const r of json.results) {
    const index = Number(r?.i);
    const label = String(r?.label || '').toUpperCase();
    if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index) || !PREFILTER_LABELS.has(label)) {
      throw parseFailure('预筛响应序号异常');
    }
    seen.set(index, {
      label,
      domain: r.d === 'A' ? 'lowaltitude' : r.d === 'B' ? 'aerospace' : null,
      reason: clip(r.reason, 30)
    });
  }
  return Array.from({ length: count }, (_, i) => seen.get(i));
}

async function prefilterBatch(articles, settings) {
  const prompt = industry.renderPrompt('prefilter');
  const user = articles.map(prefilterItem).join('\n');
  const { value } = await withReceipt({
    task: 'prefilter',
    keyParts: [prompt.version, modelIdentity(settings), user],
    validate: v => Array.isArray(v) && v.length === articles.length,
    call: async () => {
      const out = await chat([
        { role: 'system', content: prompt.text },
        { role: 'user', content: user }
      ], { settings, model: modelFor(settings), maxTokens: 120 + articles.length * 60 });
      return normalizePrefilter(extractJson(out), articles.length);
    }
  });
  return articles.map((article, i) => ({ id: article.id, ...value[i], promptVersion: prompt.version }));
}

// ---------- 评分（两次独立） ----------

function scoringItem(article, vision) {
  const images = Array.isArray(vision?.images) ? vision.images.map(i => clip(i?.caption, 120)).filter(Boolean).slice(0, 4) : [];
  return `<item id="0">
标题：${neutralize(article.title)}
时间：${article.published_at || '未知'}
摘要：${neutralize(article.summary_raw).slice(0, 1500) || '（无）'}
正文：${neutralize(article.content_text).slice(0, 6000) || '（无）'}${images.length ? `\n图片可见内容：${images.join('；')}` : ''}
</item>`;
}

function normalizeScore(json, taxonomy = industry.loadTaxonomy()) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw parseFailure('评分响应解析失败');
  const axes = {};
  for (const axis of industry.AXES) {
    const number = Number(json[axis]);
    if (!Number.isFinite(number)) throw parseFailure(`评分响应缺少 ${axis}`);
    axes[axis] = industry.clampAxis(number);
  }
  const itemType = industry.itemTypeById(json.itemType, taxonomy) ? json.itemType : null;
  const attention = industry.computeAttention(itemType || 'industry_move', axes, taxonomy);
  return { itemType: attention.itemType, axes, score: attention.score };
}

// pass 进入回执键：两次评分是两次独立判断，不能互相复用
async function scorePass(article, pass, settings, vision) {
  const prompt = industry.renderPrompt('selection-score');
  const user = scoringItem(article, vision);
  const { value } = await withReceipt({
    task: `score-${pass}`,
    keyParts: [prompt.version, modelIdentity(settings), user],
    validate: v => v && Number.isFinite(v.score),
    call: async () => {
      const out = await chat([
        { role: 'system', content: prompt.text },
        { role: 'user', content: user }
      ], { settings, model: modelFor(settings), maxTokens: 300, temperature: 0.7 });
      return normalizeScore(extractJson(out));
    }
  });
  return { ...value, promptVersion: prompt.version };
}

// ---------- 内容理解 ----------

function understandingItem(article, vision) {
  const images = Array.isArray(vision?.images) ? vision.images.slice(0, 4).map(i => ({ caption: clip(i?.caption, 150), kind: clip(i?.kind, 20) })) : [];
  return `<item id="0">
标题：${neutralize(article.title)}
信源：${neutralize(article.source_name)}
发布时间：${article.published_at || '未知'}
摘要：${neutralize(article.summary_raw).slice(0, 2000) || '（无）'}
正文：${neutralize(article.content_text).slice(0, 10000) || '（无）'}
图片可见证据（不是独立消息源，不能据此确认时间）：${JSON.stringify(images)}
日期规则：报道日期不等于事件日期；回顾、计划和实际完成必须区分。每个事件提供逐字证据句，没有日期证据就留空，不得推测。
</item>`;
}

function normalizeFact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = clip(raw.title, 30);
  if (!title) return null;
  // 格式对了还要是真实日历日：2026-13-40 这类模型笔误不能进归组的事实键
  const parsed = typeof raw.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.occurredAt)
    ? Date.parse(`${raw.occurredAt}T00:00:00Z`) : NaN;
  const occurredAt = Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(raw.occurredAt) ? raw.occurredAt : null;
  return { title, subject: clip(raw.subject, 40), action: clip(raw.action, 30), object: clip(raw.object, 40), occurredAt };
}

function normalizeUnderstanding(json, taxonomy = industry.loadTaxonomy()) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw parseFailure('内容理解响应解析失败');
  const type = industry.itemTypeById(json.itemType, taxonomy);
  if (!type) throw parseFailure('内容理解缺少合法的 itemType');
  const summaryZh = clip(json.summaryZh, 220);
  const titleZh = clip(json.titleZh, 60);
  if (!summaryZh && !titleZh) throw parseFailure('内容理解缺少标题与摘要');
  const allowedTags = new Set(taxonomy.topicTags);
  const tags = [];
  for (const tag of Array.isArray(json.tags) ? json.tags : []) {
    const value = clip(tag, 16);
    if (value && (allowedTags.size === 0 || allowedTags.has(value)) && !tags.includes(value)) tags.push(value);
    if (tags.length === 5) break;
  }
  const entities = (Array.isArray(json.entities) ? json.entities : [])
    .filter(e => e && typeof e === 'object' && clip(e.n ?? e.name, 60))
    .slice(0, 8)
    .map(e => ({ n: clip(e.n ?? e.name, 60), t: ENTITY_TYPES.has(e.t) ? e.t : 'org' }));
  const events = (Array.isArray(json.events) ? json.events : [])
    .filter(e => e && typeof e === 'object' && (typeof (e.a ?? e.actor) === 'string') && (e.a ?? e.actor).trim())
    .slice(0, 8);
  const subjects = [];
  for (const name of Array.isArray(json.subjects) ? json.subjects : []) {
    const value = clip(name, 40);
    if (value && !subjects.includes(value)) subjects.push(value);
    if (subjects.length === 4) break;
  }
  return {
    itemType: type.id,
    category: type.category,
    authorRole: AUTHOR_ROLES.has(json.authorRole) ? json.authorRole : 'relayer',
    tags,
    titleZh,
    summaryZh,
    editorialJudgment: clip(json.editorialJudgment, 90),
    subjects,
    fact: normalizeFact(json.fact),
    entities,
    events,
    deal: json.deal && typeof json.deal === 'object' && !Array.isArray(json.deal) ? json.deal : null
  };
}

async function understand(article, settings, vision) {
  const prompt = industry.renderPrompt('content-understanding');
  const user = understandingItem(article, vision);
  const { value } = await withReceipt({
    task: 'understand',
    keyParts: [prompt.version, modelIdentity(settings), user],
    validate: v => v && typeof v.itemType === 'string',
    call: async () => {
      const out = await chat([
        { role: 'system', content: prompt.text },
        { role: 'user', content: user }
      ], { settings, model: modelFor(settings), maxTokens: 3200 });
      return normalizeUnderstanding(extractJson(out));
    }
  });
  return { ...value, promptVersion: prompt.version };
}

// ---------- 入选判定（纯代码） ----------

// 两次之和 ≥ 2 × 门槛。展示分是两次平均向下取整——与门槛比较的永远是和，
// 避免“平均 66.5 显示成 66，却因为 133 ≥ 132 入选”这种对不上的观感问题被误读为 bug。
function decideSelection({ scoreA, scoreB, tier, heuristic = false }, selection = industry.loadSelection()) {
  const base = selection.thresholds[tier] ?? selection.thresholds.T2 ?? 67;
  const threshold = Math.round((heuristic ? base * selection.heuristicDiscount : base) * 10) / 10;
  const a = Math.max(0, Math.min(100, Number(scoreA) || 0));
  const b = Math.max(0, Math.min(100, Number(scoreB) || 0));
  return {
    threshold,
    attention: Math.floor((a + b) / 2),
    selected: a + b >= 2 * threshold
  };
}

// 两次评分的五轴取平均、换算到 0–100，给界面的“五维研判”展示
function averagedAxes(passA, passB) {
  const names = { sig: 'significance', nov: 'novelty', cred: 'credibility', reson: 'resonance', act: 'actionability' };
  const out = {};
  for (const axis of industry.AXES) {
    const a = Number(passA?.axes?.[axis]);
    const b = Number(passB?.axes?.[axis]);
    const values = [a, b].filter(Number.isFinite);
    out[names[axis]] = values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length * 10) : 0;
  }
  return out;
}

module.exports = {
  normalizePrefilter,
  normalizeScore,
  normalizeUnderstanding,
  normalizeFact,
  prefilterBatch,
  scorePass,
  understand,
  decideSelection,
  averagedAxes,
  neutralize
};
