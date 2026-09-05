'use strict';
const dns = require('node:dns');
const net = require('node:net');
const { Agent, fetch } = require('undici');
const { readBoundedBody } = require('./fetch-util');

function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b))
      || (a === 203 && b === 0));
  }
  // Globally routable IPv6 only; mapped/local/link-local/multicast are rejected.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
function publicUrl(value) {
  const u = new URL(value);
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password
    || (u.port && !['80', '443'].includes(u.port)) || h === 'localhost' || /\.(local|internal|localhost)$/i.test(h)
    || (net.isIP(h) && !isPublicAddress(h))) throw new Error('仅允许公开网页地址');
  return u;
}
const dispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return callback(new Error('拒绝内网采集地址'));
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
} } });

async function publicFetch(value, { maxBytes = 2 * 1024 * 1024, fetchImpl = fetch, allowRedirect } = {}) {
  let url = publicUrl(value);
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetchImpl(url.href, { dispatcher, signal, redirect: 'manual',
      headers: { 'User-Agent': 'StarPickingPavilion/0.1.4 (+https://github.com/Icdafy/Star-Picking-Pavilion)', Accept: '*/*' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = publicUrl(new URL(response.headers.get('location'), url).href);
      if (!response.headers.get('location')) throw new Error('公开网页跳转缺少目标地址');
      if (allowRedirect && !await allowRedirect(next)) throw new Error('正文跳转违反站点抓取规则');
      url = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`公开采集 HTTP ${response.status}`); }
    return { body: await readBoundedBody(response, maxBytes), type: response.headers.get('content-type') || '', url: url.href };
  }
  throw new Error('公开网页跳转过多');
}

const robotsCache = new Map();
function robotsAllowed(text, pathname) {
  // Conservative: honor every wildcard/our-agent Disallow, including Allow exceptions by longest match.
  let applies = false, hasRules = false, allowed = true, longest = -1;
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const [, field, value] = match;
    if (field.toLowerCase() === 'user-agent') {
      if (hasRules) { applies = false; hasRules = false; }
      applies ||= value === '*' || /starpickingpavilion/i.test(value);
      continue;
    }
    hasRules = true;
    if (!applies || !value || !/^(allow|disallow)$/i.test(field)) continue;
    const pattern = '^' + value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp(pattern).test(pathname) && value.length >= longest) {
      longest = value.length; allowed = field.toLowerCase() === 'allow';
    }
  }
  return allowed;
}
async function fetchPage(value, { fetchImpl = fetch, cache = robotsCache, withUrl = false } = {}) {
  async function allowed(url) {
    let cached = cache.get(url.origin);
    if (!cached || Date.now() - cached.at > 3600000) {
      try { cached = { at: Date.now(), text: (await publicFetch(`${url.origin}/robots.txt`, { maxBytes: 128000, fetchImpl })).body.toString('utf8') }; }
      catch (error) { if (!/HTTP 404\b/.test(error.message)) throw error; cached = { at: Date.now(), text: '' }; }
      if (cache.size > 200) cache.clear();
      cache.set(url.origin, cached);
    }
    return robotsAllowed(cached.text, url.pathname + url.search);
  }
  const url = publicUrl(value);
  if (!await allowed(url)) throw new Error('站点 robots.txt 禁止采集此路径');
  // Every destination gets its own robots check before any article request.
  const result = await publicFetch(url.href, { fetchImpl, allowRedirect: allowed });
  const html = result.body.toString('utf8');
  return withUrl ? { html, url: result.url } : html;
}
module.exports = { isPublicAddress, publicUrl, publicFetch, robotsAllowed, fetchPage };
