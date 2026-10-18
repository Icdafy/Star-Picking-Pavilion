'use strict';

const { DEFAULT_MODEL, DEFAULT_MODEL_RELEASE, DEFAULT_PROVIDER, upgradeRetiredModel } = require('./model-catalog');

// v0.2.3 起分析模型由设置页「模型」一节选定（提供商 + 模型 ID），每个任务都用同一个；
// 未配置时是 DeepSeek V4.1 Flash 1017（deepseek-flash）。
const VISION_MODEL = DEFAULT_MODEL;
function resolveRequestModel(settings, override) {
  const selected = typeof override === 'string' && override.trim() ? override : settings?.ai?.model;
  const model = typeof selected === 'string' && selected.trim() ? selected.trim() : VISION_MODEL;
  return upgradeRetiredModel(settings?.ai?.activeProvider || DEFAULT_PROVIDER, model);
}
function modelFor(settings) { return resolveRequestModel(settings); }
// AIHOT 337e7e1：只对明确声明图片输入的模型附图，未知模型继续走普通文本任务。
function acceptsImageInput(settings) {
  const input = settings?.ai?.modelInput;
  return Array.isArray(input) && input.includes('image');
}
// 模型 ID 在不同提供商间可以重名。回执绑定实际路由，不包含密钥。
function modelIdentity(settings) {
  const ai = settings?.ai || {};
  const endpoint = String(ai.baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  const provider = ai.activeProvider || DEFAULT_PROVIDER;
  const model = modelFor(settings);
  // 滚动别名更新后，旧版模型的缓存回执不应阻止首次调用新版。
  const release = provider === DEFAULT_PROVIDER && model === DEFAULT_MODEL ? [DEFAULT_MODEL_RELEASE] : [];
  return JSON.stringify([provider, ai.api || 'openai-completions', endpoint, model, ...release]);
}
module.exports = { VISION_MODEL, modelFor, modelIdentity, resolveRequestModel, acceptsImageInput };
