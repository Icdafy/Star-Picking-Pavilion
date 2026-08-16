'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..', '..');
const fixture = path.join(__dirname, 'fixtures', 'empty-settings.json');
const WINDOWS = [
  { width: 800, height: 600 },
  { width: 1080, height: 680 },
  { width: 1440, height: 920 },
  { width: 1920, height: 1080 }
];
const SCALES = ['sm', 'md', 'lg', 'xl'];
const VIEWS = ['featured', 'daily', 'links', 'sources', 'settings'];

test('全部窗口、缩放和核心视图无横向溢出且主导航完整可见', { timeout: 120_000 }, async t => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-layout-'));
  const screenshotDir = process.env.SPP_LAYOUT_SCREENSHOT_DIR;
  await fs.promises.copyFile(fixture, path.join(dataDir, 'settings.json'));
  if (screenshotDir) await fs.promises.mkdir(screenshotDir, { recursive: true });
  const app = await electron.launch({
    args: ['.', '--hidden'],
    cwd: projectRoot,
    env: {
      ...process.env,
      STAR_PICKING_PAVILION_TEST_DATA_DIR: dataDir,
      STAR_PICKING_PAVILION_NO_SCHEDULER: '1',
      STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1'
    }
  });
  t.after(async () => {
    await app.close().catch(() => {});
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  const page = await app.firstWindow();
  await page.waitForSelector('.nav');
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize()),
    [800, 600]
  );
  // Windows 上隐藏的 BrowserWindow 可能只更新 outerWidth，却不立即重排
  // renderer 内容区；这会让后续所有“宽屏”用例其实仍在 800px 下运行。
  // showInactive 使内容面真实参与布局，但不抢占用户焦点。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());

  for (const size of WINDOWS) {
    await app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0].setContentSize(value.width, value.height);
    }, size);
    await page.waitForFunction(
      value => innerWidth === value.width && innerHeight === value.height,
      size
    );
    const expectedWide = size.width >= 70 * 16;
    await page.waitForFunction(
      expected => document.querySelector('.nav-tabs')?.getAttribute('aria-orientation') === expected,
      expectedWide ? 'vertical' : 'horizontal'
    );
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      wide: matchMedia('(min-width: 70rem)').matches,
      orientation: document.querySelector('.nav-tabs')?.getAttribute('aria-orientation')
    }));
    assert.deepEqual(
      [viewport.width, viewport.height],
      [size.width, size.height],
      `${size.width}×${size.height} 未真实应用到 renderer 内容区`
    );
    assert.equal(viewport.wide, expectedWide, `${size.width}×${size.height} 宽屏媒体查询异常`);
    assert.equal(
      viewport.orientation,
      expectedWide ? 'vertical' : 'horizontal',
      `${size.width}×${size.height} 导航方向与外壳布局不一致`
    );
    for (const scale of SCALES) {
      await page.evaluate(value => {
        document.documentElement.dataset.uiScale = value;
        window.dispatchEvent(new Event('resize'));
      }, scale);
      for (const view of VIEWS) {
        await page.locator(`.tab[data-view="${view}"]`).click();
        await page.waitForTimeout(40);
        const result = await page.evaluate(() => {
          const navTabs = [...document.querySelectorAll('.nav-tabs .tab')];
          const interactive = [...document.querySelectorAll(
            'button:not([hidden]), a[href]:not([hidden]), input:not([hidden]), select:not([hidden]), textarea:not([hidden])'
          )].filter(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && rect.width > 0
              && rect.height > 0;
          });
          const overflowers = interactive.map(element => {
            const rect = element.getBoundingClientRect();
            return {
              id: element.id,
              className: String(element.className || ''),
              text: String(element.textContent || element.value || '').trim().slice(0, 40),
              left: rect.left,
              right: rect.right
            };
          }).filter(item => item.left < -1 || item.right > innerWidth + 1);
          return {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            visibleTabs: navTabs.filter(tab => {
              const rect = tab.getBoundingClientRect();
              const style = getComputedStyle(tab);
              return style.display !== 'none'
                && rect.width > 0
                && rect.left >= -1
                && rect.right <= innerWidth + 1;
            }).length,
            overflowers
          };
        });
        const label = `${size.width}×${size.height}/${scale}/${view}`;
        assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label} 文档横向溢出`);
        assert.equal(result.visibleTabs, 7, `${label} 主导航不完整`);
        assert.deepEqual(result.overflowers, [], `${label} 存在交互元素越界`);
        if (
          screenshotDir
          && ((size.width === 800 && scale === 'xl') || (
            size.width === 1440 && scale === 'xl' && view === 'featured'
          ))
        ) {
          await page.screenshot({
            path: path.join(screenshotDir, `${size.width}x${size.height}-${scale}-${view}.png`),
            fullPage: true
          });
        }
      }
    }
  }

  // 宽屏外壳必须真正粘在视口上。body 的 overflow-x 若退回 hidden，浏览器会
  // 把它计算成非滚动 sticky 容器，侧栏与塔台会在长设置页一起滚出屏幕。
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 920);
  });
  await page.waitForFunction(() => innerWidth === 1440 && innerHeight === 920);
  await page.evaluate(() => {
    document.documentElement.dataset.uiScale = 'md';
    window.dispatchEvent(new Event('resize'));
  });
  await page.locator('.tab[data-view="settings"]').click();
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 2000);
  });
  await page.waitForTimeout(80);
  const sticky = await page.evaluate(() => {
    const rail = document.querySelector('.command-rail');
    const tower = document.querySelector('.tower');
    const measure = element => ({
      top: element.getBoundingClientRect().top,
      expectedTop: Number.parseFloat(getComputedStyle(element).top),
      position: getComputedStyle(element).position
    });
    return {
      scrollY,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      rail: measure(rail),
      tower: measure(tower)
    };
  });
  assert.ok(sticky.scrollY > 500, '设置页必须足够长，sticky 验证才有意义');
  assert.equal(sticky.bodyOverflowX, 'clip');
  for (const [name, measured] of Object.entries({ rail: sticky.rail, tower: sticky.tower })) {
    assert.equal(measured.position, 'sticky', `${name} 未启用 sticky`);
    assert.ok(
      Math.abs(measured.top - measured.expectedTop) <= 2,
      `${name} 已滚出视口：top=${measured.top}, expected=${measured.expectedTop}`
    );
  }

  // 主题切换必须同时落到 renderer 与原生窗口。这里在主进程实例上记录
  // BrowserWindow 调用，避免只验证网页颜色、却漏掉标题栏仍停在旧主题。
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    globalThis.__sppWindowThemeTrace = [];
    const originalBackground = window.setBackgroundColor.bind(window);
    const originalOverlay = window.setTitleBarOverlay.bind(window);
    window.setBackgroundColor = value => {
      globalThis.__sppWindowThemeTrace.push({ method: 'background', value });
      return originalBackground(value);
    };
    window.setTitleBarOverlay = value => {
      globalThis.__sppWindowThemeTrace.push({ method: 'overlay', value });
      return originalOverlay(value);
    };
  });
  await page.locator('.tab[data-view="featured"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#btnTheme').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  let themeTrace = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    themeTrace = await app.evaluate(() => globalThis.__sppWindowThemeTrace || []);
    if (themeTrace.length >= 2) break;
    await page.waitForTimeout(20);
  }
  assert.deepEqual(themeTrace.slice(-2), [
    { method: 'background', value: '#ffffff' },
    {
      method: 'overlay',
      value: { color: 'rgba(0, 0, 0, 0)', symbolColor: '#0f1115' }
    }
  ]);
  assert.deepEqual(await page.evaluate(() => ({
    bodyDark: document.body.hasAttribute('data-ds-dark-theme'),
    colorScheme: document.documentElement.style.colorScheme,
    dshEngine: document.documentElement.dataset.dshEngine,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content
  })), {
    bodyDark: false,
    colorScheme: 'light',
    dshEngine: 'plugin-1.1.0',
    themeColor: '#ffffff'
  });

  // 配色预设必须随主题换一整套，而不是深浅主题共用一组发灰的颜色；
  // 点击预设同时更新色相、明暗、滑杆和选中态。
  await page.locator('.tab[data-view="settings"]').click();
  await page.locator('#aquaPalettePresets [data-aqua-palette="rain-jade"]').click();
  assert.deepEqual(await page.evaluate(() => ({
    theme: document.querySelector('#aquaPalettePresets')?.dataset.paletteTheme,
    count: document.querySelectorAll('#aquaPalettePresets [data-aqua-palette]').length,
    hue: document.querySelector('#setAquaHue')?.value,
    brightness: document.querySelector('#setAquaBrightness')?.value,
    selected: document.querySelector('#aquaPalettePresets [aria-pressed="true"]')?.dataset.aquaPalette,
    fluidHueRotation: document.documentElement.style.getPropertyValue('--dsh-aqua-fluid-hue-rotation'),
    white: document.documentElement.style.getPropertyValue('--dsh-aqua-brightness-white')
  })), {
    theme: 'light', count: 6, hue: '170', brightness: '62', selected: 'rain-jade',
    fluidHueRotation: '310deg', white: '0.240'
  });
  await page.locator('#btnTheme').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.locator('#aquaPalettePresets [data-aqua-palette="deep-violet"]').click();
  assert.deepEqual(await page.evaluate(() => ({
    theme: document.querySelector('#aquaPalettePresets')?.dataset.paletteTheme,
    count: document.querySelectorAll('#aquaPalettePresets [data-aqua-palette]').length,
    hue: document.querySelector('#setAquaHue')?.value,
    brightness: document.querySelector('#setAquaBrightness')?.value,
    selected: document.querySelector('#aquaPalettePresets [aria-pressed="true"]')?.dataset.aquaPalette,
    fluidHueRotation: document.documentElement.style.getPropertyValue('--dsh-aqua-fluid-hue-rotation'),
    black: document.documentElement.style.getPropertyValue('--dsh-aqua-brightness-black')
  })), {
    theme: 'dark', count: 6, hue: '260', brightness: '38', selected: 'deep-violet',
    fluidHueRotation: '40deg', black: '0.240'
  });

  // 复现用户截图的长列表滚动状态：塔台不得钻入原生标题栏，日期标题应在
  // 塔台之后吸附，并且日期内容只是紧凑的液态玻璃胶囊而非整条实色块。
  await page.locator('.tab[data-view="featured"]').click();
  await page.evaluate(() => {
    const list = document.querySelector('#feedList');
    const group = document.createElement('div');
    group.className = 'date-group';
    const head = document.createElement('div');
    head.className = 'date-head';
    head.innerHTML = '<span class="date-head-glass"><span class="dh-label">今天</span><span class="dh-count">12 条</span></span>';
    const runway = document.createElement('div');
    runway.style.height = '2200px';
    group.append(head, runway);
    list.replaceChildren(group);
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, group.offsetTop + 180);
  });
  await page.waitForTimeout(80);
  const overlap = await page.evaluate(() => {
    const tower = document.querySelector('.tower');
    const head = document.querySelector('.date-head');
    const glass = document.querySelector('.date-head-glass');
    const towerRect = tower.getBoundingClientRect();
    const headRect = head.getBoundingClientRect();
    const glassRect = glass.getBoundingClientRect();
    const glassStyle = getComputedStyle(glass);
    return {
      titlebarHeight: Number.parseFloat(getComputedStyle(document.body).paddingTop),
      towerTop: towerRect.top,
      towerBottom: towerRect.bottom,
      headTop: headRect.top,
      headWidth: headRect.width,
      glassWidth: glassRect.width,
      glassBackground: glassStyle.backgroundImage,
      glassBackdrop: glassStyle.backdropFilter,
      glassRadius: Number.parseFloat(glassStyle.borderTopLeftRadius)
    };
  });
  assert.ok(overlap.towerTop >= overlap.titlebarHeight + 8, `塔台侵入标题栏：${JSON.stringify(overlap)}`);
  assert.ok(overlap.headTop >= overlap.towerBottom + 4, `日期标题侵入塔台：${JSON.stringify(overlap)}`);
  assert.ok(overlap.glassWidth < overlap.headWidth * .4, `日期标题仍是整条色块：${JSON.stringify(overlap)}`);
  assert.notEqual(overlap.glassBackground, 'none');
  assert.match(overlap.glassBackdrop, /blur\(/);
  assert.ok(overlap.glassRadius >= 20);
  if (screenshotDir) {
    await page.screenshot({
      path: path.join(screenshotDir, '1440x920-md-date-scroll-dark.png'),
      fullPage: false
    });
    await page.locator('#btnTheme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.screenshot({
      path: path.join(screenshotDir, '1440x920-md-date-scroll-light.png'),
      fullPage: false
    });
    await page.screenshot({
      path: path.join(screenshotDir, '1440x920-md-featured-light.png'),
      fullPage: true
    });
  }
});
