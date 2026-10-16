'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { API_TOKEN_HEADER } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

// 本机 OneBot v11 桩：记录收到的消息，校验 Bearer 鉴权，行为与 NapCat HTTP 服务端一致
async function startOneBot(t, token) {
  const messages = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end();
        return;
      }
      messages.push({ path: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: messages.length } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, messages };
}

test('新闻推送 API：经 OneBot 发验证码完成 QQ 绑定，连接信息不出现在任何响应或设置文件里', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'Content-Type': 'application/json' };
  const call = async (method, pathname, body) => {
    const response = await server.request({ method, pathname, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, raw: response.body, json: JSON.parse(response.body) };
  };
  const bot = await startOneBot(t, 'onebot-secret-token');

  const initial = await call('GET', '/api/push');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.json.channels.map(channel => [channel.id, channel.bound]), [['feishu', false], ['dingtalk', false], ['qq', false]]);
  assert.equal(initial.json.settings.enabled, false, '推送默认关闭');

  const rejected = await call('POST', '/api/push/channels/feishu/bind', { webhook: 'https://evil.example/hook' });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.error, /open\.feishu\.cn/);

  const wrongToken = await call('POST', '/api/push/channels/qq/bind', { baseUrl: bot.baseUrl, targetId: '123456789', accessToken: 'nope' });
  assert.equal(wrongToken.json.ok, false);
  assert.match(wrongToken.json.error, /Access Token/);

  const bind = await call('POST', '/api/push/channels/qq/bind', { baseUrl: bot.baseUrl, targetId: '123456789', accessToken: 'onebot-secret-token' });
  assert.equal(bind.json.ok, true, bind.raw);
  assert.equal(bot.messages.length, 1);
  assert.equal(bot.messages[0].path, '/send_private_msg');
  assert.equal(bot.messages[0].body.user_id, 123456789);
  const code = /验证码：(\d{6})/.exec(bot.messages[0].body.message[0].data.text)?.[1];
  assert.ok(code, '验证码随消息送达');

  const wrong = await call('POST', '/api/push/channels/qq/verify', { code: code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 400);
  const verified = await call('POST', '/api/push/channels/qq/verify', { code });
  assert.equal(verified.status, 200, verified.raw);
  const qq = verified.json.view.channels.find(channel => channel.id === 'qq');
  assert.equal(qq.bound, true);
  assert.match(qq.target, /私聊 12•+89/);

  const saved = await call('POST', '/api/push/settings', { enabled: true, mode: 'times', times: '08:30, 18:30', maxItems: 5 });
  assert.equal(saved.status, 200, saved.raw);
  assert.equal(saved.json.settings.enabled, true);
  assert.deepEqual(saved.json.settings.times, ['08:30', '18:30']);
  assert.ok(saved.json.nextRunAt);
  assert.equal((await call('POST', '/api/push/settings', { times: '99:99' })).status, 400);

  // 空库：没有新情报时不打扰
  const run = await call('POST', '/api/push/run', {});
  assert.deepEqual(run.json.results.map(result => [result.channel, result.ok, result.skipped]), [['qq', true, true]]);

  const test = await call('POST', '/api/push/channels/qq/test', {});
  assert.equal(test.json.ok, true, test.raw);
  assert.match(bot.messages.at(-1).body.message[0].data.text, /测试推送/);

  const everything = [
    (await call('GET', '/api/push')).raw,
    (await call('GET', '/api/settings')).raw,
    (await call('GET', '/api/models')).raw,
    fs.readFileSync(path.join(server.dataDir, 'settings.json'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(everything, /onebot-secret-token|123456789/, 'Token 与完整 QQ 号不得出现在响应或明文设置里');

  const reservedProvider = await call('POST', '/api/models/providers', { provider: 'push-qq', baseUrl: 'https://api.example.com/v1', api: 'openai-completions', models: [{ id: 'm' }] });
  assert.equal(reservedProvider.status, 400);
  assert.match(reservedProvider.json.error, /保留/);

  const disabled = await call('POST', '/api/push/channels/qq/enabled', { enabled: false });
  assert.equal(disabled.json.channels.find(channel => channel.id === 'qq').enabled, false);
  const removed = await call('DELETE', '/api/push/channels/qq');
  assert.equal(removed.json.channels.find(channel => channel.id === 'qq').bound, false);
  assert.equal((await call('POST', '/api/push/channels/qq/test', {})).status, 400);
});
