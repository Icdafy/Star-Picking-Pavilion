'use strict';

(function exposeDomUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DomUtils = api;
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
    if (typeof value !== 'string') return '';
    const candidate = value.trim();
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : '';
    } catch {
      return '';
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

  function restoreFocusByKey(root, focusKey) {
    if (!root || !focusKey) return false;
    const match = [...root.querySelectorAll('[data-focus-key]')]
      .find(element => element.getAttribute('data-focus-key') === focusKey);
    if (!match || typeof match.focus !== 'function') return false;
    try {
      match.focus({ preventScroll: true });
    } catch {
      match.focus();
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
