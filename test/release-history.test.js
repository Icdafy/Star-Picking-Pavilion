'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeRelease, mergeReleases, fetchReleases, createReleaseHistoryService } = require('../server/release-history');
const { verifyBundledHistory } = require('../scripts/sync-release-history');
const { ReleaseLog } = require('../renderer/intel-views');
const { escapeHTML } = require('../renderer/dom-utils');
const release = (tag, body = '版本说明') => ({ tag_name: tag, body, name: `摘星阁 ${tag}`, published_at: '2026-10-06T05:00:00Z' });

test('release history imports every published GitHub version and the exact current notes', () => {
  assert.ok(verifyBundledHistory() >= 40);
  const history = require('../config/release-history.json');
  const tags = new Set(history.items.map(item => item.tag));
  assert.ok(tags.has('v0.0.2'));
  assert.ok(tags.has('v0.1.0.1'));
  assert.ok(tags.has('v0.1.0.2'));
  assert.ok(tags.has('v0.2.11'));
  assert.equal(tags.has('v0.0.6'), false, 'Do not invent an unpublished historical Release');
});

test('release normalization rejects drafts, prereleases and invalid tags; sorts numeric versions and deduplicates', () => {
  assert.equal(normalizeRelease({ ...release('v0.2.13'), draft: true }), null);
  assert.equal(normalizeRelease({ ...release('v0.2.13'), prerelease: true }), null);
  assert.equal(normalizeRelease(release('v0.2.13<script>')), null);
  const items = mergeReleases([release('v0.2.9'), release('v0.1.0.1'), release('v0.2.10')], [release('v0.2.9', '修订说明')]);
  assert.deepEqual(items.map(item => item.tag), ['v0.2.10', 'v0.2.9', 'v0.1.0.1']);
  assert.equal(items[1].body, '修订说明');
  assert.match(items[0].url, /^https:\/\/github.com\/Icdafy\/Star-Picking-Pavilion\/releases\/tag\/v0\.2\.10$/);
});

test('GitHub release synchronization follows all pages and only sends a public request', async () => {
  const calls = [];
  const items = await fetchReleases({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const page = new URL(url).searchParams.get('page');
    return new Response(JSON.stringify(page === '1' ? Array.from({ length: 100 }, (_, i) => release(`v0.0.${i + 1}`)) : [release('v0.2.12')]));
  } });
  assert.equal(items.length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /page=2$/);
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Accept', 'User-Agent']);
});

test('concurrent release sync coalesces, caches remote changes and retains the complete offline history after restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-release-history-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let count = 0, resolve;
  const service = createReleaseHistoryService({ bundled: [release('v0.2.12')], version: '0.2.12', dataDir: directory,
    fetchImpl: () => { count++; return new Promise(done => { resolve = done; }); } });
  assert.equal(service.snapshot().items.length, 1);
  const first = service.sync(), second = service.sync();
  assert.equal(first, second);
  assert.equal(count, 1);
  resolve(new Response(JSON.stringify([release('v0.2.13'), release('v0.2.12', '修订后的正式说明')])));
  await first;
  assert.equal(service.snapshot().items[0].tag, 'v0.2.13');
  await service.sync();
  assert.equal(count, 1, 'Successful requests are throttled');
  const reopened = createReleaseHistoryService({ bundled: [release('v0.2.12')], version: '0.2.12', dataDir: directory,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(reopened.snapshot().items[1].body, '修订后的正式说明');
  await reopened.sync();
  assert.equal(reopened.snapshot().items.length, 2);
  assert.match(reopened.snapshot().syncError, /本机保存/);
});

test('failed release sync preserves notes, respects retry cooldown and cancellation aborts the outstanding fetch', async () => {
  let clock = 1000, calls = 0;
  const service = createReleaseHistoryService({ bundled: [release('v0.2.12')], version: '0.2.12', clock: () => clock,
    fetchImpl: async () => { calls++; return new Response('{}', { status: 403 }); } });
  await service.sync(); await service.sync();
  assert.equal(calls, 1);
  assert.equal(service.snapshot().items.length, 1);
  clock += 60_001;
  await service.sync();
  assert.equal(calls, 2);
  let signal;
  const waiting = createReleaseHistoryService({ bundled: [], fetchImpl: async (_, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  const sync = waiting.sync();
  waiting.dispose();
  assert.equal(signal.aborted, true);
  await sync;
});

test('release Markdown renders headings, lists, links and code without executing remote HTML', () => {
  const content = '# 历史版本\n\n<script>alert(1)</script>\n\n- **更新** `model`\n- [原文](https://github.com/Icdafy/Star-Picking-Pavilion/releases)\n\n```powershell\n<unsafe>\n```\n\n[攻击](javascript:alert(1))';
  const html = ReleaseLog.renderMarkdown(content, { esc: escapeHTML, safeUrl: value => value });
  assert.match(html, /<h4>历史版本<\/h4>/);
  assert.match(html, /<strong>更新<\/strong> <code>model<\/code>/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /<pre><code>&lt;unsafe&gt;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});
