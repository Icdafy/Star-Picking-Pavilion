'use strict';
// AIHOT 1756ad7：播放、嵌入和分享页面不是图片，也不是新闻正文。
function isVideoPageUrl(input) {
  let url;
  try { url = new URL(input); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (/^(?:www\.|m\.)?youtube\.com$/.test(host)) {
    return (/^\/watch\/?$/.test(url.pathname) && Boolean(url.searchParams.get('v')))
      || /^\/(?:shorts|embed|v)\/[^/]+\/?$/.test(url.pathname);
  }
  if (host === 'youtu.be') return /^\/[^/]+\/?$/.test(url.pathname);
  if (/^(?:www\.)?vimeo\.com$/.test(host)) return /^\/\d+(?:\/[a-zA-Z0-9]+)?\/?$/.test(url.pathname);
  return host === 'player.vimeo.com' && /^\/video\/\d+\/?$/.test(url.pathname);
}
module.exports = { isVideoPageUrl };
