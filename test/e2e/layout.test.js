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

  for (const size of WINDOWS) {
    await app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0].setSize(value.width, value.height);
    }, size);
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
        assert.equal(result.visibleTabs, 8, `${label} 主导航不完整`);
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
});
