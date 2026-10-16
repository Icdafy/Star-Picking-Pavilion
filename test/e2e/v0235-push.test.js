'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

// 真实 Electron：设置页「新闻推送」从填写连接信息、手机端收到验证码、回填完成绑定，到设定节奏并开启，
// 全程走真实后端与 safeStorage 凭据通道；QQ 一侧用本机 OneBot v11 桩代替 NapCat。
test('v0235 news push binds a QQ robot by verification code and schedules pushes from settings', { timeout: 120000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0235-push-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2,
    view: 'settings', theme: 'dark', aquaEnabled: false, pointerEnabled: false }));
  const messages = [];
  const onebot = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer e2e-token') { res.writeHead(401).end(); return; }
      messages.push({ path: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: messages.length } }));
    });
  });
  await new Promise(resolve => onebot.listen(0, '127.0.0.1', resolve));
  let app;
  t.after(async () => {
    await app?.close();
    await new Promise(resolve => { onebot.close(resolve); onebot.closeAllConnections(); });
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  app = await launchNativeElectron(root, profile);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('load');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-view="settings"]').click();
  await page.locator('#settingsNav [data-settings-target="settingsPush"]').click();
  await page.waitForSelector('#pushChannels [data-push-channel="qq"]');
  assert.deepEqual(await page.locator('#pushChannels [data-push-channel]').evaluateAll(cards => cards.map(card => card.dataset.pushChannel)),
    ['feishu', 'dingtalk', 'qq']);
  assert.equal(await page.locator('#pushEnabled').isDisabled(), true, '未绑定前不能开启定时推送');
  assert.equal(await page.locator('#pushBoundBadge').textContent(), '尚未绑定');
  assert.equal(await page.locator('#pushNextRun').textContent(), '先绑定一个机器人');
  assert.equal(await page.locator('#settingsPush input[type="number"], #settingsPush input[type="time"], #pushSchedule input, #pushContent input').count(), 0,
    '推送时间与内容全部是选项，没有需要手填的输入框');

  // 飞书：错误的地址在本机就被拦下，不会发出任何请求
  await page.locator('[data-push-channel="feishu"] [data-push-act="bind"]').click();
  await page.locator('#pushBind-webhook').fill('https://example.com/not-feishu');
  await page.locator('[data-bind-act="send"]').click();
  await page.waitForFunction(() => /open\.feishu\.cn/.test(document.querySelector('#pushBindPanel .maintenance-action-status')?.textContent || ''));
  await page.locator('[data-bind-act="cancel"]').click();
  assert.equal(await page.locator('#pushBindPanel').isHidden(), true);

  // QQ：发送验证码 → 从“手机”（OneBot 桩）读取 → 回填完成绑定
  await page.locator('[data-push-channel="qq"] [data-push-act="bind"]').click();
  assert.equal(await page.locator('#pushBind-baseUrl').inputValue(), 'http://127.0.0.1:3000');
  await page.locator('#pushBind-baseUrl').fill(`http://127.0.0.1:${onebot.address().port}`);
  await page.locator('#pushBind-accessToken').fill('e2e-token');
  await page.locator('#pushBind-targetId').fill('20261016');
  assert.equal(await page.locator('#pushBind-accessToken').getAttribute('type'), 'password');
  await page.locator('[data-bind-act="send"]').click();
  await page.waitForSelector('#pushBindCode');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].path, '/send_private_msg');
  const code = /验证码：(\d{6})/.exec(messages[0].body.message[0].data.text)[1];
  await page.locator('#pushBindCode').fill(code === '123456' ? '654321' : '123456');
  await page.locator('[data-bind-act="verify"]').click();
  await page.waitForFunction(() => /验证码不正确/.test(document.querySelector('#pushBindPanel .maintenance-action-status')?.textContent || ''));
  await page.locator('#pushBindCode').fill(code);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-push-channel="qq"] [data-push-act="test"]');
  assert.equal(await page.locator('#pushBindPanel').isHidden(), true);
  assert.match(await page.locator('[data-push-channel="qq"]').textContent(), /推送中[\s\S]*私聊 20•+16/);
  assert.equal(await page.locator('#pushBoundBadge').textContent(), '已绑定 QQ');
  assert.equal(await page.locator('#pushEnabled').isDisabled(), false, '绑定后可以开启定时推送');
  for (let waited = 0; messages.length < 2 && waited < 50; waited++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(messages[1].body.message[0].data.text, /绑定成功/, '手机端收到绑定成功回执');

  // 推送时间：开关先于时间设置也能开启；之后改时间，状态区立即跟着变，不需要另点保存
  assert.equal(await page.locator('#pushNextRun').textContent(), '定时推送已关闭');
  await page.locator('#pushHero .push-toggle').click();
  await page.waitForFunction(() => /定时推送已开启/.test(document.getElementById('pushStatus').textContent));
  assert.match(await page.locator('#pushNextRun').textContent(), /^下一次 (今天|明天) \d\d:\d\d$/);

  // 每天固定时刻：套用常用组合 → 用下拉添加“现在这一分钟” → 状态区立刻显示“今天 HH:MM · 即将推送”
  await page.locator('[data-push-set="mode"][data-value="times"]').click();
  await page.locator('[data-push-preset="08:30,18:30"]').click();
  await page.waitForFunction(() => /已自动保存/.test(document.getElementById('pushStatus').textContent));
  const nowClock = await page.evaluate(() => {
    const at = new Date(Date.now() + 5000);
    return { hour: at.getHours(), minute: at.getMinutes() };
  });
  const pickMinute = Math.floor(nowClock.minute / 5) * 5;
  await page.locator('[data-push-pick="hour"]').selectOption(String(nowClock.hour));
  await page.locator('[data-push-pick="minute"]').selectOption(String(pickMinute));
  await page.locator('[data-push-add]').click();
  const added = String(nowClock.hour).padStart(2, '0') + ':' + String(pickMinute).padStart(2, '0');
  await page.waitForFunction(() => /已自动保存/.test(document.getElementById('pushStatus').textContent));
  assert.ok(await page.locator(`[data-push-remove="${added}"]`).count(), '新加的时刻出现在已选列表里');
  if (pickMinute === nowClock.minute) {
    assert.equal(await page.locator('#pushNextRun').textContent(), `下一次 今天 ${added}`, '刚选中的本分钟时刻就是下一次推送');
    assert.equal(await page.locator('#pushTimeline .is-next').textContent(), added);
  }

  // 工作日 + 每次 5 条：全部点选
  await page.locator('[data-push-days="1,2,3,4,5"]').click();
  await page.locator('[data-push-set="maxItems"][data-value="5"]').click();
  await page.waitForFunction(() => /已自动保存 · 工作日 /.test(document.getElementById('pushStatus').textContent));
  assert.equal(await page.locator('[data-push-day="6"]').getAttribute('aria-pressed'), 'false');

  // 按间隔：推送时段 + 间隔芯片；状态区与时刻表同步
  await page.locator('[data-push-set="mode"][data-value="interval"]').click();
  await page.locator('[data-push-set="intervalMinutes"][data-value="180"]').click();
  await page.locator('[data-push-allday]').click();
  await page.waitForFunction(() => /已自动保存 · 工作日 全天 每 3 小时/.test(document.getElementById('pushStatus').textContent));
  assert.match(await page.locator('#pushHeroDetail').textContent(), /工作日 全天 每 3 小时 · 推送到QQ/);
  await page.locator('[data-push-window="windowStart"]').selectOption('09:00');
  await page.waitForFunction(() => /已自动保存 · 工作日 09:00—24:00 每 3 小时/.test(document.getElementById('pushStatus').textContent));
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).push;
  assert.equal(saved.mode, 'interval');
  assert.equal(saved.intervalMinutes, 180);
  assert.deepEqual([saved.windowStart, saved.windowEnd], ['09:00', '24:00']);
  assert.equal(saved.maxItems, 5);
  assert.deepEqual(saved.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(saved.quietEnabled, undefined, '不再保存免打扰字段');

  // 键盘：单选组方向键切换并自动保存
  await page.locator('[data-push-set="scope"][data-value="featured"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.activeElement?.dataset.value === 'relevant' && /已自动保存/.test(document.getElementById('pushStatus').textContent));

  // 测试推送与立即推送（空库：不打扰）
  await page.locator('[data-push-channel="qq"] [data-push-act="test"]').click();
  await page.waitForFunction(() => /测试消息已发出/.test(document.querySelector('[data-push-channel="qq"] .maintenance-action-status').textContent));
  assert.match(messages.at(-1).body.message[0].data.text, /测试推送/);
  await page.locator('#btnPushNow').click();
  await page.waitForFunction(() => /QQ没有新情报/.test(document.getElementById('pushStatus').textContent));
  await page.locator('#settingsPush .push-log summary').click();
  assert.match(await page.locator('#pushHistory').textContent(), /QQ · 手动 · 没有新情报，未打扰/);

  // 重新进入设置页时表单从后端恢复，凭据从未回到页面
  await page.locator('[data-view="all"]').click();
  await page.locator('[data-view="settings"]').click();
  await page.waitForFunction(() => document.getElementById('pushEnabled').checked);
  const html = await page.content();
  assert.doesNotMatch(html, /e2e-token|20261016/, 'Token 与完整 QQ 号不得出现在页面里');
  const settingsFile = fs.readFileSync(path.join(profile, 'settings.json'), 'utf8');
  assert.doesNotMatch(settingsFile, /e2e-token|20261016/);
  assert.equal(JSON.parse(settingsFile).push.enabled, true);
  assert.equal(await page.locator('[data-push-set="intervalMinutes"][data-value="180"]').getAttribute('aria-checked'), 'true', '重新进入后选项从后端恢复');

  const shots = path.join(root, 'work/v0235/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  for (const width of [1440, 800]) for (const theme of ['dark', 'light']) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 1000), width);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    await page.locator('#settingsNav [data-settings-target="settingsPush"]').click();
    await page.waitForFunction(() => document.querySelector('#settingsNav [aria-current]')?.dataset.settingsTarget === 'settingsPush');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${theme}: 无横向滚动`);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('#settingsPush *')]
      .filter(node => node.getBoundingClientRect().right > document.getElementById('settingsPush').getBoundingClientRect().right + 1)
      .map(node => node.id || node.className).slice(0, 5));
    assert.deepEqual(overflow, [], `${width}/${theme}: 推送卡片内没有越界元素`);
    await page.locator('#settingsPush').screenshot({ path: path.join(shots, `push-${width}-${theme}.png`) });
  }

  // 解绑：确认后连接信息删除，开关随之不可用
  await page.locator('[data-push-channel="qq"] [data-push-act="unbind"]').click();
  await page.locator('#confirmDialogOk').click();
  await page.waitForSelector('[data-push-channel="qq"] [data-push-act="bind"]');
  assert.equal(await page.locator('#pushBoundBadge').textContent(), '尚未绑定');
  assert.deepEqual(errors, []);
});
