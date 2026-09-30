'use strict';
// v0.2.4 真实 Electron：Ctrl+K 命令面板（combobox 语义、拼音首字母命中、执行后关闭并归还焦点、
// 检索穿透）、G 跳转序列，以及 DeepSeek 默认分析模型换成 V4.1 Flash（deepseek-flash）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..', '..');

test('command palette, go-to sequences and the V4.1 Flash default model', { timeout: 120_000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v024-ui-'));
  // 旧版设置：选的是已退役的 deepseek-v4-flash，启动后应自动改指 V4.1 Flash
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ai: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' } }));
  const app = await electron.launch({ args: ['.', '--hidden'], cwd: root, env: { ...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR: dir, STAR_PICKING_PAVILION_NO_SCHEDULER: '1', STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1' } });
  t.after(async () => { await app.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForLoadState('load');
  await page.waitForSelector('.nav');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1280, 860); w.showInactive(); });
  const activeView = () => page.evaluate(() => document.querySelector('.tab.active')?.dataset.view);
  const palette = page.locator('#commandPalette');
  const input = page.locator('#paletteInput');

  // Ctrl+K 打开：输入框持焦、combobox 展开、第一项高亮
  await page.locator('.tab[data-view="featured"]').click();
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'paletteInput');
  assert.equal(await input.getAttribute('aria-expanded'), 'true');
  assert.equal(await input.getAttribute('aria-activedescendant'), 'palette-opt-0');
  const labels = await page.locator('#paletteList .palette-label').allTextContents();
  for (const name of ['精选', '热点', '一级市场', '全部动态', '星标', '情报日报', '常用网址', '信源', '设置']) {
    assert.ok(labels.includes(name), `面板缺少跳转命令 ${name}`);
  }

  // 拼音首字母命中 → Enter 执行 → 面板关闭
  await input.fill('qbrb');
  assert.equal((await page.locator('#paletteList [role="option"] .palette-label').first().textContent()).trim(), '情报日报');
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'hidden' });
  assert.equal(await activeView(), 'daily');

  // 方向键移动高亮，aria-activedescendant 跟随；Esc 关闭并把焦点还给触发前的位置
  await page.locator('#btnPalette').focus();
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  assert.equal(await input.getAttribute('aria-activedescendant'), 'palette-opt-1');
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.id === 'btnPalette');

  // 没有命令命中时，输入词直接落到情报库检索
  await page.keyboard.press('Control+k');
  await input.fill('朱雀三号');
  const options = await page.locator('#paletteList [role="option"]').allTextContents();
  assert.equal(options.length, 1);
  assert.match(options[0], /在情报库中检索「朱雀三号」/);
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.tab.active')?.dataset.view === 'all');
  assert.equal(await page.inputValue('#searchInput'), '朱雀三号');
  await page.locator('#searchClear').click();

  // G 跳转序列（焦点不在输入框时）
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press(',');
  await page.waitForFunction(() => document.querySelector('.tab.active')?.dataset.view === 'settings');

  // 退役模型 ID 已迁到 V4.1 Flash，DeepSeek 内置目录列出 V4.1 Flash 与 V4 Pro
  await page.waitForFunction(() => document.querySelector('#modelsActiveSelect')?.value === 'deepseek|deepseek-flash');
  const models = await page.evaluate(() => fetch('/api/models').then(response => response.json()));
  assert.equal(models.activeModel, 'deepseek-flash');
  const deepseek = models.providers.find(provider => provider.provider === 'deepseek');
  assert.deepEqual(deepseek.models.map(model => model.id), ['deepseek-flash', 'deepseek-v4-pro']);
  assert.equal(deepseek.models[0].name, 'DeepSeek V4.1 Flash');

  // 最近使用：再次打开时刚执行过的命令排在最前
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'visible' });
  assert.equal((await page.locator('#paletteList .palette-group').first().textContent()).trim(), '最近使用');
  assert.equal((await page.locator('#paletteList .palette-label').first().textContent()).trim(), '情报日报');
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'hidden' });

  assert.deepEqual(pageErrors, []);
});
