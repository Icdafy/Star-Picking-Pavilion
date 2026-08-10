'use strict';

/* 摘星阁 · 剪贴板与文件导出
   阶段 3 批 2 自 app.js 抽离：复制/另存为两条本地落盘路径与导出参数拼装。
   navigator 与 document 一律走依赖注入，工厂体内不出现 window 直读。 */

(function exposeExportController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.ExportController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createExportControllerModule() {
  function createExportController({ api, toast, state, navigator, document, elements = {} } = {}) {
    if (typeof api !== 'function' || typeof toast !== 'function' || !state || !navigator || !document) {
      throw new TypeError('export controller requires api, toast, state, navigator and document dependencies');
    }

    // 沙箱渲染进程里 navigator.clipboard 需要用户手势，且旧内核可能缺失；
    // 失败时回退到临时 textarea + execCommand，保证「复制」这个动作永远有结果。
    async function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch { /* 落到下面的回退路径 */ }
      const scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.setAttribute('readonly', '');
      scratch.className = 'copy-scratch';
      document.body.appendChild(scratch);
      scratch.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      scratch.remove();
      return copied;
    }

    // 内容安全策略是 default-src 'self'，因此不能借助任何外部服务落盘；
    // blob: 由页面自己生成，配合 a[download] 完成一次纯本地的另存为。
    function downloadText(filename, text) {
      // 带 BOM：Windows 记事本按 UTF-8 打开中文，不会显示成乱码
      const blob = new Blob([`\ufeff${text}`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    function exportParams(kind, format) {
      const params = new URLSearchParams({ kind, format });
      if (kind === 'daily') {
        if (state.dailyDate) params.set('date', state.dailyDate);
        return params;
      }
      params.set('view', state.view);
      if (state.domain) params.set('domain', state.domain);
      if (state.category) params.set('category', state.category);
      if (state.q) params.set('q', state.q);
      return params;
    }

    async function runExport(kind, format, mode) {
      try {
        const result = await api('/api/export?' + exportParams(kind, format));
        if (mode === 'copy') {
          const copied = await copyText(result.content);
          toast(copied ? `已复制 ${result.count} 条到剪贴板` : '复制失败，请手动选择文本', !copied);
          return;
        }
        downloadText(result.filename, result.content);
        toast(`已导出 ${result.count} 条到 ${result.filename}`);
      } catch (error) {
        toast('导出失败：' + error.message, true);
      }
    }

    if (elements.btnCopyFeed) elements.btnCopyFeed.addEventListener('click', () => runExport('feed', 'text', 'copy'));
    if (elements.btnExportFeed) elements.btnExportFeed.addEventListener('click', () => runExport('feed', 'markdown', 'download'));
    if (elements.btnCopyDaily) elements.btnCopyDaily.addEventListener('click', () => runExport('daily', 'text', 'copy'));
    if (elements.btnExportDaily) elements.btnExportDaily.addEventListener('click', () => runExport('daily', 'markdown', 'download'));

    return Object.freeze({ copyText, downloadText, exportParams, runExport });
  }

  return Object.freeze({ createExportController });
});
