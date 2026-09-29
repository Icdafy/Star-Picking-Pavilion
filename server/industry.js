'use strict';
// 行业包加载器 —— v0.2.0 起，“什么算重要、什么算噪声、多少分算入选”全部写在 config/industry/，
// 代码只负责执行。学 AIHOT：改标准不改代码。
//
//   site.json        站名、行业、读者画像（提示词里的 {{siteName}} / {{readers}}）
//   taxonomy.json    内容类型（→ 分类 + 五轴权重）、标签白名单、融资轮次
//   selection.json   分级门槛、热度与归组参数、预算
//   companies.json   公司库（一级市场标的身份信息）
//   prompts/*.md     每一步的提示词；{{变量}} 与 {{> 片段}} 在这里展开
//
// 提示词的版本就是它展开后内容的哈希：改了提示词，之后的新资料按新版判断，已经判过的不重算。
// 契约：读取失败永不抛异常，回落到上次成功加载的内容或内置默认值，管线不会因为一个坏文件停摆。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const INDUSTRY_DIR = path.join(__dirname, '..', 'config', 'industry');
const PROMPT_DIR = path.join(INDUSTRY_DIR, 'prompts');

const AXES = Object.freeze(['sig', 'nov', 'cred', 'reson', 'act']);

const DEFAULT_SITE = Object.freeze({
  siteName: '摘星阁',
  industry: '低空经济与商业航天',
  domains: { lowaltitude: '低空经济', aerospace: '商业航天' },
  readers: '低空经济与商业航天的一级股权投资人、产业研究员和从业者。'
});

const DEFAULT_TAXONOMY = Object.freeze({
  version: 1,
  axes: { sig: '实质份量', nov: '信息增量', cred: '证据强度', reson: '共振面', act: '投资可行动性' },
  itemTypes: [
    { id: 'industry_move', label: '企业与产业动态', category: '企业动态', hint: '', weights: { sig: 2, nov: 2, cred: 2, reson: 2, act: 2 } }
  ],
  topicTags: [],
  rounds: ['未披露']
});

const DEFAULT_SELECTION = Object.freeze({
  thresholds: { T1: 55, 'T1.5': 59, T2: 63 },
  understandFloor: 40,
  heuristicDiscount: 0.9,
  historicalHours: 48,
  hot: { windowHours: 48, halfLifeHours: 24, minParticipants: 2, maxEntries: 20, breakthroughWeight: 0.25, risingPct: 0.15, surgeMinRecent: 3, newHours: 6 },
  stories: { recallDays: 14, autoOverlap: 0.62, judgeOverlap: 0.34, minSharedGrams: 6, maxStorySize: 40, judgeLimitPerRound: 24, sameMinConfidence: 0.6, digestMinReports: 3, digestLimitPerRound: 3 },
  companies: { heatWindowDays: 7, halfLifeHours: 72 },
  budget: { maxCallsPerHour: 900, maxCallsPerDay: 9000 }
});

const cache = new Map();

// mtime 作缓存键：用户改了行业包里的文件，下一轮分析立刻读到新版本，不需要重启。
function readCached(file, parse) {
  let stat;
  try { stat = fs.statSync(file); } catch { return cache.get(file)?.value ?? null; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
  try {
    const value = parse(fs.readFileSync(file, 'utf8'));
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch (error) {
    console.warn(`[industry] 读取 ${path.basename(file)} 失败（${error.message}），沿用上次成功加载的内容`);
    return hit?.value ?? null;
  }
}

function readJson(name) {
  return readCached(path.join(INDUSTRY_DIR, name), text => JSON.parse(text));
}

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function loadSite() {
  const raw = readJson('site.json') || {};
  return {
    siteName: typeof raw.siteName === 'string' && raw.siteName.trim() ? raw.siteName.trim() : DEFAULT_SITE.siteName,
    industry: typeof raw.industry === 'string' && raw.industry.trim() ? raw.industry.trim() : DEFAULT_SITE.industry,
    domains: { ...DEFAULT_SITE.domains, ...(raw.domains && typeof raw.domains === 'object' ? raw.domains : {}) },
    readers: typeof raw.readers === 'string' && raw.readers.trim() ? raw.readers.trim() : DEFAULT_SITE.readers
  };
}

function validWeights(weights) {
  if (!weights || typeof weights !== 'object') return null;
  const out = {};
  let sum = 0;
  for (const axis of AXES) {
    const value = Number(weights[axis]);
    if (!Number.isInteger(value) || value < 0 || value > 10) return null;
    out[axis] = value;
    sum += value;
  }
  // 每行权重之和为 10，五轴 0–10 的加权结果才天然落在 0–100
  return sum === 10 ? out : null;
}

function loadTaxonomy() {
  const raw = readJson('taxonomy.json');
  if (!raw || !Array.isArray(raw.itemTypes)) return structuredClone(DEFAULT_TAXONOMY);
  const itemTypes = [];
  for (const type of raw.itemTypes) {
    const weights = validWeights(type?.weights);
    if (!type?.id || !type.category || !weights) {
      console.warn(`[industry] 内容类型 ${type?.id || '?'} 配置无效（缺分类或权重和不为 10），已跳过`);
      continue;
    }
    itemTypes.push({ id: String(type.id), label: String(type.label || type.id), category: String(type.category), hint: String(type.hint || ''), weights });
  }
  if (!itemTypes.length) return structuredClone(DEFAULT_TAXONOMY);
  const strings = value => Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))] : [];
  return {
    version: Number(raw.version) || 1,
    axes: { ...DEFAULT_TAXONOMY.axes, ...(raw.axes || {}) },
    itemTypes,
    topicTags: strings(raw.topicTags),
    rounds: strings(raw.rounds).length ? strings(raw.rounds) : [...DEFAULT_TAXONOMY.rounds]
  };
}

function loadSelection() {
  const raw = readJson('selection.json') || {};
  const d = DEFAULT_SELECTION;
  const thresholds = {};
  for (const [tier, fallback] of Object.entries(d.thresholds)) {
    thresholds[tier] = finite(raw.thresholds?.[tier], fallback, 0, 100);
  }
  const section = (name, limits) => {
    const out = {};
    for (const [key, fallback] of Object.entries(d[name])) {
      const [min, max] = limits[key] || [0, Infinity];
      out[key] = finite(raw[name]?.[key], fallback, min, max);
    }
    return out;
  };
  return {
    thresholds,
    understandFloor: finite(raw.understandFloor, d.understandFloor, 0, 100),
    heuristicDiscount: finite(raw.heuristicDiscount, d.heuristicDiscount, 0.1, 1),
    historicalHours: finite(raw.historicalHours, d.historicalHours, 1, 24 * 30),
    hot: section('hot', { windowHours: [1, 24 * 14], halfLifeHours: [1, 24 * 14], minParticipants: [1, 20], maxEntries: [1, 100], breakthroughWeight: [0, 2], risingPct: [0, 10], surgeMinRecent: [1, 50], newHours: [1, 72] }),
    stories: section('stories', { recallDays: [1, 60], autoOverlap: [0.1, 1], judgeOverlap: [0.05, 1], minSharedGrams: [1, 50], maxStorySize: [2, 500], judgeLimitPerRound: [0, 500], sameMinConfidence: [0, 1], digestMinReports: [2, 50], digestLimitPerRound: [0, 50] }),
    companies: section('companies', { heatWindowDays: [1, 90], halfLifeHours: [1, 24 * 60] }),
    budget: section('budget', { maxCallsPerHour: [1, 100000], maxCallsPerDay: [1, 1000000] })
  };
}

function loadCompanySeed() {
  const raw = readJson('companies.json');
  const list = Array.isArray(raw?.companies) ? raw.companies : [];
  return {
    version: Number(raw?.version) || 1,
    companies: list.filter(c => c && typeof c.id === 'string' && /^[a-z0-9-]{2,48}$/.test(c.id) && typeof c.name === 'string' && c.name.trim())
  };
}

// ---------- 内容类型与五轴 ----------

function itemTypeById(id, taxonomy = loadTaxonomy()) {
  return taxonomy.itemTypes.find(type => type.id === id) || null;
}

function categoryOfItemType(id, taxonomy = loadTaxonomy()) {
  return itemTypeById(id, taxonomy)?.category || null;
}

function clampAxis(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : 0;
}

// attention = Σ 轴分 × 类型权重。五轴 0–10、每行权重和 10 → 结果 0–100 的整数。
// 这一步交给代码：模型只做它独有的语义判断，合成、取整、门槛比较都由脚本完成。
function computeAttention(itemType, axes, taxonomy = loadTaxonomy()) {
  const type = itemTypeById(itemType, taxonomy) || taxonomy.itemTypes.find(t => t.id === 'industry_move') || taxonomy.itemTypes[0];
  let total = 0;
  for (const axis of AXES) total += clampAxis(axes?.[axis]) * type.weights[axis];
  return { itemType: type.id, score: Math.max(0, Math.min(100, total)) };
}

// ---------- 提示词 ----------

function itemTypeGuide(taxonomy) {
  return taxonomy.itemTypes.map(type => `- \`${type.id}\`（${type.label}）：${type.hint}`).join('\n');
}

function weightTable(taxonomy) {
  const head = `| 类型 | ${AXES.join(' | ')} |\n|---|${AXES.map(() => '---:').join('|')}|`;
  const rows = taxonomy.itemTypes.map(type => `| ${type.id} | ${AXES.map(axis => type.weights[axis]).join(' | ')} |`);
  return [head, ...rows].join('\n');
}

function defaultPromptVars() {
  const site = loadSite();
  const taxonomy = loadTaxonomy();
  return {
    siteName: site.siteName,
    industry: site.industry,
    readers: site.readers,
    domainLowaltitude: site.domains.lowaltitude,
    domainAerospace: site.domains.aerospace,
    itemTypeGuide: itemTypeGuide(taxonomy),
    weightTable: weightTable(taxonomy),
    topicTags: taxonomy.topicTags.join('、'),
    rounds: taxonomy.rounds.join('、')
  };
}

function readPromptFile(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`提示词名称无效: ${name}`);
  return readCached(path.join(PROMPT_DIR, `${name}.md`), text => text);
}

function expand(template, vars, depth = 0) {
  if (depth > 4) throw new Error('提示词片段嵌套过深');
  return template
    .replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/g, (_, partial) => {
      const body = readPromptFile(partial);
      if (body == null) throw new Error(`提示词片段缺失: ${partial}`);
      return expand(body.trim(), vars, depth + 1);
    })
    .replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match));
}

function promptVersion(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

// 返回 { text, version }。提示词文件缺失属于安装包损坏，直接抛出，由调用方走启发式降级。
function renderPrompt(name, extraVars = {}) {
  const template = readPromptFile(name);
  if (template == null) throw new Error(`提示词缺失: ${name}`);
  const text = expand(template, { ...defaultPromptVars(), ...extraVars }).trim();
  return { text, version: promptVersion(text) };
}

function listPrompts() {
  try {
    return fs.readdirSync(PROMPT_DIR).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  } catch { return []; }
}

module.exports = {
  AXES,
  INDUSTRY_DIR,
  loadSite,
  loadTaxonomy,
  loadSelection,
  loadCompanySeed,
  itemTypeById,
  categoryOfItemType,
  computeAttention,
  clampAxis,
  renderPrompt,
  promptVersion,
  listPrompts,
  DEFAULT_SELECTION
};
