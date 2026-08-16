'use strict';

/* 摘星阁 · 自动更新提示（仅桌面壳内生效）
   阶段 3 批 2 自 app.js 抽离：订阅桌面桥的更新状态并逐态改写提示胶囊。
   desktop 桥与胶囊元素一律走依赖注入，工厂体内不出现 window/document 直读。 */

(function exposeUpdatePill(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.UpdatePill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUpdatePillModule() {
  function createUpdatePill({ desktop, pill } = {}) {
    // 浏览器环境没有桌面桥：直接返回 null，组合根不必再包一层判断
    if (!desktop || typeof desktop.onUpdateStatus !== 'function' || !pill) return null;
    let updState = 'idle';
    desktop.onUpdateStatus(({ status, version, percent, message }) => {
      updState = status;
      pill.classList.toggle('error', status === 'error');
      pill.disabled = status === 'installing';
      if (status === 'available') { pill.hidden = false; pill.classList.remove('ready'); pill.textContent = `发现新版本 ${version}…`; }
      else if (status === 'downloading') { pill.hidden = false; pill.classList.remove('ready'); pill.textContent = `下载更新 ${percent}%`; }
      else if (status === 'downloaded') { pill.hidden = false; pill.classList.add('ready'); pill.textContent = `▲ 重启安装 ${version}`; }
      else if (status === 'installing') {
        pill.hidden = false;
        pill.classList.remove('ready');
        pill.textContent = `正在重启安装 ${version}…`;
      }
      else if (status === 'error') {
        pill.hidden = false;
        pill.classList.remove('ready');
        pill.textContent = '更新检查失败';
        pill.title = message || '稍后将自动重试';
      }
    });
    pill.addEventListener('click', () => {
      if (updState !== 'downloaded') return;
      // 先在本地锁住按钮；主进程随后会回推 installing 状态并优雅关闭后端。
      updState = 'installing';
      pill.disabled = true;
      pill.classList.remove('ready');
      pill.textContent = `正在重启安装…`;
      desktop.installUpdate();
    });
    return Object.freeze({
      get status() { return updState; }
    });
  }

  return Object.freeze({ createUpdatePill });
});
