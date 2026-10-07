'use strict';

const { DEFAULT_MODEL } = require('./model-catalog');

// v0.2.3 起分析模型由设置页「模型」一节选定（提供商 + 模型 ID），每个任务都用同一个；
// 未配置时是 DeepSeek V4.1 Flash（deepseek-flash）。
const VISION_MODEL = DEFAULT_MODEL;
function modelFor(settings) {
  const model = settings?.ai?.model;
  return typeof model === 'string' && model.trim() ? model.trim() : VISION_MODEL;
}
// AIHOT 337e7e1：只对明确声明图片输入的模型附图，未知模型继续走普通文本任务。
function acceptsImageInput(settings) {
  const input = settings?.ai?.modelInput;
  return Array.isArray(input) && input.includes('image');
}
// 模型 ID 在不同提供商间可以重名。回执绑定实际路由，不包含密钥。
function modelIdentity(settings) {
  const ai = settings?.ai || {};
  const endpoint = String(ai.baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  return JSON.stringify([ai.activeProvider || 'deepseek', ai.api || 'openai-completions', endpoint, modelFor(settings)]);
}
module.exports = { VISION_MODEL, modelFor, modelIdentity, acceptsImageInput };
