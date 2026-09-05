'use strict';

const VISION_MODEL = 'deepseek-v4-flash-vision-exp';
const PRO_MODEL = 'deepseek-v4-pro';

function usesDeepSeek(settings) {
  try { return new URL(settings.ai.baseUrl).hostname === 'api.deepseek.com'; } catch { return false; }
}

// Custom compatible providers keep their configured model; never send images to an unknown model.
function modelFor(settings, task = 'routine') {
  if (!usesDeepSeek(settings)) return settings.ai.model;
  return task === 'reasoning' ? PRO_MODEL : VISION_MODEL;
}

function needsReasoning(article, result) {
  const text = `${article.title || ''} ${article.summary_raw || ''}`;
  return /重大|首飞|适航|事故|失败|融资|并购|政策|条例|技术突破|传闻|否认|澄清|矛盾|据传|回顾|此前|去年/i.test(text)
    || (Array.isArray(result?.events) && result.events.length > 1)
    || Number(result?.scores?.importance) >= 80;
}

module.exports = { VISION_MODEL, PRO_MODEL, usesDeepSeek, modelFor, needsReasoning };
