'use strict';

// 藏言录（提示词仓库）作为摘星阁的独立模块运行。随包附带的单文件页面原样不改，
// 由主进程以固定来源 cangyanlu://app 提供，在专属持久分区里作为 <webview> 的顶层文档运行：
//   - 固定来源：localStorage / IndexedDB 不随后端的随机端口变化，重启后提示词仍在；
//   - 顶层文档：文件同步的系统选择器、剪贴板与隐藏时暂停渲染都按它自己的设计工作；
//   - 专属分区：它的数据、权限和网络请求与摘星阁主界面彻底分开。
const fs = require('node:fs');
const path = require('node:path');

const CANGYANLU_SCHEME = 'cangyanlu';
const CANGYANLU_HOST = 'app';
const CANGYANLU_URL = `${CANGYANLU_SCHEME}://${CANGYANLU_HOST}/`;
const CANGYANLU_PARTITION = 'persist:cangyanlu';
const CANGYANLU_FILE = path.join(__dirname, 'cangyanlu', '藏言录.html');
// 页面唯一的外部请求是标题书法字体的子集；连不上时它自己换用系统楷体。
const FONT_ORIGINS = Object.freeze(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
const CANGYANLU_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  'img-src data: blob:',
  "connect-src 'none'"
].join('; ');
const RESPONSE_HEADERS = Object.freeze({
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': CANGYANLU_CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
});
// 复制提示词、绑定本地数据文件、申请持久存储；其余权限一律拒绝。
const GUEST_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fileSystem', 'persistent-storage']);

function parseUrl(value) {
  try { return new URL(String(value || '')); } catch { return null; }
}

// 非特殊协议在 WHATWG URL 里的 origin 恒为 "null"，只能按协议与主机比对。
function isCangyanluUrl(value) {
  const url = parseUrl(value);
  if (!url || url.username || url.password) return false;
  if (url.protocol === 'blob:') return isCangyanluUrl(url.pathname);
  return url.protocol === `${CANGYANLU_SCHEME}:` && url.host === CANGYANLU_HOST;
}

function isAllowedGuestRequest(value) {
  const url = parseUrl(value);
  if (!url) return false;
  if (url.protocol === 'data:' || url.protocol === 'devtools:') return true;
  if (url.protocol === 'blob:' || url.protocol === `${CANGYANLU_SCHEME}:`) return isCangyanluUrl(url.href);
  return url.protocol === 'https:' && !url.username && !url.password && FONT_ORIGINS.includes(url.origin);
}

function isCangyanluPermission(permission, requestingUrl) {
  return GUEST_PERMISSIONS.has(permission) && isCangyanluUrl(requestingUrl);
}

function registerCangyanluScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{
    scheme: CANGYANLU_SCHEME,
    privileges: { standard: true, secure: true }
  }]);
}

function createCangyanluProtocolHandler({ readFile = fs.promises.readFile, file = CANGYANLU_FILE } = {}) {
  let page = null;
  return async request => {
    const url = parseUrl(request?.url);
    if (!isCangyanluUrl(url?.href) || url.protocol === 'blob:' || !['/', '/index.html'].includes(url.pathname)) {
      return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    page ||= await readFile(file);
    return new Response(method === 'HEAD' ? null : page, { status: 200, headers: RESPONSE_HEADERS });
  };
}

function installCangyanluSession(session, { handler = createCangyanluProtocolHandler() } = {}) {
  session.protocol.handle(CANGYANLU_SCHEME, handler);
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(isCangyanluPermission(permission, details?.requestingUrl));
  });
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => (
    isCangyanluPermission(permission, requestingOrigin || details?.requestingUrl)
  ));
  session.setDevicePermissionHandler?.(() => false);
  // 分区只认藏言录自己、字体子集与本地数据地址；window.open 留下的空壳窗口也走不出去。
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedGuestRequest(details.url) });
  });
  return session;
}

// 主窗口里唯一允许挂载的 webview：地址与分区固定，预加载与 Node 能力一律剥离。
function guardCangyanluWebview(event, webPreferences, params) {
  if (params?.src !== CANGYANLU_URL || params?.partition !== CANGYANLU_PARTITION) {
    event.preventDefault();
    return false;
  }
  delete webPreferences.preload;
  delete params.preload;
  Object.assign(webPreferences, {
    partition: CANGYANLU_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false
  });
  return true;
}

function configureCangyanluGuest(guest, { openExternal, isAllowedExternalUrl, onShortcut } = {}) {
  guest.setWindowOpenHandler(({ url }) => {
    if (!isAllowedExternalUrl(url)) return { action: 'deny' };
    openExternal(url);
    // 「复制并打开 Claude」等入口按 window.open 的返回值判断是否被拦截：放行一个不显示的
    // 空壳拿到句柄，随即销毁；分区的请求白名单保证它不会真的连上外部站点。
    return { action: 'allow', overrideBrowserWindowOptions: { show: false, skipTaskbar: true } };
  });
  guest.on('did-create-window', child => { if (!child.isDestroyed()) child.destroy(); });
  guest.on('will-navigate', (event, url) => {
    if (isCangyanluUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) openExternal(url);
  });
  // 藏言录不使用 Alt 组合键：焦点在它里面时，Alt+数字仍按摘星阁的习惯切换视图。
  guest.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.alt || input.control || input.meta || input.shift) return;
    if (!/^[0-9]$/.test(input.key) || typeof onShortcut !== 'function') return;
    event.preventDefault();
    onShortcut({ key: input.key });
  });
}

module.exports = {
  CANGYANLU_SCHEME,
  CANGYANLU_URL,
  CANGYANLU_PARTITION,
  CANGYANLU_FILE,
  CANGYANLU_CONTENT_SECURITY_POLICY,
  isCangyanluUrl,
  isAllowedGuestRequest,
  isCangyanluPermission,
  registerCangyanluScheme,
  createCangyanluProtocolHandler,
  installCangyanluSession,
  guardCangyanluWebview,
  configureCangyanluGuest
};
