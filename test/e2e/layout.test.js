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
});
