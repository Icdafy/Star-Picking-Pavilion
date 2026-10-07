'use strict';
// AIHOT e6cda05 / 7d6ac83 的标签扫描器：属性引号里的 > 不终止标签。
// MIT 来源署名保留于 THIRD_PARTY_NOTICES.txt；采集、清洗和模型分隔共用这份实现。
function stripTagMarkup(input, replacement = ' ') {
  const html = String(input || '');
  const replace = tag => typeof replacement === 'function' ? replacement(tag) : replacement;
  let out = '', at = 0;
  while (at < html.length) {
    const start = html.indexOf('<', at);
    if (start < 0) return out + html.slice(at);
    out += html.slice(at, start);
    const firstEnd = html.indexOf('>', start + 1);
    if (firstEnd < 0) return out + html.slice(start);
    let end = firstEnd;
    if (/^<\/?[a-z]/i.test(html.slice(start, start + 3))) {
      let quote = '', tagName = true, attributeName = false, value = 'none';
      let i = start + 1;
      for (; i < html.length; i++) {
        const char = html[i];
        if (quote) {
          if (char === quote) quote = '';
        } else if (char === '>') {
          end = i; break;
        } else if (value === 'unquoted') {
          if (/[\t\n\f\r ]/.test(char)) value = 'none';
        } else if (value === 'start') {
          if (/[\t\n\f\r ]/.test(char)) continue;
          value = 'none';
          if (char === '"' || char === "'") quote = char;
          else value = 'unquoted';
        } else if (tagName) {
          if (/[\t\n\f\r ]/.test(char)) tagName = false;
          else if (char === '/') continue;
          else if (char === '=') { tagName = false; attributeName = true; }
        } else if (char === '=') {
          if (attributeName) { attributeName = false; value = 'start'; }
          else attributeName = true;
        } else if (!/[\t\n\f\r ]/.test(char)) attributeName = true;
      }
      if (i === html.length) return out + replace(html.slice(start));
    }
    out += end === start + 1 ? '<>' : replace(html.slice(start, end + 1));
    at = end + 1;
  }
  return out;
}

function stripMarkup(text, replacement = ' ') {
  return stripTagMarkup(String(text || '').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '), replacement);
}

module.exports = { stripTagMarkup, stripMarkup };
