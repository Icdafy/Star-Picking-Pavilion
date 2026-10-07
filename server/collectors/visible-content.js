'use strict';
// 只判断原文直接声明的可见性，不运行脚本、也不请求远程样式。
// AIHOT c45cf68：属性名/关键字不分大小写，important 优先，否则后写者优先。
function declarations(style) {
  const out = [];
  let value = '', quote = '', depth = 0;
  for (let i = 0; i < style.length; i++) {
    const char = style[i];
    if (quote) {
      value += char;
      if (char === '\\' && i + 1 < style.length) value += style[++i];
      else if (char === quote) quote = '';
    } else if (char === '/' && style[i + 1] === '*') {
      const end = style.indexOf('*/', i + 2);
      if (end < 0) break;
      value += ' '; i = end + 1;
    } else if (char === '"' || char === "'") { quote = char; value += char; }
    else if (char === '(') { depth++; value += char; }
    else if (char === ')') { depth = Math.max(0, depth - 1); value += char; }
    else if (char === ';' && !depth) { out.push(value); value = ''; }
    else value += char;
  }
  out.push(value);
  return out;
}

const DISPLAY = /^(?:none|block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|inline-table|table-(?:row|cell|column|caption|row-group|column-group|header-group|footer-group)|list-item|contents|flow-root|inherit|initial|unset|revert|revert-layer)$/;
const VISIBILITY = /^(?:visible|hidden|collapse|inherit|initial|unset|revert|revert-layer)$/;
function inlineVisibility(style) {
  const applied = new Map();
  for (const declaration of declarations(String(style || ''))) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    if (name !== 'display' && name !== 'visibility') continue;
    const raw = declaration.slice(colon + 1).trim().toLowerCase();
    const important = /!\s*important$/.test(raw);
    const value = raw.replace(/!\s*important$/, '').trim();
    if (!(name === 'display' ? DISPLAY : VISIBILITY).test(value)) continue;
    if (important || !applied.get(name)?.important) applied.set(name, { value, important });
  }
  return Object.fromEntries([...applied].map(([name, entry]) => [name, entry.value]));
}

function removeHiddenContent($) {
  $('[hidden],[style]').each((_, el) => {
    const node = $(el);
    const style = inlineVisibility(node.attr('style'));
    if (node.attr('hidden') != null || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) node.remove();
  });
  // 保留惰性占位图旁的真实备用图，忽略备用导航文字。
  $('noscript').each((_, el) => {
    const node = $(el), images = node.find('img');
    if (images.length) node.replaceWith(images);
    else node.remove();
  });
}
module.exports = { inlineVisibility, removeHiddenContent };
