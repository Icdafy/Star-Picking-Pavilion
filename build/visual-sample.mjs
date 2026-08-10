'use strict';

// 液态玻璃重构终验：视觉抽样截图脚本（临时验证脚本，保留于 build/ 以便复查）。
// 用法：node build/visual-sample.mjs
// 产出：build/liquid-glass-shots/01-dark-featured.png ... 06-light-links.png
// 启动方式与 test/e2e/layout.test.js 一致：args ['.', '--hidden']、临时数据目录、
// STAR_PICKING_PAVILION_NO_SCHEDULER=1。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(projectRoot, 'test', 'e2e', 'fixtures', 'empty-settings.json');
const shotDir = path.join(projectRoot, 'build', 'liquid-glass-shots');

const VIEWS = [
  { view: 'featured', file: '01-dark-featured.png' },
  { view: 'daily', file: '02-dark-daily.png' },
  { view: 'sources', file: '03-dark-sources.png' },
  { view: 'settings', file: '04-dark-settings.png' }
];
const LIGHT_VIEWS = [
  { view: 'featured', file: '05-light-featured.png' },
  { view: 'links', file: '06-light-links.png' }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function shoot(page, file, label) {
  await sleep(400); // 等待入场动画收敛
  const fxTier = await page.evaluate(() => document.documentElement.dataset.fxTier ?? '');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  await page.screenshot({ path: path.join(shotDir, file) });
  console.log(`[shot] ${file}  view=${label}  theme=${theme}  fxTier=${fxTier}`);
  return { file, view: label, theme, fxTier };
}

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-visual-'));
  await fs.promises.copyFile(fixture, path.join(dataDir, 'settings.json'));

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

  const results = [];
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.nav');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 920);
    });
    await sleep(300);

    // 确保起始为暗色主题（默认 dark，防御性检查）
    const startTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (startTheme !== 'dark') {
      await page.locator('#btnTheme').click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5_000 });
      await sleep(300);
    }

    // 暗色主题（默认）各视图
    for (const { view, file } of VIEWS) {
      await page.locator(`.tab[data-view="${view}"]`).click();
      results.push(await shoot(page, file, view));
    }

    // 切换到亮色主题：优先点击 #btnTheme
    await page.locator('#btnTheme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5_000 });
    await sleep(300);

    for (const { view, file } of LIGHT_VIEWS) {
      await page.locator(`.tab[data-view="${view}"]`).click();
      results.push(await shoot(page, file, view));
    }
  } finally {
    await app.close().catch(() => {});
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }

  console.log('\nfxTier summary:', JSON.stringify(results.map(r => `${r.file}:${r.fxTier}`), null, 2));
  console.log(`done: ${results.length} screenshots in ${shotDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
