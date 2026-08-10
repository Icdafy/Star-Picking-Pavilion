'use strict';

/* 摘星阁 · 格式化纯工具（零依赖）
   阶段 3 批 1 自 app.js 抽离：时间与字节的可读化、本地日历日期、
   骨架屏最短驻留常量与领域中文名。全部为纯函数/常量，不触 DOM、
   不读 window——Node 可直接 require，供单测驱动。 */

(function exposeFormatUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.FormatUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFormatUtilsModule() {
  // 骨架屏的最短驻留：本地接口常不到 100ms 返回，没有下限的话骨架只是
  // 一闪而过的噪点，比不显示更晃眼
  const SKELETON_MIN_MS = 240;

  const DOMAIN_NAME = Object.freeze({ lowaltitude: '低空经济', aerospace: '商业航天' });

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function timeAgo(iso) {
    if (!iso) return '时间未知';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return new Date(iso).toLocaleDateString('zh-CN');
  }

  function dateLabel(iso) {
    if (!iso) return '日期未知';
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diff = Math.round((today - that) / 86400e3);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function hhmm(iso) {
    if (!iso) return '--:--';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function parseLocalDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 MB';
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1048576).toFixed(1)} MB`;
    return `${(value / 1073741824).toFixed(2)} GB`;
  }

  return Object.freeze({
    SKELETON_MIN_MS,
    DOMAIN_NAME,
    delay,
    timeAgo,
    dateLabel,
    hhmm,
    localDateString,
    parseLocalDate,
    formatBytes
  });
});
