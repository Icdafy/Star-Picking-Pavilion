'use strict';
// v0.2.3 真实 Electron：设置 → 模型。声明自定义模型 API → 用表单当前的端点与密钥获取可用模型 →
// 勾选采纳 → 创建 → 选为分析模型 → 测试连接 → 删除后回落 DeepSeek；主题切换走圆形揭开，对话框可开可关。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..', '..');
const GATEWAY_KEY = 'sk-v023-gateway-dummy';

function mockGateway(t) {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization || null, body });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [
          { id: 'gw-vision-large', context_length: 262144, architecture: { input_modalities: ['text', 'image'] } },
          { id: 'gw-text-small' },
          { id: 'gw-embedding' }
        ] }));
        return;
      }
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    t.after(() => new Promise(done => { server.close(done); server.closeAllConnections?.(); }));
    resolve({ base: `http://127.0.0.1:${server.address().port}/v1`, calls });
  }));
}

test('models settings: declare a custom API, fetch and adopt models, select, test and remove', { timeout: 120_000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v023-ui-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/empty-settings.json'), path.join(dir, 'settings.json'));
  const gateway = await mockGateway(t);
  const app = await electron.launch({ args: ['.', '--hidden'], cwd: root, env: { ...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR: dir, STAR_PICKING_PAVILION_NO_SCHEDULER: '1', STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1' } });
  t.after(async () => { await app.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForLoadState('load');
  await page.waitForSelector('.nav');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1280, 860); w.showInactive(); });

  await page.locator('.tab[data-view="settings"]').click();
  const section = page.locator('#modelsSection');
  await section.locator('.model-row[data-provider="deepseek"]').waitFor();
  assert.equal(await section.locator('.model-row').count(), 1);
  assert.equal(await section.locator('.model-row[data-provider="deepseek"] [data-models-act="remove"]').count(), 0, 'DeepSeek 不可删除');

  // 添加 → 自定义模型 API
  await section.locator('[data-models-act="open-add"]').click();
  await section.locator('.models-add-card').waitFor();
  assert.equal(await section.locator('[data-mode="catalog"][role="tab"]').getAttribute('aria-selected'), 'true');
  await section.locator('[data-models-act="add-mode"][data-mode="custom"]').click();
  const custom = section.locator('#modelsAddPanelCustom');
  await custom.waitFor();
  const create = custom.locator('[data-models-act="submit"]');
  assert.equal(await create.isDisabled(), true, '四项未齐时创建按钮不可用');

  await custom.locator('input[data-models-field="provider"]').fill('my-gateway');
  await custom.locator('input[data-models-field="displayName"]').fill('我的网关');
  await custom.locator('input[data-models-field="baseUrl"]').fill(gateway.base);
  await custom.locator('input[data-models-field="apiKey"]').fill(GATEWAY_KEY);

  // 获取：询问的是表单里尚未保存的端点与密钥
  await custom.locator('[data-models-act="fetch-models"]').click();
  const picker = page.locator('#modelPickerDialog');
  await picker.waitFor({ state: 'visible' });
  assert.equal(gateway.calls.at(-1).url, '/v1/models');
  assert.equal(gateway.calls.at(-1).authorization, `Bearer ${GATEWAY_KEY}`);
  assert.equal(await picker.locator('input[data-picker-id]').count(), 3);
  await picker.locator('[data-picker-search]').fill('embedding');
  assert.equal(await picker.locator('input[data-picker-id]').count(), 1);
  await picker.locator('input[data-picker-id="gw-embedding"]').uncheck();
  await picker.locator('[data-picker-search]').fill('');
  assert.match(await picker.locator('[data-picker-count]').textContent(), /已选 2 \/ 3/);
  await picker.locator('[data-picker-act="adopt"]').click();
  await picker.waitFor({ state: 'hidden' });

  const ids = await custom.locator('input[data-models-field="id"]').evaluateAll(inputs => inputs.map(input => input.value));
  assert.deepEqual(ids.sort(), ['gw-text-small', 'gw-vision-large']);
  assert.equal(await create.isDisabled(), false);
  await create.click();

  const row = section.locator('.model-row[data-provider="my-gateway"]');
  await row.waitFor();
  assert.match(await row.locator('.model-row-name').textContent(), /我的网关/);
  assert.equal(await row.locator('.model-row-tag', { hasText: '自定义' }).count(), 1);
  assert.equal(await row.locator('.model-dot.is-ok').count(), 1);
  assert.equal(await section.locator('.models-add-card').count(), 0);

  // 选为分析模型；模型 ID 可以含任意字符，选择框按第一个 | 切开
  await section.locator('#modelsActiveSelect').selectOption('my-gateway|gw-vision-large');
  await page.waitForFunction(() => document.querySelector('.model-row[data-provider="my-gateway"] .model-row-tag.is-active'));
  assert.match(await section.locator('.models-active-copy small').textContent(), /gw-vision-large · 支持图片理解/);

  await section.locator('#btnTestModel').click();
  await page.waitForFunction(() => document.querySelector('#modelTestResult')?.classList.contains('ok'));
  const chat = gateway.calls.at(-1);
  assert.equal(chat.url, '/v1/chat/completions');
  assert.equal(chat.authorization, `Bearer ${GATEWAY_KEY}`);
  assert.equal(JSON.parse(chat.body).model, 'gw-vision-large');
  assert.equal('thinking' in JSON.parse(chat.body), false, 'DeepSeek 扩展参数不发给其它提供商');

  // 编辑：改一个显示名称；密钥框从不回填
  await row.locator('[data-models-act="edit"]').click();
  assert.equal(await row.locator('input[data-models-field="apiKey"]').inputValue(), '');
  assert.match(await row.locator('input[data-models-field="apiKey"]').getAttribute('placeholder'), /已配置/);
  await row.locator('details.models-customized > summary').click();
  const nameInput = row.locator('input[data-models-field="name"]').first();
  await nameInput.fill('网关视觉大模型');
  await row.locator('[data-models-act="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.models-saved')?.textContent.includes('已保存'));
  const models = await page.evaluate(() => fetch('/api/models').then(response => response.json()));
  const saved = models.providers.find(provider => provider.provider === 'my-gateway');
  assert.ok(saved.models.some(model => model.name === '网关视觉大模型'));
  assert.equal(JSON.stringify(models).includes(GATEWAY_KEY), false);

  // 删除当前分析模型所属的提供商 → 确认弹窗（可开可关）→ 回落 DeepSeek
  await row.locator('[data-models-act="remove"]').click();
  const confirm = page.locator('#confirmDialog');
  await confirm.waitFor({ state: 'visible' });
  assert.match(await page.locator('#confirmDialogMessage').textContent(), /移除其配置和存储的 API 密钥/);
  await page.locator('#confirmDialogOk').click();
  await row.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#modelsActiveSelect')?.value === 'deepseek|deepseek-v4-flash-vision-exp');
  await confirm.waitFor({ state: 'hidden' });

  // 主题切换：圆形揭开结束后 data-theme 落定，揭开用的临时类被移除
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('#btnTheme').click();
  await page.waitForFunction(previous => document.documentElement.dataset.theme !== previous
    && !document.documentElement.classList.contains('theme-reveal'), before);

  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(Object.hasOwn(settings.ai.providers, 'my-gateway'), false);
  assert.equal(settings.ai.activeProvider, 'deepseek');
  assert.equal(JSON.stringify(settings).includes(GATEWAY_KEY), false);
  assert.deepEqual(pageErrors, []);
});
