'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCangyanluController, SOURCE, PARTITION } = require('../renderer/cangyanlu-controller');

function element(tag = 'div', props = {}) {
  const listeners = new Map();
  const node = {
    tagName: tag.toUpperCase(), attributes: {}, dataset: {}, children: [], hidden: false,
    offsetTop: 0, offsetHeight: 0, offsetParent: null, clientHeight: 0, scrollTop: 0, textContent: '',
    style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    dispatch(name, detail = {}) { listeners.get(name)?.(detail); },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    querySelector(selector) { return this.parts?.[selector] ?? null; },
    getBoundingClientRect: () => ({ top: 0 }),
    reload() { this.reloads = (this.reloads || 0) + 1; },
    ...props
  };
  return node;
}

function createWorld({ wide = true } = {}) {
  const viewport = element('div', { clientHeight: 889 });
  const stage = element('div', { offsetTop: 0, offsetParent: viewport });
  const main = element('main', { offsetTop: 0, offsetParent: stage });
  const view = element('section', { offsetTop: wide ? 113 : 350, offsetParent: stage, parentElement: main });
  const pinned = element('header', { offsetHeight: wide ? 86 : 64 });
  const status = element('div');
  const title = element('p');
  const note = element('p');
  const retry = element('button', { hidden: true });
  const host = element('div', {
    parts: { '[data-cyl-status]': status, '[data-cyl-title]': title, '[data-cyl-note]': note, '[data-cyl-retry]': retry }
  });
  const styles = new Map([
    [main, { paddingBottom: '16px' }],
    [pinned, { top: '10px', marginBottom: wide ? '17px' : '24px' }]
  ]);
  const frames = [];
  const win = {
    listeners: new Map(),
    frames,
    getComputedStyle: node => styles.get(node) || {},
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    addEventListener(name, handler) { this.listeners.set(name, handler); }
  };
  const doc = { created: [], createElement(tag) { const node = element(tag); this.created.push(node); return node; } };
  return { viewport, view, host, pinned, status, title, note, retry, win, doc };
}

test('首次进入才挂载固定地址与分区的 webview，之后复用同一实例', () => {
  const world = createWorld();
  const controller = createCangyanluController({
    document: world.doc, window: world.win, view: world.view, host: world.host,
    viewport: world.viewport, desktop: { isElectron: true }, getPinned: () => world.pinned
  });
  assert.equal(controller.getFrame(), null, '启动时不加载藏言录');
  controller.enter();
  const frame = controller.getFrame();
  assert.equal(frame.tagName, 'WEBVIEW');
  assert.equal(frame.getAttribute('partition'), PARTITION);
  assert.equal(frame.getAttribute('src'), SOURCE);
  assert.equal(SOURCE, 'cangyanlu://app/');
  assert.equal(frame.getAttribute('allowpopups'), '');
  assert.deepEqual(Object.keys(frame.attributes).slice(0, 1), ['partition'], '分区必须先于地址写入');
  assert.equal(world.host.children[0], frame);
  assert.equal(world.host.dataset.state, 'loading');
  assert.equal(world.status.hidden, false);
  controller.enter();
  assert.equal(world.doc.created.length, 1);

  frame.dispatch('dom-ready');
  assert.equal(world.host.dataset.state, 'ready');
  assert.equal(world.status.hidden, true);
});

test('加载失败与进程退出给出重试，主动中止的导航不算失败', () => {
  const world = createWorld();
  const controller = createCangyanluController({
    document: world.doc, window: world.win, view: world.view, host: world.host,
    viewport: world.viewport, desktop: { isElectron: true }
  });
  controller.enter();
  const frame = controller.getFrame();
  frame.dispatch('did-fail-load', { isMainFrame: true, errorCode: -3 });
  assert.equal(world.host.dataset.state, 'loading');
  frame.dispatch('did-fail-load', { isMainFrame: false, errorCode: -105 });
  assert.equal(world.host.dataset.state, 'loading');
  frame.dispatch('did-fail-load', { isMainFrame: true, errorCode: -6, errorDescription: 'ERR_FILE_NOT_FOUND' });
  assert.equal(world.host.dataset.state, 'error');
  assert.equal(world.retry.hidden, false);
  assert.match(world.note.textContent, /ERR_FILE_NOT_FOUND/);
  world.retry.dispatch('click');
  assert.equal(frame.reloads, 1);
  assert.equal(world.host.dataset.state, 'loading');
  frame.dispatch('render-process-gone');
  assert.equal(world.host.dataset.state, 'error');
  assert.match(world.title.textContent, /意外退出/);
});

test('浏览器开发模式没有桌面壳时只给出说明，不挂载 webview', () => {
  const world = createWorld();
  const controller = createCangyanluController({
    document: world.doc, window: world.win, view: world.view, host: world.host, viewport: world.viewport, desktop: null
  });
  controller.enter();
  assert.equal(controller.getFrame(), null);
  assert.equal(world.doc.created.length, 0);
  assert.equal(world.host.dataset.state, 'unavailable');
  assert.match(world.title.textContent, /桌面版/);
});

test('宽屏从吸顶塔台下方铺到视口底端，不产生页面滚动', () => {
  const world = createWorld({ wide: true });
  const controller = createCangyanluController({
    document: world.doc, window: world.win, view: world.view, host: world.host,
    viewport: world.viewport, desktop: { isElectron: true }, getPinned: () => world.pinned
  });
  controller.enter();
  // 塔台吸顶 10 + 高 86 + 下间距 17 = 113，恰好等于视图落点：视口 889 − 113 − 底部留白 16
  assert.equal(world.view.style.values['--cyl-h'], '760px');
  assert.equal(world.viewport.scrollTop, 0);
});

test('窄屏让出品牌与塔台：滚到藏言录紧贴吸顶导航，高度按吸顶导航下沿计算', () => {
  const world = createWorld({ wide: false });
  const controller = createCangyanluController({
    document: world.doc, window: world.win, view: world.view, host: world.host,
    viewport: world.viewport, desktop: { isElectron: true }, getPinned: () => world.pinned
  });
  controller.enter();
  // 吸顶导航 10 + 64 + 24 = 98；视图落点 350，于是滚动 252，高度 889 − 98 − 16
  assert.equal(world.viewport.scrollTop, 252);
  assert.equal(world.view.style.values['--cyl-h'], '775px');
  // 窗口尺寸变化只重算高度，不再改用户的滚动位置
  world.viewport.scrollTop = 40;
  world.viewport.clientHeight = 600;
  world.win.listeners.get('resize')();
  assert.equal(world.win.frames.length, 1);
  world.win.frames[0]();
  assert.equal(world.view.style.values['--cyl-h'], '486px');
  assert.equal(world.viewport.scrollTop, 40);
  // 视图隐藏时不排队测量
  world.view.hidden = true;
  world.win.listeners.get('resize')();
  assert.equal(world.win.frames.length, 1);
});
