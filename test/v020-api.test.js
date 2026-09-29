'use strict';
// v0.2.0 情报接口的端到端契约：真实服务进程、真实鉴权。只读接口不触发模型调用；
// 写接口（关注标记、收录公司）走同一套令牌与 JSON 校验；非法入参一律 400，不存在 404。
const test = require('node:test');
const assert = require('node:assert/strict');

const { API_TOKEN_HEADER } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

test('intel read endpoints answer with the v0.2 shapes', async t => {
  const server = await startServer(t);
  const get = pathname => server.request({ pathname, headers: { [API_TOKEN_HEADER]: server.token } });
  const json = response => JSON.parse(response.body);

  const hot = await get('/api/hot');
  assert.equal(hot.status, 200);
  const hotBody = json(hot);
  assert.ok(Array.isArray(hotBody.entries));
  assert.equal(hotBody.windowHours, 48);
  assert.equal(hotBody.minParticipants, 2);
  assert.equal((await get('/api/hot?domain=mars')).status, 400);

  const companies = json(await get('/api/companies?domain=aerospace'));
  assert.ok(companies.some(c => c.id === 'landspace' && c.status === 'private'));
  assert.ok(companies.every(c => c.domain === 'aerospace'));
  assert.equal((await get('/api/companies?watch=everyone')).status, 400);

  const landspace = json(await get('/api/companies/landspace'));
  assert.equal(landspace.company.name, '蓝箭航天');
  assert.ok(Array.isArray(landspace.feed.items));
  assert.ok(Array.isArray(landspace.deals));
  assert.equal((await get('/api/companies/no-such-company')).status, 404);
  assert.equal((await get('/api/companies/..%2Fetc')).status, 400);

  const deals = json(await get('/api/deals?days=30'));
  assert.deepEqual(Object.keys(deals).sort(), ['days', 'deals', 'discovered', 'investors']);
  assert.equal((await get('/api/deals?days=99999')).status, 400);

  const weekly = json(await get('/api/reports?kind=weekly'));
  assert.match(weekly.report.key, /^\d{4}-W\d{2}$/);
  assert.ok(weekly.keys.includes(weekly.report.key));
  assert.equal((await get('/api/reports?kind=yearly')).status, 400);
  assert.equal((await get('/api/reports?kind=monthly&key=2026-13')).status, 400);

  const info = json(await get('/api/industry'));
  assert.equal(info.siteName, '摘星阁');
  assert.ok(info.itemTypes.length >= 7);
  assert.equal(info.budget.hourCalls, 0, '读取接口不产生任何模型调用');

  assert.equal((await get('/api/feed?view=all&company=landspace')).status, 200);
  assert.equal((await get('/api/feed?view=all&company=BAD!')).status, 400);
});

test('watch marks and custom companies require the API token and valid JSON', async t => {
  const server = await startServer(t);
  const auth = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };

  const anonymous = await server.request({
    method: 'POST', pathname: '/api/companies/landspace/watch',
    headers: { 'content-type': 'application/json' }, body: '{"watch":2}'
  });
  assert.equal(anonymous.status, 403);

  const marked = await server.request({
    method: 'POST', pathname: '/api/companies/landspace/watch', headers: auth, body: '{"watch":2,"note":"基金一期"}'
  });
  assert.equal(marked.status, 200);
  const body = JSON.parse(marked.body);
  assert.equal(body.watch, 2);
  assert.equal(body.watchNote, '基金一期');

  const invalid = await server.request({
    method: 'POST', pathname: '/api/companies/landspace/watch', headers: auth, body: '{"watch":7}'
  });
  assert.equal(invalid.status, 400);

  const created = await server.request({
    method: 'POST', pathname: '/api/companies', headers: auth,
    body: JSON.stringify({ name: '测试被投航天', aliases: ['测试航天'], domain: 'aerospace', watch: 2 })
  });
  assert.equal(created.status, 200);
  const company = JSON.parse(created.body).company;
  assert.match(company.id, /^u-[0-9a-f]{10}$/);
  assert.equal(company.custom, true);

  const duplicate = await server.request({
    method: 'POST', pathname: '/api/companies', headers: auth, body: JSON.stringify({ name: '测试被投航天' })
  });
  assert.equal(duplicate.status, 409);

  const badAliases = await server.request({
    method: 'PATCH', pathname: `/api/companies/${company.id}`, headers: auth, body: JSON.stringify({ aliases: 'not-a-list' })
  });
  assert.equal(badAliases.status, 400);

  const removed = await server.request({ method: 'DELETE', pathname: `/api/companies/${company.id}`, headers: { [API_TOKEN_HEADER]: server.token } });
  assert.equal(removed.status, 200);
  const builtin = await server.request({ method: 'DELETE', pathname: '/api/companies/landspace', headers: { [API_TOKEN_HEADER]: server.token } });
  assert.equal(builtin.status, 400);
});
