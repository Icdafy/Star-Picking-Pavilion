'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fetchReleases, mergeReleases, RELEASES_URL } = require('../server/release-history');
const root = path.join(__dirname, '..');
const historyPath = path.join(root, 'config/release-history.json');

function currentRelease() {
  const version = require('../package.json').version;
  const body = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  if (!body.startsWith(`# 摘星阁 v${version}\n`)) throw new Error('RELEASE_NOTES.md 的版本与 package.json 不一致');
  return { tag: `v${version}`, name: `摘星阁 v${version}`, publishedAt: null, body };
}

function verifyBundledHistory() {
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const current = currentRelease();
  if (history.source !== RELEASES_URL || !Array.isArray(history.items)) throw new Error('内置更新日志来源无效');
  if (history.items[0]?.tag !== current.tag || history.items[0]?.body !== current.body) {
    throw new Error('内置更新日志尚未同步本次发布说明；请先运行 npm run releases:sync');
  }
  const normalized = mergeReleases(history.items);
  if (normalized.length !== history.items.length || JSON.stringify(normalized) !== JSON.stringify(history.items)) {
    throw new Error('内置更新日志包含无效、重复或未排序的版本');
  }
  return history.items.length;
}

async function syncHistory({ from } = {}) {
  const previous = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')).items : [];
  const remote = from ? JSON.parse(fs.readFileSync(from, 'utf8').replace(/^\uFEFF/, ''))
    : await fetchReleases({ signal: AbortSignal.timeout(20_000) });
  const items = mergeReleases(previous, remote, [currentRelease()]);
  fs.writeFileSync(historyPath, JSON.stringify({ source: RELEASES_URL, items }, null, 2) + '\n', 'utf8');
  return verifyBundledHistory();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  Promise.resolve().then(() => args.includes('--check') ? verifyBundledHistory()
    : syncHistory({ from: args.includes('--from') ? args[args.indexOf('--from') + 1] : null }))
    .then(count => console.log(`Verified ${count} bundled release notes including v${require('../package.json').version}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { currentRelease, verifyBundledHistory, syncHistory };
