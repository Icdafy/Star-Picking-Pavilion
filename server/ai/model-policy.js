'use strict';

const { DEFAULT_MODEL } = require('./model-catalog');

// v0.2.3 起分析模型由设置页「模型」一节选定（提供商 + 模型 ID），每个任务都用同一个；
// 未配置时仍是 DeepSeek V4 Flash Vision。
const VISION_MODEL = DEFAULT_MODEL;
function modelFor(settings) {
  const model = settings?.ai?.model;
  return typeof model === 'string' && model.trim() ? model.trim() : VISION_MODEL;
}
// 图片理解只交给声明了图片输入的模型；未声明输入类型的模型按「可能支持」处理，
// 由服务端报错后降级，和其它兼容服务的参数兜底一致。
function acceptsImageInput(settings) {
  const input = settings?.ai?.modelInput;
  return !Array.isArray(input) || input.includes('image');
}
module.exports = { VISION_MODEL, modelFor, acceptsImageInput };
