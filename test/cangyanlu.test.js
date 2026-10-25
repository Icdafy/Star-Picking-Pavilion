'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cangyanlu = require('../electron/cangyanlu');

const root = path.join(__dirname, '..');
// 藏言录随包原样附带：更新它时整份替换文件，再同步这里的校验和与字节数。
const BUNDLED_SHA256 = '55177a1be973bb735739e923c3ed7df9a8aeb8403b201fa4faeb8d8a06cfe3d8';
const BUNDLED_BYTES = 1_143_516;

function createEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

function createGuest() {
  const listeners = new Map();
  return {
    openHandler: null,
    setWindowOpenHandler(handler) { this.openHandler = handler; },
    on(name, handler) { listeners.set(name, handler); },
    emit(name, ...args) { return listeners.get(name)?.(...args); }
  };
}

test('藏言录随包文件与原始单文件逐字节一致，且不受行尾转换影响', () => {
  const page = fs.readFileSync(cangyanlu.CANGYANLU_FILE);
  assert.equal(path.relative(root, cangyanlu.CANGYANLU_FILE).split(path.sep).join('/'), 'electron/cangyanlu/藏言录.html');
  assert.equal(page.length, BUNDLED_BYTES);
  assert.equal(crypto.createHash('sha256').update(page).digest('hex'), BUNDLED_SHA256);
  assert.equal(page.includes(13), false, '原始文件只有 LF；出现 CR 说明被 Git 换行转换改写');
  assert.match(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8'), /^electron\/cangyanlu\/\*\.html -text$/m);
  const builder = require('../package.json').build.files;
  assert.ok(builder.includes('electron/**/*'), '安装包必须带上 electron/cangyanlu');
});

test('固定来源在 ready 前注册为标准安全协议，才能拿到持久的 Web 存储', () => {
  const calls = [];
  cangyanlu.registerCangyanluScheme({ registerSchemesAsPrivileged: value => calls.push(value) });
  assert.deepEqual(calls, [[{ scheme: 'cangyanlu', privileges: { standard: true, secure: true } }]]);
  assert.equal(cangyanlu.CANGYANLU_URL, 'cangyanlu://app/');
  assert.equal(cangyanlu.CANGYANLU_PARTITION, 'persist:cangyanlu');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const register = main.indexOf('cangyanlu.registerCangyanluScheme(protocol);');
  const ready = main.indexOf('app.whenReady().then');
  assert.ok(register > 0 && register < ready, '必须在 app.whenReady 之前注册协议');
  assert.match(main, /installCangyanluSession\(session\.fromPartition\(cangyanlu\.CANGYANLU_PARTITION\)\)/);
});

test('协议只提供藏言录页面本身，并附带收紧的响应头', async () => {
  const reads = [];
  const handler = cangyanlu.createCangyanluProtocolHandler({
    readFile: async file => { reads.push(file); return Buffer.from('<!doctype html><title>藏言录</title>'); }
  });
  const page = await handler(new Request('cangyanlu://app/'));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('content-security-policy'), cangyanlu.CANGYANLU_CONTENT_SECURITY_POLICY);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await page.text(), '<!doctype html><title>藏言录</title>');
  assert.equal((await handler(new Request('cangyanlu://app/index.html'))).status, 200);
  const head = await handler(new Request('cangyanlu://app/', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(reads.length, 1, '页面只读一次，之后走内存');
  assert.equal(reads[0], cangyanlu.CANGYANLU_FILE);
  for (const url of ['cangyanlu://app/favicon.ico', 'cangyanlu://app/../package.json', 'cangyanlu://other/', 'cangyanlu://user:pw@app/']) {
    assert.equal((await handler({ url, method: 'GET' })).status, 404, url);
  }
  assert.equal((await handler(new Request('cangyanlu://app/', { method: 'POST', body: 'x' }))).status, 405);
});

test('协议从摘星阁的字体目录提供思源黑体，只认样式表与字重分片', async () => {
  const reads = [];
  const handler = cangyanlu.createCangyanluProtocolHandler({
    readFile: async file => { reads.push(file); return Buffer.from(path.basename(file)); },
    fontDir: 'C:/fonts'
  });
  const css = await handler(new Request('cangyanlu://app/fonts/source-han-sans-sc/index.css'));
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await css.text(), 'index.css');
  const slice = await handler(new Request('cangyanlu://app/fonts/source-han-sans-sc/noto-sans-sc-42-wght-normal.woff2'));
  assert.equal(slice.status, 200);
  assert.equal(slice.headers.get('content-type'), 'font/woff2');
  await handler(new Request('cangyanlu://app/fonts/source-han-sans-sc/noto-sans-sc-42-wght-normal.woff2'));
  assert.deepEqual(reads, [path.join('C:/fonts', 'index.css'), path.join('C:/fonts', 'noto-sans-sc-42-wght-normal.woff2')], '分片读过一次就走内存');
  for (const url of [
    'cangyanlu://app/fonts/source-han-sans-sc/LICENSE',
    'cangyanlu://app/fonts/source-han-sans-sc/../../../package.json',
    'cangyanlu://app/fonts/source-han-sans-sc/%2e%2e%2findex.css',
    'cangyanlu://app/fonts/source-han-sans-sc/noto-sans-sc-1-wght-normal.woff2.map',
    'cangyanlu://app/fonts/other/index.css',
    'cangyanlu://app/fonts/source-han-sans-sc/'
  ]) assert.equal((await handler({ url, method: 'GET' })).status, 404, url);
  assert.equal(reads.length, 2, '白名单之外的地址不读盘');
  const missing = cangyanlu.createCangyanluProtocolHandler({ readFile: async () => { throw new Error('ENOENT'); } });
  assert.equal((await missing(new Request('cangyanlu://app/fonts/source-han-sans-sc/noto-sans-sc-999-wght-normal.woff2'))).status, 404);
});

test('藏言录引用的字体样式表及其全部分片都能由固定来源提供', async () => {
  assert.equal(path.relative(root, cangyanlu.CANGYANLU_FONT_DIR).split(path.sep).join('/'), 'renderer/fonts/source-han-sans-sc');
  const page = fs.readFileSync(cangyanlu.CANGYANLU_FILE, 'utf8');
  assert.match(page, /location\.protocol === 'cangyanlu:' \? 'fonts\/source-han-sans-sc\/index\.css'/);
  const handler = cangyanlu.createCangyanluProtocolHandler();
  const css = await handler(new Request('cangyanlu://app/fonts/source-han-sans-sc/index.css'));
  const text = await css.text();
  assert.equal(text, fs.readFileSync(path.join(cangyanlu.CANGYANLU_FONT_DIR, 'index.css'), 'utf8'));
  const slices = [...text.matchAll(/url\(\.\/([^)]+)\)/g)].map(match => match[1]);
  assert.ok(slices.length > 90, `分片数量 ${slices.length}`);
  for (const name of [slices[0], 'noto-sans-sc-latin-wght-normal.woff2', slices[slices.length - 1]]) {
    const response = await handler(new Request(`cangyanlu://app/fonts/source-han-sans-sc/${name}`));
    assert.equal(response.status, 200, name);
    assert.ok((await response.arrayBuffer()).byteLength > 1000, name);
  }
  // 每个分片名都必须落在协议的白名单里：数字分片之外还有 latin / latin-ext / cyrillic / vietnamese 四片
  for (const name of slices) {
    const response = await handler({ url: `cangyanlu://app/fonts/source-han-sans-sc/${name}`, method: 'HEAD' });
    assert.equal(response.status, 200, name);
  }
});

test('页面策略只放行内联脚本与样式、同源字体与 Google Fonts、本地图片', () => {
  const policy = cangyanlu.CANGYANLU_CONTENT_SECURITY_POLICY;
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  assert.doesNotMatch(policy, /unsafe-eval|\*|http:/);
});

test('分区网络白名单只认藏言录自己、标题字体与本地数据地址', () => {
  for (const url of [
    'cangyanlu://app/', 'blob:cangyanlu://app/8c6b', 'data:image/svg+xml,%3Csvg%3E',
    'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng', 'https://fonts.gstatic.com/s/x.woff2'
  ]) assert.equal(cangyanlu.isAllowedGuestRequest(url), true, url);
  for (const url of [
    'https://claude.ai/new', 'http://127.0.0.1:7644/api/feed', 'http://fonts.googleapis.com/css2',
    'https://user:pw@fonts.gstatic.com/x', 'blob:https://example.com/1', 'cangyanlu://other/', 'file:///C:/', 'not a url'
  ]) assert.equal(cangyanlu.isAllowedGuestRequest(url), false, url);
});

test('权限只给藏言录来源的复制、文件同步与持久存储', () => {
  for (const permission of ['clipboard-sanitized-write', 'fileSystem', 'persistent-storage']) {
    assert.equal(cangyanlu.isCangyanluPermission(permission, 'cangyanlu://app/'), true, permission);
    assert.equal(cangyanlu.isCangyanluPermission(permission, 'http://127.0.0.1:7644/'), false, permission);
  }
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']) {
    assert.equal(cangyanlu.isCangyanluPermission(permission, 'cangyanlu://app/'), false, permission);
  }
});

test('分区装配协议、权限与请求拦截', async () => {
  const session = {
    protocol: { handle(scheme, handler) { this.scheme = scheme; this.handler = handler; } },
    setPermissionRequestHandler(handler) { this.request = handler; },
    setPermissionCheckHandler(handler) { this.check = handler; },
    setDevicePermissionHandler(handler) { this.device = handler; },
    webRequest: { onBeforeRequest(handler) { this.handler = handler; } }
  };
  const handler = () => {};
  assert.equal(cangyanlu.installCangyanluSession(session, { handler }), session);
  assert.equal(session.protocol.scheme, 'cangyanlu');
  assert.equal(session.protocol.handler, handler);
  const granted = [];
  session.request(null, 'fileSystem', value => granted.push(value), { requestingUrl: 'cangyanlu://app/' });
  session.request(null, 'media', value => granted.push(value), { requestingUrl: 'cangyanlu://app/' });
  assert.deepEqual(granted, [true, false]);
  assert.equal(session.check(null, 'clipboard-sanitized-write', 'cangyanlu://app/'), true);
  assert.equal(session.check(null, 'clipboard-sanitized-write', 'https://example.com/'), false);
  assert.equal(session.device(), false);
  const decisions = [];
  session.webRequest.handler({ url: 'https://claude.ai/new' }, value => decisions.push(value));
  session.webRequest.handler({ url: 'cangyanlu://app/' }, value => decisions.push(value));
  assert.deepEqual(decisions, [{ cancel: true }, { cancel: false }]);
});

test('主窗口只挂载固定地址与分区的 webview，并剥离预加载和 Node 能力', () => {
  const rejected = createEvent();
  assert.equal(cangyanlu.guardCangyanluWebview(rejected, {}, { src: 'https://example.com/', partition: 'persist:cangyanlu' }), false);
  assert.equal(rejected.prevented, true);
  const wrongPartition = createEvent();
  cangyanlu.guardCangyanluWebview(wrongPartition, {}, { src: 'cangyanlu://app/', partition: 'persist:other' });
  assert.equal(wrongPartition.prevented, true);
  const accepted = createEvent();
  const preferences = { preload: 'C:/evil.js', nodeIntegration: true, sandbox: false, contextIsolation: false, webSecurity: false };
  const params = { src: 'cangyanlu://app/', partition: 'persist:cangyanlu', preload: 'file:///C:/evil.js' };
  assert.equal(cangyanlu.guardCangyanluWebview(accepted, preferences, params), true);
  assert.equal(accepted.prevented, false);
  assert.equal('preload' in preferences, false);
  assert.equal('preload' in params, false);
  assert.deepEqual(preferences, {
    partition: 'persist:cangyanlu', nodeIntegration: false, nodeIntegrationInSubFrames: false,
    contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false
  });
});

test('外链交给系统浏览器，window.open 仍拿到句柄，页面不会误报被拦截', () => {
  const guest = createGuest();
  const opened = [];
  const shortcuts = [];
  cangyanlu.configureCangyanluGuest(guest, {
    openExternal: url => opened.push(url),
    isAllowedExternalUrl: url => /^https?:/.test(url),
    onShortcut: value => shortcuts.push(value)
  });
  assert.deepEqual(guest.openHandler({ url: 'https://claude.ai/new' }), {
    action: 'allow', overrideBrowserWindowOptions: { show: false, skipTaskbar: true }
  });
  assert.deepEqual(guest.openHandler({ url: 'file:///C:/' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://claude.ai/new']);
  let destroyed = 0;
  guest.emit('did-create-window', { isDestroyed: () => false, destroy: () => { destroyed += 1; } });
  assert.equal(destroyed, 1);

  const inside = createEvent();
  guest.emit('will-navigate', inside, 'cangyanlu://app/#prompt');
  assert.equal(inside.prevented, false);
  const outside = createEvent();
  guest.emit('will-navigate', outside, 'https://example.com/');
  assert.equal(outside.prevented, true);
  assert.deepEqual(opened, ['https://claude.ai/new', 'https://example.com/']);

  const alt = createEvent();
  guest.emit('before-input-event', alt, { type: 'keyDown', key: '7', alt: true, control: false, meta: false, shift: false });
  assert.equal(alt.prevented, true);
  for (const input of [
    { type: 'keyUp', key: '7', alt: true },
    { type: 'keyDown', key: 'k', alt: true },
    { type: 'keyDown', key: '7', alt: true, control: true },
    { type: 'keyDown', key: '7', alt: false }
  ]) {
    const event = createEvent();
    guest.emit('before-input-event', event, input);
    assert.equal(event.prevented, false, JSON.stringify(input));
  }
  assert.deepEqual(shortcuts, [{ key: '7' }]);
});

test('主进程与预加载接入藏言录 webview 守卫和 Alt 转发', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.match(main, /webviewTag: true/);
  assert.match(main, /win\.webContents\.on\('will-attach-webview', cangyanlu\.guardCangyanluWebview\)/);
  assert.match(main, /did-attach-webview[\s\S]{0,200}configureCangyanluGuest\(guest/);
  assert.match(main, /win\.webContents\.send\('cangyanlu:shortcut', shortcut\)/);
  assert.match(preload, /onCangyanluShortcut: cb =>/);
  assert.match(preload, /ipcRenderer\.on\('cangyanlu:shortcut', listener\)/);
});
