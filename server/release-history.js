'use strict';

// Public release notes only. No account, API key or application data is sent.
const fs = require('node:fs');
const path = require('node:path');
const { fetch: undiciFetch } = require('undici');
const { readBoundedBody, cancelBody } = require('./collectors/fetch-util');

const REPOSITORY = 'Icdafy/Star-Picking-Pavilion';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;

function normalizeRelease(input) {
  if (!input || input.draft || input.prerelease) return null;
  const tag = input.tag_name ?? input.tag;
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(tag)) return null;
  const body = input.body;
  if (typeof body !== 'string' || body.length > 128_000) return null;
  const date = input.published_at ?? input.publishedAt;
  return {
    tag,
    name: String(input.name || `摘星阁 ${tag}`).slice(0, 200),
    publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
    body,
    url: `${RELEASES_URL}/tag/${tag}`
  };
}

function compareVersions(left, right) {
  const a = left.tag.slice(1).split('.').map(Number);
  const b = right.tag.slice(1).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (b[i] || 0) - (a[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

function mergeReleases(...histories) {
  const releases = new Map();
  for (const history of histories) {
    if (!Array.isArray(history)) continue;
    for (const item of history.slice(0, 1000)) {
      const release = normalizeRelease(item);
      if (release) releases.set(release.tag, release);
    }
  }
  return [...releases.values()].sort(compareVersions);
}

async function fetchReleases({ fetchImpl = undiciFetch, signal } = {}) {
  const items = [];
  // Follow numbered pages, never an untrusted Link URL or a caller supplied URL.
  for (let page = 1; page <= 10; page++) {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`, {
      headers: { 'User-Agent': 'Star-Picking-Pavilion', Accept: 'application/vnd.github+json' },
      redirect: 'error', signal
    });
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`GitHub HTTP ${response.status}`);
    }
    const data = JSON.parse((await readBoundedBody(response, MAX_CACHE_BYTES)).toString('utf8'));
    if (!Array.isArray(data)) throw new Error('GitHub 更新日志格式无效');
    items.push(...data);
    if (data.length < 100) return mergeReleases(items);
  }
  throw new Error('GitHub 更新日志分页超出上限');
}

function createReleaseHistoryService({ bundled, version, dataDir, fetchImpl, clock = Date.now } = {}) {
  const cachePath = dataDir ? path.join(dataDir, 'release-history.cache.json') : null;
  let items = mergeReleases(bundled), lastSyncedAt = null, syncError = null;
  let nextSync = 0, pending = null, abort = null, disposed = false;
  try {
    if (cachePath && fs.statSync(cachePath).size <= MAX_CACHE_BYTES) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      items = mergeReleases(bundled, cached.items);
      lastSyncedAt = Number.isFinite(Date.parse(cached.lastSyncedAt)) ? cached.lastSyncedAt : null;
    }
  } catch { /* The complete packaged history is the offline fallback. */ }

  function snapshot() {
    return { items, currentVersion: version, lastSyncedAt, syncError };
  }

  function sync() {
    if (disposed || clock() < nextSync) return Promise.resolve(snapshot());
    if (pending) return pending;
    abort = new AbortController();
    const timer = setTimeout(() => abort?.abort(), 8000);
    pending = (async () => {
      try {
        const remote = await fetchReleases({ fetchImpl, signal: abort.signal });
        if (disposed) return snapshot();
        items = mergeReleases(items, remote);
        lastSyncedAt = new Date(clock()).toISOString();
        syncError = null;
        nextSync = clock() + 5 * 60_000;
        if (cachePath) {
          const content = JSON.stringify({ items, lastSyncedAt });
          if (Buffer.byteLength(content) <= MAX_CACHE_BYTES) {
            try {
              await fs.promises.writeFile(`${cachePath}.tmp`, content, 'utf8');
              await fs.promises.rename(`${cachePath}.tmp`, cachePath);
            } catch { /* Readable in-memory notes do not depend on disk writes. */ }
          }
        }
      } catch {
        syncError = '暂时无法同步，已显示本机保存的更新日志。';
        nextSync = clock() + 60_000;
      } finally {
        clearTimeout(timer); abort = null; pending = null;
      }
      return snapshot();
    })();
    return pending;
  }

  return Object.freeze({ snapshot, sync, dispose() { disposed = true; abort?.abort(); } });
}

module.exports = { REPOSITORY, RELEASES_URL, normalizeRelease, compareVersions, mergeReleases, fetchReleases, createReleaseHistoryService };
