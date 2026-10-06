'use strict';

/* 工作区更新按钮：依赖注入桌面桥与元素，保持 SVG 和焦点节点稳定。 */

(function exposeUpdatePill(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.UpdatePill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUpdatePillModule() {
  function createUpdatePill({ desktop, pill, progress, live, motion } = {}) {
    if (!desktop || typeof desktop.onUpdateStatus !== 'function' || !pill) return null;
    const arc = pill.querySelector('[data-update-arc]');
    const icon = pill.querySelector('[data-update-icon]');
    const value = pill.querySelector('[data-update-value]');
    const caption = pill.querySelector('[data-update-caption]');
    const states = ['idle', 'checking', 'current', 'available', 'downloading', 'downloaded', 'installing', 'error'];
    let updState = 'idle', updateVersion = '', lastAnnouncement = '', pendingUpdate = false;
    function render({ status, version, percent, message } = {}) {
      if (!states.includes(status)) return;
      const previous = updState;
      updState = status;
      if (version) updateVersion = String(version);
      if (['available', 'downloading', 'downloaded', 'installing'].includes(status)) pendingUpdate = true;
      else if (status === 'current') pendingUpdate = false;
      const busy = ['checking', 'available', 'downloading', 'installing'].includes(status);
      const raw = typeof percent === 'number' ? percent : NaN;
      const known = Number.isFinite(raw);
      const amount = Math.round(Math.max(0, Math.min(100, known ? raw : 0)));
      const determinate = status === 'downloading' && known;
      const complete = status === 'downloaded' || status === 'current';
      const labels = {
        idle: '检查更新', checking: '正在检查更新…', current: `已是最新版本 ${updateVersion}`,
        available: `发现新版本 ${updateVersion}，准备下载…`,
        downloading: `下载更新${updateVersion ? ` ${updateVersion}` : ''}${known ? ` ${amount}%` : '…'}`,
        downloaded: `重启安装 ${updateVersion}`, installing: `正在重启安装${updateVersion ? ` ${updateVersion}` : ''}…`,
        error: pendingUpdate ? '更新失败，点击重试' : '更新检查暂时不可用'
      };
      const label = labels[status];
      // 检查过程保持安静；发现更新后保留下载、重试和重启入口，安装完成才隐藏。
      pill.hidden = !pendingUpdate;
      pill.dataset.state = status;
      pill.dataset.indeterminate = String(busy && !determinate);
      pill.classList.toggle('error', status === 'error');
      pill.classList.toggle('ready', status === 'downloaded');
      pill.disabled = status === 'installing';
      pill.setAttribute('aria-busy', String(busy));
      pill.setAttribute('aria-disabled', String(busy));
      pill.setAttribute('aria-label', label);
      pill.title = status === 'error' ? `${message || '更新暂时不可用'}；点击重试` : label;
      arc?.setAttribute('stroke-dashoffset', String(determinate ? 100 - amount : complete ? 0 : busy ? 72 : 100));
      if (value) {
        value.hidden = !determinate && status !== 'error';
        value.textContent = determinate ? `${amount}%` : '!';
      }
      if (icon) {
        if (determinate || status === 'error') icon.setAttribute('hidden', '');
        else icon.removeAttribute('hidden');
        icon.querySelector?.('path')?.setAttribute('d', status === 'current' ? 'm4 10 4 4 8-8'
          : status === 'downloaded' ? 'M15.5 7A6 6 0 1 0 16 12M15.5 3v4H11'
          : 'M10 3v9m-3-3 3 3 3-3M4 13v3h12v-3');
      }
      if (caption) caption.textContent = ({ checking: '检查', downloading: '下载', downloaded: '重启', installing: '安装', error: '重试', current: '最新' })[status] || '更新';
      if (status !== previous && !pill.hidden) {
        motion?.revealText?.([caption].filter(Boolean));
        if (icon && !determinate && status !== 'error') motion?.spring?.(icon, {
          from: { transform: 'translateY(-3px) scale(.84)', opacity: '0' },
          to: { transform: 'none', opacity: '1' }, duration: 260, restoreStyles: true
        });
      }
      if (progress) {
        progress.hidden = status !== 'downloading';
        if (determinate) progress.setAttribute('aria-valuenow', String(amount));
        else progress.removeAttribute('aria-valuenow');
        progress.setAttribute('aria-valuetext', label);
      }
      // 下载只按 10% 播报，环形和可见数字仍逐百分比更新。
      const announcement = status === 'downloading' ? `${status}:${known ? Math.floor(amount / 10) : '?'}` : status;
      if (live && announcement !== lastAnnouncement) { live.textContent = label; lastAnnouncement = announcement; }
    }
    render({ status: 'idle' });
    desktop.onUpdateStatus(render);
    pill.addEventListener('click', async () => {
      if (['checking', 'available', 'downloading', 'installing'].includes(updState)) return;
      if (updState === 'downloaded') {
        render({ status: 'installing' });
        try { desktop.installUpdate(); }
        catch (error) { render({ status: 'error', message: String(error?.message || error) }); }
        return;
      }
      if (typeof desktop.checkForUpdates !== 'function') return;
      render({ status: 'checking' });
      try {
        const result = await desktop.checkForUpdates();
        if (updState !== 'checking' || result?.started !== false) return;
        if (result.reason === 'throttled') render({ status: 'idle', message: '稍后可再次检查' });
        else if (result.reason !== 'busy') render({ status: 'error', message: result.message || '更新检查暂时不可用，请稍后重试' });
      } catch (error) {
        if (updState === 'checking') render({ status: 'error', message: String(error?.message || error) });
      }
    });
    return Object.freeze({
      get status() { return updState; }
    });
  }

  return Object.freeze({ createUpdatePill });
});
