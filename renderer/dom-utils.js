'use strict';

(function exposeDomUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.DomUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDomUtils() {
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function safeHttpUrl(value) {
    if (typeof value !== 'string') return '#';
    try {
      const parsed = new URL(value);
      if (parsed.username || parsed.password) return '#';
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '#';
    } catch {
      return '#';
    }
  }

  function findFocusKey(root) {
    if (!root) return null;
    const documentNode = root.ownerDocument || (root.activeElement ? root : null);
    const activeElement = documentNode?.activeElement;
    if (!activeElement || (root.contains && !root.contains(activeElement))) return null;
    const keyedControl = activeElement.closest?.('[data-focus-key]');
    if (!keyedControl || (root.contains && !root.contains(keyedControl))) return null;
    return keyedControl.getAttribute('data-focus-key') || null;
  }

  function restoreFocusByKey(root, focusKey, fallback) {
    if (!root) return false;
    const match = focusKey
      ? [...root.querySelectorAll('[data-focus-key]')]
        .find(element => element.getAttribute('data-focus-key') === focusKey)
      : null;
    const target = match || fallback;
    if (!target || typeof target.focus !== 'function') return false;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    return true;
  }

  return Object.freeze({
    escapeHTML,
    safeHttpUrl,
    findFocusKey,
    restoreFocusByKey
  });
});
