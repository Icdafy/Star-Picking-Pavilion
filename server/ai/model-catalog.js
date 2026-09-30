'use strict';
// 模型提供商目录与配置归一化 —— 形制照搬 DeepSeek Harness 的 Models 设置页：
// 内置目录只登记「端点 + 协议」，模型 ID 由端点自己通过 /models 报告（或手工键入），
// 不在代码里替任何提供商编造模型清单与容量（DeepSeek 例外：它是默认提供商，登记的是官方定价页公布的现行模型）；目录外的网关 / 自建服务以
// 「自定义模型 API」声明，路由 ID、端点、协议、至少一个模型四项齐备才能创建。

const PROTOCOLS = Object.freeze(['openai-completions', 'anthropic-messages']);
const PROTOCOL_LABELS = Object.freeze({
  'openai-completions': 'OpenAI Chat Completions',
  'anthropic-messages': 'Anthropic Messages'
});

const DEFAULT_PROVIDER = 'deepseek';
// 2026-09-10 DeepSeek 发布 V4.1 Flash（原生多模态），官方模型 ID 为 deepseek-flash；
// V4 Flash 与 V4 Flash Vision Exp 已退役，旧名暂由官方路由到 V4.1 Flash。
// 依据：https://api-docs.deepseek.com/zh-cn/updates/ 与 /quick_start/pricing
const DEFAULT_MODEL = 'deepseek-flash';
const DEFAULT_MODEL_NAME = 'DeepSeek V4.1 Flash';
// 已退役的 DeepSeek 模型 ID → 现行 ID。旧设置里选着它们时自动改指 V4.1 Flash，
// 免得官方停止兼容路由那天整条精选链突然失效。
const RETIRED_MODELS = Object.freeze({
  'deepseek-v4-flash': DEFAULT_MODEL,
  'deepseek-v4-flash-vision-exp': DEFAULT_MODEL,
  'deepseek-chat': DEFAULT_MODEL,
  'deepseek-reasoner': DEFAULT_MODEL
});
// 本机无密钥端点（Ollama 等）在运行时用它占位：让「有可用模型」的判断成立，
// 请求时不发送 Authorization 头；它永远不会被写进凭据文件。
const KEYLESS_PLACEHOLDER = 'spp-keyless-endpoint';

const CATALOG = Object.freeze([
  {
    provider: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions', builtin: true,
    models: [
      { id: DEFAULT_MODEL, name: DEFAULT_MODEL_NAME, contextWindow: 1_000_000, maxTokens: 384_000, input: ['text', 'image'] },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1_000_000, maxTokens: 384_000, input: ['text'] }
    ]
  },
  { provider: 'openai', displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' },
  { provider: 'anthropic', displayName: 'Anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { provider: 'moonshot', displayName: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
  { provider: 'zhipu', displayName: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions' },
  { provider: 'dashscope', displayName: '阿里云百炼（通义千问）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions' },
  { provider: 'volcengine', displayName: '火山方舟（豆包）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions' },
  { provider: 'siliconflow', displayName: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions' },
  { provider: 'openrouter', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
  { provider: 'ollama', displayName: 'Ollama（本机）', baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions', keyOptional: true }
].map(entry => Object.freeze(entry)));

const CATALOG_BY_ID = new Map(CATALOG.map(entry => [entry.provider, entry]));
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_MODELS = 200;
const MAX_CAPACITY = 100_000_000;
const INPUT_TYPES = Object.freeze(['text', 'image']);

function cleanText(value, maximum) {
  return typeof value === 'string' && value.trim() && value.length <= maximum && !/\p{Cc}/u.test(value)
    ? value.trim()
    : undefined;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= MAX_CAPACITY ? number : undefined;
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

// 模型行：id 必填；name / contextWindow / maxTokens 可选，清空即不存；
// input 只收 text / image 两类，且 text 必在。非法行整行丢弃，重复 id 只留第一行。
function sanitizeModels(value) {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set();
  const models = [];
  for (const raw of value.slice(0, MAX_MODELS)) {
    const id = cleanText(raw?.id, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const model = { id };
    const name = cleanText(raw.name, 200);
    if (name) model.name = name;
    const contextWindow = positiveInteger(raw.contextWindow);
    if (contextWindow) model.contextWindow = contextWindow;
    const maxTokens = positiveInteger(raw.maxTokens);
    if (maxTokens) model.maxTokens = maxTokens;
    if (Array.isArray(raw.input)) {
      const input = INPUT_TYPES.filter(type => raw.input.includes(type));
      model.input = input.includes('text') ? input : ['text', ...input];
    }
    models.push(model);
  }
  return models;
}

// DeepSeek 路由上的退役模型 ID 换成现行 ID；其它提供商原样返回。
function upgradeRetiredModel(provider, id) {
  return provider === DEFAULT_PROVIDER && typeof id === 'string' && Object.hasOwn(RETIRED_MODELS, id)
    ? RETIRED_MODELS[id]
    : id;
}

// providers 字典：键是路由 ID。目录路由只存用户覆盖的字段；手工声明的路由
// （declared）自己持有显示名称与协议。DeepSeek 永远在场，不可删除。
function sanitizeProviders(raw) {
  const providers = {};
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const [id, profile] of Object.entries(source)) {
    if (!PROVIDER_ID.test(id) || !profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    const catalog = CATALOG_BY_ID.get(id);
    const next = {};
    const baseUrl = cleanText(profile.baseUrl, 2048);
    if (baseUrl) next.baseUrl = baseUrl.replace(/\/+$/, '');
    let models = sanitizeModels(profile.models);
    if (models && id === DEFAULT_PROVIDER) {
      const upgraded = models.map(model => ({ ...model, id: upgradeRetiredModel(id, model.id) }));
      models = sanitizeModels(upgraded);
    }
    if (models) next.models = models;
    if (!catalog) {
      if (!next.baseUrl) continue;
      next.declared = true;
      const displayName = cleanText(profile.displayName, 60);
      if (displayName) next.displayName = displayName;
      next.api = PROTOCOLS.includes(profile.api) ? profile.api : PROTOCOLS[0];
    }
    providers[id] = next;
  }
  if (!providers[DEFAULT_PROVIDER]) providers[DEFAULT_PROVIDER] = {};
  return providers;
}

function describeProvider(id, profile = {}) {
  const catalog = CATALOG_BY_ID.get(id);
  const baseUrl = profile.baseUrl || catalog?.baseUrl || '';
  const models = profile.models || (catalog?.models ? structuredClone(catalog.models) : []);
  return {
    provider: id,
    displayName: profile.displayName || catalog?.displayName || id,
    declared: !catalog,
    builtin: catalog?.builtin === true,
    removable: id !== DEFAULT_PROVIDER,
    api: catalog?.api || profile.api || PROTOCOLS[0],
    baseUrl,
    defaultBaseUrl: catalog?.baseUrl || '',
    baseUrlCustomized: Boolean(catalog && profile.baseUrl),
    models,
    modelsCustomized: Boolean(catalog && profile.models),
    keyOptional: catalog?.keyOptional === true || (!catalog && isLoopbackUrl(baseUrl))
  };
}

// 选定的分析模型必须出现在该提供商的模型目录里；目录空了或选中项被删，
// 回落到该提供商第一行；该提供商已不在，就回落到 DeepSeek 的默认模型。
function resolveActive(providers, activeProvider, model) {
  const provider = providers[activeProvider] ? activeProvider : DEFAULT_PROVIDER;
  const described = describeProvider(provider, providers[provider]);
  const chosen = described.models.find(entry => entry.id === model) || described.models[0];
  if (chosen) return { provider, model: chosen.id, described, entry: chosen };
  if (provider !== DEFAULT_PROVIDER) return resolveActive(providers, DEFAULT_PROVIDER, model);
  return { provider, model: DEFAULT_MODEL, described, entry: { id: DEFAULT_MODEL, input: ['text', 'image'] } };
}

function acceptsImages(entry) {
  return !Array.isArray(entry?.input) || entry.input.includes('image');
}

function catalogEntries() {
  return CATALOG.map(entry => ({
    provider: entry.provider,
    displayName: entry.displayName,
    baseUrl: entry.baseUrl,
    api: entry.api,
    keyOptional: entry.keyOptional === true,
    builtin: entry.builtin === true
  }));
}

module.exports = {
  CATALOG,
  DEFAULT_MODEL,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROVIDER,
  KEYLESS_PLACEHOLDER,
  PROTOCOLS,
  PROTOCOL_LABELS,
  PROVIDER_ID,
  RETIRED_MODELS,
  acceptsImages,
  catalogEntries,
  describeProvider,
  isCatalogProvider: id => CATALOG_BY_ID.has(id),
  resolveActive,
  sanitizeModels,
  sanitizeProviders,
  upgradeRetiredModel
};
