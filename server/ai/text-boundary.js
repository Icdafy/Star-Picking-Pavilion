'use strict';

const COMMON_WORDS = new Set([
  '航天', '航空', '航线', '航道', '航运', '航母', '飞行', '飞机', '飞船', '飞天', '飞跃', '飞速', '天下', '天空', '天地', '天气', '天然',
  '空间', '空中', '空域', '箭体', '千亿', '百亿', '十亿', '万亿', '数亿', '亿元', '终极', '积极', '北极', '南极', '极地', '极限',
  '高峰', '顶峰', '巅峰', '登峰', '汇聚', '汇报', '沃土', '蓝天'
]);

function boundaryOk(text, start, length) {
  const word = character => character !== undefined && /[A-Za-z0-9_]/.test(character);
  return !word(text[start - 1]) && !word(text[start + length]);
}

// 短中文别名若跨在常见词中间，就不是具名主体：“千亿航天”不能命中“亿航”。
function cjkBoundaryOk(text, start, length) {
  if (length > 3) return true;
  const before = text[start - 1];
  const after = text[start + length];
  const cjk = character => character !== undefined && /\p{Script=Han}/u.test(character);
  if (cjk(before) && COMMON_WORDS.has(before + text[start])) return false;
  if (cjk(after) && COMMON_WORDS.has(text[start + length - 1] + after)) return false;
  return true;
}

module.exports = { boundaryOk, cjkBoundaryOk };
