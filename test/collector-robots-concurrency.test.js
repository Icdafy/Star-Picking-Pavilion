'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPage } = require('../server/collectors/public-web');

test('并发正文共享 robots 请求，每条正文仍独立检查路径规则', async () => {
  const cache = new Map();
  let robots = 0, articles = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/robots.txt')) {
      robots++;
      await new Promise(resolve => setImmediate(resolve));
      return new Response('User-agent: *\nDisallow: /private');
    }
    articles++;
    return new Response('<article>正文</article>');
  };
  const pages = await Promise.allSettled(['/a', '/b', '/private'].map(p => fetchPage(`https://robot.example${p}`, { cache, fetchImpl })));
  assert.equal(robots, 1);
  assert.equal(articles, 2);
  assert.equal(pages[0].status, 'fulfilled');
  assert.equal(pages[1].status, 'fulfilled');
  assert.equal(pages[2].status, 'rejected');
  assert.match(pages[2].reason.message, /robots/);
});

test('robots 不可达合并并暂缓重试且保持禁止正文，过期后可恢复', async () => {
  const cache = new Map();
  let requests = 0, available = false;
  const fetchImpl = async url => {
    requests++;
    await new Promise(resolve => setImmediate(resolve));
    if (url.endsWith('/robots.txt')) return new Response(available ? '' : 'unavailable', { status: available ? 200 : 503 });
    assert.ok(available, 'robots 失败时不得请求正文');
    return new Response('<article>恢复</article>');
  };
  const first = await Promise.allSettled(['/a', '/b'].map(p => fetchPage(`https://retry.example${p}`, { cache, fetchImpl })));
  assert.ok(first.every(result => result.status === 'rejected'));
  await assert.rejects(fetchPage('https://retry.example/c', { cache, fetchImpl }), /HTTP 503/);
  assert.equal(requests, 1);
  available = true;
  cache.get('https://retry.example').at -= 30001;
  assert.match(await fetchPage('https://retry.example/c', { cache, fetchImpl }), /恢复/);
  assert.equal(requests, 3);
});
