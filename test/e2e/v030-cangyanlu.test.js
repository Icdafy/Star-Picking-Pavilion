'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const Schema = require('../../renderer/ui-preference-schema');
const CommonLinks = require('../../renderer/common-links');

const root = path.join(__dirname, '../..');
const bundledSha256 = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'electron', 'cangyanlu', '藏言录.html'))).digest('hex');

// 藏言录在独立的 guest WebContents 里运行，经主进程直接执行脚本，不依赖 CDP 能否看到 webview 目标。
function guest(app, code, userGesture = false) {
  return app.evaluate(async ({ webContents }, input) => {
    const contents = webContents.getAllWebContents().find(item => item.getType() === 'webview' && !item.isDestroyed());
    if (!contents) throw new Error('藏言录 guest 不存在');
    return contents.executeJavaScript(input.code, input.userGesture);
  }, { code, userGesture });
}

function guestCount(app) {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter(item => item.getType() === 'webview' && !item.isDestroyed()).length);
}

async function waitFor(check, message, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

// 常驻帧计数：CI 运行器没有显卡，小岛走软件渲染只有每秒几帧，所以只比较“隐藏时不动、回来后继续走”，
// 不假定任何固定帧率。
const startFrameCounter = "window.__sppFrames = 0; (function tick() { window.__sppFrames += 1; requestAnimationFrame(tick); })(); true";
const readFrames = 'window.__sppFrames';

async function present(app, page) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1440, 920);
    win.showInactive();
  });
  await page.waitForFunction(() => innerWidth === 1440 && innerHeight === 920);
}

test('v030 藏言录模块：固定来源、持久存储、隔离分区与桌面集成', { timeout: 240_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v030-cangyanlu-'));
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'all', realtime: false, aquaEnabled: false }));
  let app = await launchNativeElectron(root, directory);
  t.after(async () => {
    await app.close();
    const cleanupTarget = path.resolve(directory);
    assert.equal(path.dirname(cleanupTarget), path.resolve(os.tmpdir()));
    assert.match(path.basename(cleanupTarget), /^spp-v030-cangyanlu-[a-zA-Z0-9]+$/);
    await fs.promises.rm(cleanupTarget, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  let page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForSelector('.nav');
  await present(app, page);

  // 工作区改名，藏言录排在常用网址之后
  assert.equal(await page.locator('.rail-section-label').textContent(), '工作区');
  assert.equal(await page.locator('.rail-footer strong').textContent(), '本地工作区');
  const order = await page.locator('.nav-tabs .tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.view));
  assert.equal(order.indexOf('prompts'), order.indexOf('links') + 1);
  assert.equal(order.length, 11);

  // 未进入前不加载；主界面也不能挂载任何别的 webview
  assert.equal(await page.locator('#cangyanluHost webview').count(), 0);
  await page.evaluate(() => {
    const rogue = document.createElement('webview');
    rogue.id = 'rogueWebview';
    rogue.setAttribute('partition', 'persist:rogue');
    rogue.src = 'https://example.com/';
    document.body.appendChild(rogue);
  });
  await page.waitForTimeout(1500);
  assert.equal(await guestCount(app), 0, '固定地址与分区之外的 webview 必须被拒绝挂载');
  await page.evaluate(() => document.getElementById('rogueWebview').remove());

  await page.locator('.tab[data-view="prompts"]').click();
  await page.waitForFunction(() => document.getElementById('cangyanluHost').dataset.state === 'ready', null, { timeout: 30_000 });
  assert.equal(await guestCount(app), 1);
  const identity = await app.evaluate(async ({ webContents, session }) => {
    const contents = webContents.getAllWebContents().find(item => item.getType() === 'webview');
    const response = await session.fromPartition('persist:cangyanlu').fetch('cangyanlu://app/');
    const body = Buffer.from(await response.arrayBuffer());
    return {
      url: contents.getURL(),
      partition: contents.session === session.fromPartition('persist:cangyanlu'),
      status: response.status,
      csp: response.headers.get('content-security-policy'),
      sha256: require('node:crypto').createHash('sha256').update(body).digest('hex')
    };
  });
  assert.deepEqual({ ...identity, csp: undefined }, {
    url: 'cangyanlu://app/', partition: true, status: 200, csp: undefined, sha256: bundledSha256
  });
  assert.match(identity.csp, /default-src 'none'/);
  assert.deepEqual(await guest(app, `({ origin: location.origin, title: document.title, secure: isSecureContext,
    bridge: typeof window.starPickingPavilion, node: typeof require + typeof process })`), {
    origin: 'cangyanlu://app', title: '藏言录', secure: true, bridge: 'undefined', node: 'undefinedundefined'
  });

  // 宽屏铺满：从吸顶塔台下方到视口底端，不产生页面滚动
  const fit = await page.evaluate(() => {
    const viewport = document.getElementById('appViewport');
    const box = document.getElementById('cangyanluHost').getBoundingClientRect();
    const tower = document.querySelector('.tower').getBoundingClientRect();
    return { overflow: viewport.scrollHeight - viewport.clientHeight, top: box.top - tower.bottom, bottom: innerHeight - box.bottom, height: box.height };
  });
  assert.ok(fit.overflow <= 1, `藏言录视图不应让页面滚动：${JSON.stringify(fit)}`);
  assert.ok(fit.top >= 0 && fit.top < 40 && fit.bottom >= 0 && fit.bottom < 40 && fit.height > 650, JSON.stringify(fit));

  // 藏言录写下自己的数据后再打标记，重启后两者都必须还在
  await waitFor(() => guest(app, "localStorage.getItem('cangyanlu.v1') !== null"), '藏言录没有写入本地数据');
  await guest(app, "localStorage.setItem('spp.e2e.marker', 'v030'); true");

  // v0.3.1 黄金分割版式：等入场动画落定再量。顶栏三卡同顶同高、品牌卡与目录栏同宽，
  // 面板底栏与工具坞落在同一条底线，详情栏 : 小岛舞台 = 1 : φ；嵌在摘星阁里时教程按摘星阁措辞
  await waitFor(() => guest(app, "document.getAnimations().every(a => a.animationName !== 'hudIn' || a.playState === 'finished')"), '藏言录入场动画没有结束');
  const golden = await guest(app, `(() => {
    const box = s => document.querySelector(s).getBoundingClientRect();
    const css = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n));
    const brand = box('.brand'), stats = box('#stats'), clock = box('#clock'), lib = box('#lib'), dock = box('#dock'), foot = box('.lib-foot');
    const g = css('--g'), bar = css('--bar'), detail = document.getElementById('detail').offsetWidth;
    const guide = JSON.parse(localStorage.getItem('cangyanlu.v1')).prompts.find(p => p.id === 'p-guide-4');
    return { vw: innerWidth, g, bar, tops: [brand.top, stats.top, clock.top], heights: [brand.height, stats.height, clock.height],
      brand: brand.width, lib: lib.width, libTop: lib.top, libBottom: lib.bottom, footTop: foot.top, dockTop: dock.top, dockBottom: dock.bottom, dockHeight: dock.height,
      phi: (innerWidth - lib.width - detail - g * 4) / detail, hostWording: guide.content.includes('摘星阁') && !guide.content.includes('无痕') };
  })()`);
  const near = (a, b, tolerance = 0.75) => Math.abs(a - b) <= tolerance;
  assert.ok(golden.vw > 1000 && golden.vw < 1200 && golden.g === 13 && golden.bar === 56, `默认窗口下藏言录应取紧凑档：${JSON.stringify(golden)}`);
  assert.ok(golden.tops.every(top => near(top, golden.g)) && golden.heights.every(height => near(height, golden.bar)), `顶栏三卡应同顶同高：${JSON.stringify(golden)}`);
  assert.ok(near(golden.brand, golden.lib) && golden.lib <= 270 && near(golden.libTop, golden.g * 2 + golden.bar), `品牌卡与目录栏应同宽且目录栏收窄：${JSON.stringify(golden)}`);
  assert.ok(near(golden.libBottom, golden.dockBottom) && near(golden.footTop, golden.dockTop) && near(golden.dockHeight, golden.bar), `目录底栏与工具坞应上下缘对齐：${JSON.stringify(golden)}`);
  assert.ok(Math.abs(golden.phi - 1.618) < 0.02, `小岛舞台 : 详情栏应为 φ：${JSON.stringify(golden)}`);
  assert.equal(golden.hostWording, true, '嵌在摘星阁里时，新手教程应说明数据保存在摘星阁里');

  // 权限只放行复制，其余照旧拒绝
  assert.equal(await guest(app, "navigator.permissions.query({ name: 'clipboard-write' }).then(status => status.state)"), 'granted');
  assert.equal(await guest(app, "navigator.permissions.query({ name: 'geolocation' }).then(status => status.state)"), 'denied');

  // 外链交给系统浏览器，window.open 拿到句柄，不留下任何窗口；导航离开藏言录同样被接管
  await app.evaluate(({ shell }) => {
    globalThis.__cylOpened = [];
    shell.openExternal = async url => { globalThis.__cylOpened.push(url); };
  });
  assert.equal(await guest(app, "(() => { const w = window.open('https://claude.ai/new', '_blank'); if (w) w.opener = null; return Boolean(w); })()", true), true);
  assert.equal(await guest(app, "Boolean(window.open('file:///C:/Windows/', '_blank'))", true), false);
  await guest(app, "location.href = 'https://example.com/landing'; true", true);
  await page.waitForTimeout(800);
  assert.deepEqual(await app.evaluate(({ BrowserWindow, webContents }) => ({
    windows: BrowserWindow.getAllWindows().length,
    opened: globalThis.__cylOpened,
    url: webContents.getAllWebContents().find(item => item.getType() === 'webview').getURL()
  })), { windows: 1, opened: ['https://claude.ai/new', 'https://example.com/landing'], url: 'cangyanlu://app/' });

  // 导出走原生下载，落到用户选择的位置
  const download = path.join(directory, 'cangyanlu-export.json');
  await app.evaluate(({ session }, target) => {
    globalThis.__cylDownload = null;
    session.fromPartition('persist:cangyanlu').once('will-download', (_event, item) => {
      item.setSavePath(target);
      item.once('done', (_done, state) => { globalThis.__cylDownload = state; });
    });
  }, download);
  await guest(app, `(() => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['{"prompts":[]}'], { type: 'application/json' }));
    link.download = '藏言录-备份.json';
    document.body.appendChild(link); link.click(); link.remove();
    return true;
  })()`, true);
  await waitFor(() => app.evaluate(() => globalThis.__cylDownload === 'completed'), '藏言录导出没有完成');
  assert.equal(fs.readFileSync(download, 'utf8'), '{"prompts":[]}');

  // 焦点在藏言录里时 Alt+数字仍切换视图；隐藏后它停止出帧，回来后继续
  await guest(app, startFrameCounter);
  await waitFor(async () => await guest(app, readFrames) >= 3, '可见的藏言录应持续出帧');
  await app.evaluate(({ webContents }) => {
    const contents = webContents.getAllWebContents().find(item => item.getType() === 'webview');
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: '7', modifiers: ['alt'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: '7', modifiers: ['alt'] });
  });
  await page.waitForSelector('#viewReleases:not([hidden])');
  assert.equal(await page.locator('#viewPrompts').isHidden(), true);
  await page.waitForTimeout(300);
  const hiddenStart = await guest(app, readFrames);
  await page.waitForTimeout(1500);
  const hiddenEnd = await guest(app, readFrames);
  console.log(`v030 hidden frames: ${hiddenEnd - hiddenStart} in 1.5 s`);
  assert.ok(hiddenEnd - hiddenStart <= 2, `隐藏的藏言录不应继续渲染：1.5 秒内 ${hiddenEnd - hiddenStart} 帧`);
  await page.locator('.tab[data-view="prompts"]').click();
  await waitFor(async () => await guest(app, readFrames) - hiddenEnd >= 3, '回到藏言录后应恢复渲染');
  assert.equal(await guestCount(app), 1, '切换视图复用同一个 webview');

  // 重启：回到上次的藏言录视图，数据仍在
  await waitFor(() => {
    try { return JSON.parse(fs.readFileSync(path.join(directory, 'ui-preferences.json'), 'utf8')).view === 'prompts'; }
    catch { return false; }
  }, '视图偏好没有保存为藏言录');
  await app.close();
  app = await launchNativeElectron(root, directory);
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await present(app, page);
  await page.waitForFunction(() => document.getElementById('cangyanluHost').dataset.state === 'ready', null, { timeout: 30_000 });
  assert.equal(await page.locator('.tab[data-view="prompts"]').getAttribute('aria-selected'), 'true');
  assert.deepEqual(await guest(app, "({ marker: localStorage.getItem('spp.e2e.marker'), saved: localStorage.getItem('cangyanlu.v1') !== null })"),
    { marker: 'v030', saved: true });
});
