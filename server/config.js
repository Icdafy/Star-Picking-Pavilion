'use strict';
// 配置体系：settings.json（用户可改，含 DeepSeek API Key）+ scoring.json（计分公式参数）
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');
const { HttpError, validateAiBaseUrl } = require('./http-security');
const { getApiKey, setApiKey } = require('./runtime-credentials');

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const SCORING_PATH = path.join(__dirname, '..', 'config', 'scoring.json');

const DEFAULT_SETTINGS = {
  // —— AI 分析层（DeepSeek，OpenAI 兼容协议；留好接口，可换任意兼容服务）——
  ai: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    prefilterModel: 'deepseek-v4-flash',  // 便宜模型：预筛相关性（旧名 deepseek-chat 将于 2026/07/24 弃用）
    scoringModel: 'deepseek-v4-pro',       // 强模型：五维评分+摘要+研判（旧名 deepseek-reasoner）
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

function normalizeSettings(raw) {
  const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
  settings.ai.baseUrl = boundedText(settings.ai.baseUrl, DEFAULT_SETTINGS.ai.baseUrl, 2048);
  settings.ai.prefilterModel = boundedText(settings.ai.prefilterModel, DEFAULT_SETTINGS.ai.prefilterModel, 120);
  settings.ai.scoringModel = boundedText(settings.ai.scoringModel, DEFAULT_SETTINGS.ai.scoringModel, 120);
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
    settings.ai.apiKey = getApiKey();
    return settings;
  } catch {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ai.apiKey = getApiKey();
    return settings;
  }
}

async function saveSettings(settings, options = {}) {
  const sanitized = normalizeSettings(settings);
  if (sanitized.ai) delete sanitized.ai.apiKey;
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
  if (patch.ai && Object.keys(patch.ai).some(key => !['apiKey', 'baseUrl', 'prefilterModel', 'scoringModel'].includes(key))) {
    throw new HttpError(400, '包含不支持的 AI 设置字段');
  }
  if (patch.collect && Object.keys(patch.collect).some(
    key => !['intervalMinutes', 'rsshubBase', 'retentionDays', 'irrelevantRetentionDays'].includes(key)
  )) {
    throw new HttpError(400, '包含不支持的采集设置字段');
  }
  const settings = structuredClone(currentSettings);
  const currentKey = String(settings.ai.apiKey || getApiKey() || '');
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
    for (const key of ['prefilterModel', 'scoringModel']) {
      if (patch.ai[key] !== undefined) {
        const model = typeof patch.ai[key] === 'string' ? patch.ai[key].trim() : '';
        if (!model || model.length > 120 || /\p{Cc}/u.test(model)) {
          throw new HttpError(400, '模型名称必须是 1 到 120 个字符的文本');
        }
        settings.ai[key] = model;
      }
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
  return { settings, apiKey, credentialChanged };
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

function loadScoring() {
  return JSON.parse(fs.readFileSync(SCORING_PATH, 'utf8'));
}

module.exports = { applySettingsPatch, loadSettings, saveSettings, loadScoring, SETTINGS_PATH };
