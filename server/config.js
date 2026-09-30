'use strict';
// 配置体系：settings.json（用户可改；模型提供商与分析模型，密钥另经 safeStorage 加密保存）+ scoring.json（计分公式参数）
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');
const { HttpError, validateAiBaseUrl } = require('./http-security');
const { getApiKey, setApiKey, getProviderKey } = require('./runtime-credentials');
const catalog = require('./ai/model-catalog');

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const SCORING_PATH = path.join(__dirname, '..', 'config', 'scoring.json');
const BREAKTHROUGHS_PATH = path.join(__dirname, '..', 'config', 'breakthroughs.json');

// 默认分析模型：DeepSeek V4 Flash Vision；v0.2.3 起可在「模型」设置中换成任意已配置提供商的模型。
const DEEPSEEK_MODEL = catalog.DEFAULT_MODEL;
const DEEPSEEK_MODEL_RELEASE = catalog.DEFAULT_MODEL_NAME;
// 运行时派生字段：由 providers + activeProvider 解析得出，只存在于内存，不落盘。
const DERIVED_AI_FIELDS = ['apiKey', 'baseUrl', 'api', 'modelInput', 'providerName'];

const DEFAULT_SETTINGS = {
  // —— AI 分析层（DeepSeek，OpenAI 兼容协议；留好接口，可换任意兼容服务）——
  ai: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    activeProvider: catalog.DEFAULT_PROVIDER, // 分析模型所属的提供商
    model: DEEPSEEK_MODEL,             // 分析模型（所有任务共用）
    providers: { deepseek: {} },       // 已添加的提供商：端点 / 协议 / 模型目录覆盖
    maxBatchPrefilter: 20,             // 预筛单次批量
    requestTimeoutMs: 60000
  },
  // —— 采集 ——
  collect: {
    intervalMinutes: 10,               // 采集循环间隔（缩短以更实时）
    analyzeIntervalSeconds: 75,        // 分析循环间隔（秒）：持续给新采集项打分，实时跟上
    keepDays: 30,                      // 入库保留天数（过老的抓取项直接丢弃）
    retentionDays: 180,                // 已入库情报的保留天数（到期自动清理，含 FTS 索引）
    irrelevantRetentionDays: 21,       // 判为无关的噪声保留天数（更短，避免噪声撑大库）
    requestTimeoutMs: 20000,
    rsshubBase: '',                    // RSSHub 实例地址（如 https://rsshub.app）；填后 rsshub:// 型信源生效
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  dailyReportHour: 8                   // 每天 8 点生成日报
};

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function boundedText(value, fallback, maximum) {
  return typeof value === 'string' && value.trim() && value.length <= maximum && !/\p{Cc}/u.test(value)
    ? value.trim()
    : fallback;
}

function normalizedRsshubBase(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 2048) return '';
  const normalized = value.trim().replace(/\/$/, '');
  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? normalized : '';
  } catch {
    return '';
  }
}

// v0.2.2 及更早只有单一端点：ai.baseUrl 属于 DeepSeek，模型被锁定为 Flash Vision。
// 没有 providers 字段的旧文件按这个口径迁入 providers.deepseek。
function migrateLegacyProviders(raw) {
  const ai = raw?.ai && typeof raw.ai === 'object' ? raw.ai : {};
  if (ai.providers && typeof ai.providers === 'object' && !Array.isArray(ai.providers)) {
    return { providers: ai.providers, activeProvider: ai.activeProvider, model: ai.model };
  }
  const legacyBase = boundedText(ai.baseUrl, '', 2048).replace(/\/+$/, '');
  const deepseek = legacyBase && legacyBase !== DEFAULT_SETTINGS.ai.baseUrl ? { baseUrl: legacyBase } : {};
  return { providers: { deepseek }, activeProvider: catalog.DEFAULT_PROVIDER, model: DEEPSEEK_MODEL };
}

// 把 providers / activeProvider / model 解析成运行时直接可用的派生字段。
function applyActiveModel(settings) {
  const active = catalog.resolveActive(settings.ai.providers, settings.ai.activeProvider, settings.ai.model);
  settings.ai.activeProvider = active.provider;
  settings.ai.model = active.model;
  settings.ai.baseUrl = active.described.baseUrl;
  settings.ai.api = active.described.api;
  settings.ai.providerName = active.described.displayName;
  settings.ai.modelInput = Array.isArray(active.entry?.input) ? [...active.entry.input] : null;
  return active;
}

function activeApiKey(settings) {
  const provider = settings.ai.activeProvider;
  const key = getProviderKey(provider);
  if (key) return key;
  return catalog.describeProvider(provider, settings.ai.providers[provider]).keyOptional
    ? catalog.KEYLESS_PLACEHOLDER
    : '';
}

function normalizeSettings(raw) {
  const legacy = migrateLegacyProviders(raw);
  const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
  settings.ai.providers = catalog.sanitizeProviders(legacy.providers);
  settings.ai.activeProvider = typeof legacy.activeProvider === 'string'
    ? legacy.activeProvider
    : catalog.DEFAULT_PROVIDER;
  settings.ai.model = boundedText(legacy.model, DEEPSEEK_MODEL, 200);
  for (const field of DERIVED_AI_FIELDS) delete settings.ai[field];
  applyActiveModel(settings);
  settings.ai.maxBatchPrefilter = boundedInteger(settings.ai.maxBatchPrefilter, 1, 50, DEFAULT_SETTINGS.ai.maxBatchPrefilter);
  settings.ai.requestTimeoutMs = boundedInteger(settings.ai.requestTimeoutMs, 1000, 120000, DEFAULT_SETTINGS.ai.requestTimeoutMs);
  settings.collect.intervalMinutes = boundedInteger(settings.collect.intervalMinutes, 10, 720, DEFAULT_SETTINGS.collect.intervalMinutes);
  settings.collect.analyzeIntervalSeconds = boundedInteger(
    settings.collect.analyzeIntervalSeconds, 20, 3600, DEFAULT_SETTINGS.collect.analyzeIntervalSeconds
  );
  settings.collect.keepDays = boundedInteger(settings.collect.keepDays, 1, 3650, DEFAULT_SETTINGS.collect.keepDays);
  settings.collect.retentionDays = boundedInteger(
    settings.collect.retentionDays, 7, 3650, DEFAULT_SETTINGS.collect.retentionDays
  );
  settings.collect.irrelevantRetentionDays = boundedInteger(
    settings.collect.irrelevantRetentionDays, 1, 3650, DEFAULT_SETTINGS.collect.irrelevantRetentionDays
  );
  settings.collect.requestTimeoutMs = boundedInteger(
    settings.collect.requestTimeoutMs, 1000, 120000, DEFAULT_SETTINGS.collect.requestTimeoutMs
  );
  settings.collect.rsshubBase = normalizedRsshubBase(settings.collect.rsshubBase);
  settings.collect.userAgent = boundedText(settings.collect.userAgent, DEFAULT_SETTINGS.collect.userAgent, 500);
  settings.dailyReportHour = boundedInteger(settings.dailyReportHour, 0, 23, DEFAULT_SETTINGS.dailyReportHour);
  return settings;
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const legacyKey = String(raw?.ai?.apiKey || '').trim();
    if (!getApiKey() && legacyKey) setApiKey(legacyKey);
    const settings = normalizeSettings(raw);
    settings.ai.apiKey = activeApiKey(settings);
    return settings;
  } catch {
    const settings = normalizeSettings({});
    settings.ai.apiKey = activeApiKey(settings);
    return settings;
  }
}

async function saveSettings(settings, options = {}) {
  const sanitized = normalizeSettings(settings);
  for (const field of DERIVED_AI_FIELDS) delete sanitized.ai[field];
  const temporary = `${SETTINGS_PATH}.${process.pid}-${Date.now()}.tmp`;
  const rename = options.rename || fs.promises.rename;
  await fs.promises.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(sanitized, null, 2), 'utf8');
    await rename(temporary, SETTINGS_PATH);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function applySettingsPatch(currentSettings, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new HttpError(400, '设置请求体必须是对象');
  }
  if (Object.keys(patch).some(key => !['ai', 'collect'].includes(key))) {
    throw new HttpError(400, '包含不支持的设置字段');
  }
  if (patch.ai !== undefined && (!patch.ai || typeof patch.ai !== 'object' || Array.isArray(patch.ai))) {
    throw new HttpError(400, 'AI 设置必须是对象');
  }
  if (patch.collect !== undefined && (!patch.collect || typeof patch.collect !== 'object' || Array.isArray(patch.collect))) {
    throw new HttpError(400, '采集设置必须是对象');
  }
  if (patch.ai && Object.keys(patch.ai).some(key => !['apiKey', 'baseUrl', 'model'].includes(key))) {
    throw new HttpError(400, '包含不支持的 AI 设置字段');
  }
  if (patch.collect && Object.keys(patch.collect).some(
    key => !['intervalMinutes', 'rsshubBase', 'retentionDays', 'irrelevantRetentionDays'].includes(key)
  )) {
    throw new HttpError(400, '包含不支持的采集设置字段');
  }
  const settings = structuredClone(currentSettings);
  // 旧版单端点接口（设置页之外的调用方与测试仍在用）作用于当前分析模型所属的提供商
  const credentialProvider = settings.ai.activeProvider || catalog.DEFAULT_PROVIDER;
  const providerProfile = () => settings.ai.providers?.[credentialProvider];
  const currentKey = String(getProviderKey(credentialProvider) || '');
  let apiKey = currentKey;
  let credentialChanged = false;

  if (patch?.ai) {
    const incomingKey = patch.ai.apiKey;
    const replacementKey = typeof incomingKey === 'string' ? incomingKey.trim() : '';
    const suppliesKey = replacementKey.length > 0;
    if (patch.ai.baseUrl !== undefined) {
      const baseUrl = String(patch.ai.baseUrl).trim().replace(/\/$/, '');
      if (baseUrl.length > 2048 || !validateAiBaseUrl(baseUrl)) {
        throw new HttpError(400, 'AI 基础地址必须使用 HTTPS（本机回环地址除外）');
      }
      if (baseUrl !== settings.ai.baseUrl && !suppliesKey) {
        apiKey = '';
        credentialChanged = Boolean(currentKey);
      }
      const described = catalog.describeProvider(credentialProvider, providerProfile());
      const profile = { ...(providerProfile() || {}) };
      if (baseUrl !== described.defaultBaseUrl) profile.baseUrl = baseUrl;
      else delete profile.baseUrl;
      settings.ai.providers = { ...settings.ai.providers, [credentialProvider]: profile };
      settings.ai.baseUrl = baseUrl;
    }
    if (incomingKey === null) {
      apiKey = '';
      credentialChanged = Boolean(currentKey);
    } else if (suppliesKey) {
      if (replacementKey.includes('****')) throw new Error('API Key 不能使用掩码值');
      apiKey = replacementKey;
      credentialChanged = apiKey !== currentKey;
    }
    if (patch.ai.model !== undefined) {
      const model = typeof patch.ai.model === 'string' ? patch.ai.model.trim() : '';
      if (!model || model.length > 200 || /\p{Cc}/u.test(model)) {
        throw new HttpError(400, '模型名称必须是 1 到 200 个字符的文本');
      }
      const described = catalog.describeProvider(credentialProvider, providerProfile());
      if (!described.models.some(entry => entry.id === model)) {
        throw new HttpError(400, `${model} 不在「${described.displayName}」的模型目录中，请先在 设置 → 模型 里添加`);
      }
      settings.ai.model = model;
    }
  }

  if (patch?.collect && Object.hasOwn(patch.collect, 'intervalMinutes')) {
    const interval = Number(patch.collect.intervalMinutes);
    if (!Number.isInteger(interval) || interval < 10 || interval > 720) {
      throw new HttpError(400, '采集间隔必须是 10 到 720 分钟之间的整数');
    }
    settings.collect.intervalMinutes = interval;
  }
  if (patch?.collect && Object.hasOwn(patch.collect, 'retentionDays')) {
    const days = Number(patch.collect.retentionDays);
    if (!Number.isInteger(days) || days < 7 || days > 3650) {
      throw new HttpError(400, '情报保留天数必须是 7 到 3650 之间的整数');
    }
    settings.collect.retentionDays = days;
  }
  if (patch?.collect && Object.hasOwn(patch.collect, 'irrelevantRetentionDays')) {
    const days = Number(patch.collect.irrelevantRetentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new HttpError(400, '无关内容保留天数必须是 1 到 3650 之间的整数');
    }
    settings.collect.irrelevantRetentionDays = days;
  }
  if (patch?.collect?.rsshubBase !== undefined) {
    const rsshubBase = String(patch.collect.rsshubBase).trim().replace(/\/$/, '');
    if (rsshubBase) {
      let url;
      try { url = new URL(rsshubBase); } catch {
        throw new HttpError(400, 'RSSHub 地址不是有效 URL');
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || rsshubBase.length > 2048) {
        throw new HttpError(400, 'RSSHub 地址必须是无内嵌凭据的 HTTP 或 HTTPS URL');
      }
    }
    settings.collect.rsshubBase = rsshubBase;
  }
  settings.ai.apiKey = apiKey;
  return { settings, apiKey, credentialChanged, credentialProvider };
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (!Object.hasOwn(base, k) || k === '__proto__' || k === 'prototype' || k === 'constructor') continue;
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') {
      deepMerge(base[k], over[k]);
    } else if (over[k] !== undefined) {
      base[k] = over[k];
    }
  }
  return base;
}

function nonEmptyStringArray(value, field) {
  if (!Array.isArray(value) || !value.length
    || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`技术突破配置无效: ${field}`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

// 内置最小默认值：读文件/解析/校验失败且无缓存时的最后防线。
// maxBonus 归零——宁可暂时不给突破加成，也不让无效配置刷出假热度。
const FALLBACK_BREAKTHROUGHS = {
  version: 1,
  maxBonus: 0,
  maxHalfLifeExtensionHours: 0,
  minimumScores: { tier1Credibility: 40, tier15Credibility: 70 },
  eligibleCategories: ['技术研发', '发射与任务'],
  completionActions: ['首飞', '试飞成功', '入轨', '回收', '交付'],
  uncertaintyMarkers: ['拟', '计划', '有望', '传闻'],
  objects: {
    lowaltitude: ['eVTOL', '电动垂直起降', '无人机系统'],
    aerospace: ['可重复使用火箭', '火箭发动机', '推进系统']
  }
};

const FALLBACK_SCORING = {
  dimensionWeights: { importance: 0.32, novelty: 0.18, credibility: 0.16, impact: 0.22, timeliness: 0.12 },
  tierMultiplier: { T1: 1.15, 'T1.5': 1.0, T2: 0.85 },
  featuredThresholds: { default: 70 },
  heatDecayHalfLifeHours: 36,
  clusterWindowHours: 72,
  heuristicThresholdDiscount: 0.85
};

// 模块级「最后一次成功加载」缓存：配置文件损坏时维持上一次有效行为，
// 而不是让整个管线在读取时抛异常。
let lastGoodBreakthroughs = null;
let lastGoodScoring = null;

function parseBreakthroughs(raw) {
  if (!Number.isInteger(raw?.version) || raw.version < 1) {
    throw new Error('技术突破配置无效: version');
  }
  for (const field of ['maxBonus', 'maxHalfLifeExtensionHours']) {
    if (!Number.isFinite(Number(raw[field])) || Number(raw[field]) < 0) {
      throw new Error(`技术突破配置无效: ${field}`);
    }
  }
  const minimumScores = raw.minimumScores || {};
  for (const field of ['tier1Credibility', 'tier15Credibility']) {
    const value = Number(minimumScores[field]);
    // tier1Credibility 允许缺席（代码内有 40 的内置底线），另外两个必须齐备
    if (field === 'tier1Credibility' && minimumScores[field] === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`技术突破配置无效: minimumScores.${field}`);
    }
  }
  const objects = raw.objects || {};
  return {
    ...raw,
    eligibleCategories: nonEmptyStringArray(raw.eligibleCategories, 'eligibleCategories'),
    completionActions: nonEmptyStringArray(raw.completionActions, 'completionActions'),
    uncertaintyMarkers: nonEmptyStringArray(raw.uncertaintyMarkers, 'uncertaintyMarkers'),
    failureMarkers: Array.isArray(raw.failureMarkers) && raw.failureMarkers.length
      ? nonEmptyStringArray(raw.failureMarkers, 'failureMarkers')
      : [],
    objects: {
      lowaltitude: nonEmptyStringArray(objects.lowaltitude, 'objects.lowaltitude'),
      aerospace: nonEmptyStringArray(objects.aerospace, 'objects.aerospace')
    }
  };
}

// 契约：永不抛异常。读取/解析/校验失败 → warn + 返回上次成功加载的缓存；
// 无缓存时返回内置最小默认值。
function loadBreakthroughs() {
  try {
    const parsed = parseBreakthroughs(JSON.parse(fs.readFileSync(BREAKTHROUGHS_PATH, 'utf8')));
    lastGoodBreakthroughs = parsed;
    return parsed;
  } catch (error) {
    console.warn(`技术突破配置加载失败（${error.message}），回落${lastGoodBreakthroughs ? '上次成功加载的缓存' : '内置最小默认值'}`);
    return lastGoodBreakthroughs || structuredClone(FALLBACK_BREAKTHROUGHS);
  }
}

// 下划线开头的键是配置内的说明文字，不参与数值校验
function configEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).filter(([key]) => !key.startsWith('_'))
    : [];
}

function sanitizeScoring(raw) {
  const scoring = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};

  // dimensionWeights：各值 ∈[0,1]；总和偏离 1.0 超过 0.01 时告警并整体回落默认
  const weightEntries = configEntries(scoring.dimensionWeights);
  const weightsValid = weightEntries.length
    && weightEntries.every(([, value]) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 && number <= 1;
    });
  const weightSum = weightEntries.reduce((total, [, value]) => total + Number(value), 0);
  if (!weightsValid) {
    console.warn('计分配置 dimensionWeights 含非法值（须 ∈[0,1]），回落内置默认');
    scoring.dimensionWeights = { ...FALLBACK_SCORING.dimensionWeights };
  } else if (Math.abs(weightSum - 1) > 0.01) {
    console.warn(`计分配置 dimensionWeights 权重总和 ${weightSum} 偏离 1.0 超过 0.01，回落内置默认`);
    scoring.dimensionWeights = { ...FALLBACK_SCORING.dimensionWeights };
  } else {
    scoring.dimensionWeights = Object.fromEntries(
      weightEntries.map(([key, value]) => [key, Number(value)])
    );
  }

  // featuredThresholds：各值 ∈[0,100]，非法值丢弃；default 缺失时补 70
  const thresholds = {};
  for (const [key, value] of configEntries(scoring.featuredThresholds)) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0 && number <= 100) thresholds[key] = number;
    else console.warn(`计分配置 featuredThresholds.${key} 非法（须 ∈[0,100]），已回落丢弃`);
  }
  if (!Number.isFinite(thresholds.default)) {
    console.warn('计分配置 featuredThresholds.default 缺失或非法，回落默认 70');
    thresholds.default = FALLBACK_SCORING.featuredThresholds.default;
  }
  scoring.featuredThresholds = thresholds;

  // heatDecayHalfLifeHours ∈[1,720]
  const halfLife = Number(scoring.heatDecayHalfLifeHours);
  if (!Number.isFinite(halfLife) || halfLife < 1 || halfLife > 720) {
    console.warn('计分配置 heatDecayHalfLifeHours 非法（须 ∈[1,720]），回落默认 36');
    scoring.heatDecayHalfLifeHours = FALLBACK_SCORING.heatDecayHalfLifeHours;
  }

  // heuristicThresholdDiscount ∈(0,1]
  const discount = Number(scoring.heuristicThresholdDiscount);
  if (!Number.isFinite(discount) || discount <= 0 || discount > 1) {
    console.warn('计分配置 heuristicThresholdDiscount 非法（须 ∈(0,1]），回落默认 0.85');
    scoring.heuristicThresholdDiscount = FALLBACK_SCORING.heuristicThresholdDiscount;
  }

  // clusterWindowHours：钳制为 1..720 的整数，非法时默认 72
  const windowHours = Number(scoring.clusterWindowHours);
  scoring.clusterWindowHours = Number.isFinite(windowHours)
    ? Math.max(1, Math.min(720, Math.round(windowHours)))
    : FALLBACK_SCORING.clusterWindowHours;

  // tierMultiplier 缺失时 computeQuality 会直接崩，一并兼顾
  if (!scoring.tierMultiplier || typeof scoring.tierMultiplier !== 'object'
    || Array.isArray(scoring.tierMultiplier)) {
    console.warn('计分配置 tierMultiplier 缺失或非法，回落内置默认');
    scoring.tierMultiplier = { ...FALLBACK_SCORING.tierMultiplier };
  }
  return scoring;
}

// 契约：永不抛异常。读取/解析失败 → warn + 返回上次成功加载的缓存；
// 无缓存时返回内置最小默认值（breakthroughBoost 由永不抛异常的 loadBreakthroughs 提供）。
function loadScoring() {
  try {
    const scoring = sanitizeScoring(JSON.parse(fs.readFileSync(SCORING_PATH, 'utf8')));
    const breakthroughs = loadBreakthroughs();
    scoring.breakthroughBoost = {
      maxBonus: breakthroughs.maxBonus,
      maxHalfLifeExtensionHours: breakthroughs.maxHalfLifeExtensionHours,
      version: breakthroughs.version
    };
    lastGoodScoring = scoring;
    return scoring;
  } catch (error) {
    console.warn(`计分配置加载失败（${error.message}），回落${lastGoodScoring ? '上次成功加载的缓存' : '内置最小默认值'}`);
    if (lastGoodScoring) return lastGoodScoring;
    const fallback = structuredClone(FALLBACK_SCORING);
    const breakthroughs = loadBreakthroughs();
    fallback.breakthroughBoost = {
      maxBonus: breakthroughs.maxBonus,
      maxHalfLifeExtensionHours: breakthroughs.maxHalfLifeExtensionHours,
      version: breakthroughs.version
    };
    return fallback;
  }
}

module.exports = {
  applySettingsPatch,
  loadSettings,
  saveSettings,
  loadScoring,
  loadBreakthroughs,
  SETTINGS_PATH,
  BREAKTHROUGHS_PATH,
  DEEPSEEK_MODEL,
  DEEPSEEK_MODEL_RELEASE,
  normalizeSettings,
  activeApiKey
};
