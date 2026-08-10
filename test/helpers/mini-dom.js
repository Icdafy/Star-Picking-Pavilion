'use strict';

/* 摘星阁 · 阶段 4 测试基座：最小 DOM 实现（仅供 Node 单测使用）
   阶段 4 把卡片模板迁进 index.html 的 <template id="cardTemplate">，渲染
   路径改为 cloneNode(true) + 字段级填充与 keyed diff 调和。Node 里没有 DOM，
   项目又锁定零新增依赖，因此在这里实现一个只覆盖渲染层所需能力的微型 DOM：
   元素/文本/片段节点、属性与 classList、innerHTML 原样存取、querySelector/
   querySelectorAll/closest（支持 tag/.class/[attr]/[attr="v"]、后代与子代
   组合、逗号分隔）、cloneNode(true)、replaceChildren 与 outerHTML 序列化，
   外加一个只解析良构标记的 parseFragment，用于把 index.html 里真实的卡片
   模板解析成节点树驱动工厂——测试因此验证的是线上那份模板本身。

   已知局限（写断言前必读）：innerHTML 赋值不解析标记，只把原始字符串存为
   RawHTML 节点——RawHTML 不参与 querySelector/querySelectorAll/closest
   查询，仅在序列化时逐字输出；给元素赋 innerHTML 后再读 textContent，
   得到的是原始标记文本而非解析后的纯文本。需要真实解析时改用
   parseFragment 显式建节点树。 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const FRAGMENT_NODE = 11;
const RAW_NODE = 100;   // innerHTML/insertAdjacentHTML 注入的原样 HTML 片段

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&"]/g, c => ({ '&': '&amp;', '"': '&quot;' }[c]));
}

function kebab(name) {
  return String(name).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

function camel(name) {
  return String(name).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ---------- 选择器引擎 ----------
function parseCompound(text) {
  const compound = { tag: null, classes: [], attrs: [] };
  const re = /([.#]?[A-Za-z0-9_-]+)|\[([A-Za-z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let match;
  while ((match = re.exec(text))) {
    if (match[1] !== undefined) {
      if (match[1].startsWith('.')) compound.classes.push(match[1].slice(1));
      else if (match[1].startsWith('#')) compound.attrs.push({ name: 'id', value: match[1].slice(1) });
      else compound.tag = match[1].toLowerCase();
    } else {
      compound.attrs.push({ name: match[2], value: match[3] });
    }
  }
  return compound;
}

// 解析「逗号分隔的复合选择器」为步骤表：steps[i].with 描述步骤 i 与 i+1 之间的组合器
function parseSelector(selector) {
  return String(selector).split(',').map(part => {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const steps = [];
    for (const token of tokens) {
      if (token === '>' || token === '+') {
        if (steps.length) steps[steps.length - 1].combinator = token;
        continue;
      }
      steps.push({ compound: parseCompound(token), combinator: ' ' });
    }
    return steps;
  });
}

function matchCompound(el, compound) {
  if (el.nodeType !== ELEMENT_NODE) return false;
  if (compound.tag && el.tagName !== compound.tag) return false;
  if (compound.classes.length) {
    const classes = new Set(el.classList.containsList());
    for (const cls of compound.classes) if (!classes.has(cls)) return false;
  }
  for (const attr of compound.attrs) {
    if (!el.hasAttribute(attr.name)) return false;
    if (attr.value !== undefined && el.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

function matchSteps(el, steps) {
  let idx = steps.length - 1;
  if (!matchCompound(el, steps[idx].compound)) return false;
  idx -= 1;
  let anchor = el.parentNode;
  while (idx >= 0) {
    const step = steps[idx];
    if (step.combinator === '>') {
      if (!anchor || !matchCompound(anchor, step.compound)) return false;
      anchor = anchor.parentNode;
    } else {
      let hit = null;
      for (let p = anchor; p; p = p.parentNode) {
        if (matchCompound(p, step.compound)) { hit = p; break; }
      }
      if (!hit) return false;
      anchor = hit.parentNode;
    }
    idx -= 1;
  }
  return true;
}

// ---------- 节点 ----------
class MiniText {
  constructor(nodeValue) {
    this.nodeType = TEXT_NODE;
    this.nodeValue = String(nodeValue);
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  cloneNode() { return new MiniText(this.nodeValue); }
}

// 原样 HTML：不参与查询，序列化时逐字输出
class RawHTML {
  constructor(html) {
    this.nodeType = RAW_NODE;
    this.html = String(html);
    this.parentNode = null;
  }
  cloneNode() { return new RawHTML(this.html); }
}

function insertChild(parent, node, ref) {
  // 先定位再腾挪：node 若已在 parent 中，摘下它会改变 ref 的下标
  const index = ref ? parent.childNodes.indexOf(ref) : -1;
  if (node.nodeType === FRAGMENT_NODE) {
    for (const child of [...node.childNodes]) insertChild(parent, child, ref);
    return node;
  }
  if (node.parentNode) node.parentNode.removeChild(node);
  node.parentNode = parent;
  if (parent._rawInnerHTML !== undefined && parent._rawInnerHTML !== null) parent._rawInnerHTML = null;
  const target = ref ? parent.childNodes.indexOf(ref) : -1;
  if (target === -1) parent.childNodes.push(node);
  else parent.childNodes.splice(target, 0, node);
  return node;
}

class MiniParent {
  constructor() {
    this.nodeType = FRAGMENT_NODE;
    this.childNodes = [];
    this.parentNode = null;
    this._doc = null;
  }
  get children() { return this.childNodes.filter(n => n.nodeType === ELEMENT_NODE); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get ownerDocument() { return this._doc || this.parentNode?.ownerDocument || null; }
  appendChild(node) { return insertChild(this, node, null); }
  insertBefore(node, ref) { return insertChild(this, node, ref || null); }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) { child.parentNode = null; }
    this.childNodes = [];
    if (this._rawInnerHTML !== undefined) this._rawInnerHTML = null;
    for (const node of nodes) this.appendChild(node);
  }
  cloneChildren(deep, copy) {
    if (!deep) return copy;
    for (const child of this.childNodes) {
      const clone = child.cloneNode(true);
      clone.parentNode = copy;
      copy.childNodes.push(clone);
    }
    return copy;
  }
}

class MiniElement extends MiniParent {
  constructor(tagName, doc = null) {
    super();
    this.nodeType = ELEMENT_NODE;
    this.tagName = String(tagName).toLowerCase();
    this.attributes = [];
    this.style = {};
    this.hidden = false;
    this._rawInnerHTML = null;
    this._doc = doc;
    const self = this;
    this.classList = {
      containsList() { return (self.getAttribute('class') || '').split(/\s+/).filter(Boolean); },
      contains(name) { return this.containsList().includes(name); },
      add(...names) {
        const set = new Set(this.containsList());
        names.forEach(n => n && set.add(n));
        self.setAttribute('class', [...set].join(' '));
      },
      remove(...names) {
        const set = new Set(this.containsList());
        names.forEach(n => set.delete(n));
        self.setAttribute('class', [...set].join(' '));
      },
      toggle(name, force) {
        const on = force === undefined ? !this.contains(name) : Boolean(force);
        if (on) this.add(name); else this.remove(name);
        return on;
      }
    };
    this.dataset = new Proxy({}, {
      get: (_, key) => self.getAttribute(`data-${kebab(key)}`),
      set: (_, key, value) => { self.setAttribute(`data-${kebab(key)}`, value); return true; },
      has: (_, key) => self.hasAttribute(`data-${kebab(key)}`)
    });
  }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', String(value)); }
  setAttribute(name, value) {
    name = String(name);
    const found = this.attributes.find(a => a.name === name);
    if (found) found.value = String(value);
    else this.attributes.push({ name, value: String(value) });
    if (name === 'hidden') this.hidden = true;   // 布尔属性反射为属性（同真实 DOM）
  }
  getAttribute(name) {
    const found = this.attributes.find(a => a.name === String(name));
    return found ? found.value : null;
  }
  hasAttribute(name) { return this.attributes.some(a => a.name === String(name)); }
  removeAttribute(name) {
    this.attributes = this.attributes.filter(a => a.name !== String(name));
    if (String(name) === 'hidden') this.hidden = false;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() {
    if (this._rawInnerHTML !== null) return this._rawInnerHTML;   // 原样 HTML 注入后与子节点互斥
    return this.childNodes.map(n => (n.nodeType === RAW_NODE ? n.html : n.textContent)).join('');
  }
  set textContent(value) {
    this.childNodes = [];
    this._rawInnerHTML = null;
    if (String(value) !== '') this.appendChild(new MiniText(value));
  }
  get innerHTML() {
    if (this._rawInnerHTML !== null) return this._rawInnerHTML;
    return this.childNodes.map(n => serializeNode(n)).join('');
  }
  set innerHTML(value) {
    this.childNodes = [];
    this._rawInnerHTML = String(value);
  }
  insertAdjacentHTML(position, html) {
    const raw = new RawHTML(html);
    if (position === 'beforeend') this.appendChild(raw);
    else if (position === 'afterend' && this.parentNode) {
      this.parentNode.insertBefore(raw, this.nextSibling());
    } else if (position === 'afterbegin') this.insertBefore(raw, this.firstChild);
    else if (position === 'beforebegin' && this.parentNode) {
      this.parentNode.insertBefore(raw, this);
    }
  }
  nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  querySelectorAll(selector) {
    const alternatives = parseSelector(selector);
    const results = [];
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        if (alternatives.some(steps => matchSteps(child, steps))) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) {
    const alternatives = parseSelector(selector);
    for (let el = this; el && el.nodeType === ELEMENT_NODE; el = el.parentNode) {
      if (alternatives.some(steps => matchSteps(el, steps))) return el;
    }
    return null;
  }
  contains(node) {
    for (let el = node; el; el = el.parentNode) if (el === this) return true;
    return false;
  }
  focus(options) {
    const doc = this.ownerDocument;
    if (doc) {
      doc.activeElement = this;
      doc.lastFocusOptions = options;
    }
  }
  cloneNode(deep = false) {
    const copy = new MiniElement(this.tagName, this._doc);
    copy.attributes = this.attributes.map(a => ({ name: a.name, value: a.value }));
    copy.style = { ...this.style };
    copy.hidden = this.hidden;
    copy._rawInnerHTML = this._rawInnerHTML;
    return this.cloneChildren(deep, copy);
  }
}

class MiniFragment extends MiniParent {
  constructor(doc = null) {
    super();
    this._doc = doc;
  }
  querySelectorAll(selector) {
    const alternatives = parseSelector(selector);
    const results = [];
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        if (alternatives.some(steps => matchSteps(child, steps))) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  cloneNode(deep = false) {
    return this.cloneChildren(deep, new MiniFragment(this._doc));
  }
}

class MiniDocument {
  constructor() {
    this.nodeType = 9;
    this.activeElement = null;
    this.lastFocusOptions = null;
  }
  createElement(tag) { return new MiniElement(tag, this); }
  createTextNode(text) { return new MiniText(text); }
  createDocumentFragment() { return new MiniFragment(this); }
}

// ---------- 序列化 ----------
function styleAttribute(style) {
  const entries = Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  const text = entries.map(([k, v]) => `${kebab(k)}:${v}`).join(';');
  return ` style="${escapeAttr(text)}"`;
}

function serializeNode(node) {
  if (node.nodeType === TEXT_NODE) return escapeHTML(node.nodeValue);
  if (node.nodeType === RAW_NODE) return node.html;
  if (node.nodeType === FRAGMENT_NODE) return node.childNodes.map(serializeNode).join('');
  // hidden 统一由布尔属性输出，避免与属性表重复
  const attrs = node.attributes.filter(a => a.name !== 'hidden')
    .map(a => ` ${a.name}="${escapeAttr(a.value)}"`).join('');
  const hidden = node.hidden ? ' hidden' : '';
  if (VOID_TAGS.has(node.tagName)) {
    return `<${node.tagName}${attrs}${hidden}${styleAttribute(node.style)}>`;
  }
  const inner = node._rawInnerHTML !== null ? node._rawInnerHTML : node.childNodes.map(serializeNode).join('');
  return `<${node.tagName}${attrs}${hidden}${styleAttribute(node.style)}>${inner}</${node.tagName}>`;
}

// ---------- 良构标记解析（仅供解析 index.html 模板等受控输入） ----------
function parseFragment(html, doc = new MiniDocument()) {
  const root = doc.createDocumentFragment();
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*"([^"]*)")?/g;
  let match;
  while ((match = tokenRe.exec(html))) {
    const top = stack[stack.length - 1];
    if (match[5] !== undefined) {
      const text = match[5];
      if (text.trim() !== '') top.appendChild(doc.createTextNode(text));
      continue;
    }
    const [, closing, tag, attrText, selfClose] = match;
    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === tag.toLowerCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = doc.createElement(tag);
    let attrMatch;
    attrRe.lastIndex = 0;
    while ((attrMatch = attrRe.exec(attrText || ''))) {
      el.setAttribute(attrMatch[1], attrMatch[2] ?? '');
    }
    top.appendChild(el);
    if (!selfClose && !VOID_TAGS.has(el.tagName)) stack.push(el);
  }
  return root;
}

// 从 index.html 源码中抽出指定 <template> 的内容并解析为片段
function templateFromHtml(pageHtml, templateId, doc = new MiniDocument()) {
  const pattern = new RegExp(`<template id="${templateId}">([\\s\\S]*?)<\\/template>`);
  const match = pageHtml.match(pattern);
  if (!match) throw new Error(`index.html 中缺少 <template id="${templateId}">`);
  return { content: parseFragment(match[1], doc), doc };
}

module.exports = {
  MiniDocument,
  MiniElement,
  MiniFragment,
  MiniText,
  RawHTML,
  parseFragment,
  templateFromHtml,
  serialize: serializeNode
};
