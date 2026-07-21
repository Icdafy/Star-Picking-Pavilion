'use strict';

const path = require('node:path');

function resolveStaticFile(rootDirectory, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(String(pathname || '/')); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const root = path.resolve(rootDirectory);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

module.exports = { resolveStaticFile };
