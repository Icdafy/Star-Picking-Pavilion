'use strict';
// 配置体系：settings.json（用户可改，含 DeepSeek API Key）+ scoring.json（计分公式参数）
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');
const { validateAiBaseUrl } = require('./http-security');
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
    requestTimeoutMs: 20000,
    rsshubBase: '',                    // RSSHub 实例地址（如 https://rsshub.app）；填后 rsshub:// 型信源生效
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  dailyReportHour: 8                   // 每天 8 点生成日报
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const legacyKey = String(raw?.ai?.apiKey || '').trim();
    if (!getApiKey() && legacyKey) setApiKey(legacyKey);
    const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
    settings.ai.apiKey = getApiKey();
    return settings;
  } catch {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ai.apiKey = getApiKey();
    return settings;
  }
}

async function saveSettings(settings, options = {}) {
  const sanitized = structuredClone(settings);
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
  const settings = structuredClone(currentSettings);
  const currentKey = String(settings.ai.apiKey || getApiKey() || '');
  let apiKey = currentKey;
  let credentialChanged = false;

  if (patch?.ai) {
    const incomingKey = patch.ai.apiKey;
    const suppliesKey = incomingKey !== undefined && !String(incomingKey).includes('****');
    if (patch.ai.baseUrl !== undefined) {
      const baseUrl = String(patch.ai.baseUrl).trim().replace(/\/$/, '');
      if (!validateAiBaseUrl(baseUrl)) throw new Error('AI 基础地址必须使用 HTTPS（本机回环地址除外）');
      if (baseUrl !== settings.ai.baseUrl && !suppliesKey) {
        apiKey = '';
        credentialChanged = Boolean(currentKey);
      }
      settings.ai.baseUrl = baseUrl;
    }
    if (suppliesKey) {
      apiKey = String(incomingKey || '').trim();
      credentialChanged = apiKey !== currentKey;
    }
    for (const key of ['prefilterModel', 'scoringModel']) {
      if (patch.ai[key] !== undefined) settings.ai[key] = String(patch.ai[key]).trim();
    }
  }

  if (patch?.collect?.intervalMinutes) settings.collect.intervalMinutes = Number(patch.collect.intervalMinutes);
  if (patch?.collect?.rsshubBase !== undefined) settings.collect.rsshubBase = String(patch.collect.rsshubBase).trim();
  settings.ai.apiKey = apiKey;
  return { settings, apiKey, credentialChanged };
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
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
