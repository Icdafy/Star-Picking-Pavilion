'use strict';

// 摘星阁 · 流体云（Fluid Cloud）—— 窗口顶部正中的实时状态胶囊。
// 采集分析、更新下载与操作提示都汇入同一朵“云”：有事时从标题栏里长出来，
// 点按展开为详情卡，提示读完再缩回胶囊；没有任何活动时完全隐去，不占视线。
// 尺寸变化交给 CSS 弹簧过渡（宽、高、圆角一起流动），这里只测量内容并写入目标尺寸。
(function exposeFluidCloud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.FluidCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFluidCloudModule() {
  const TONES = Object.freeze(['info', 'busy', 'ready', 'error']);
  const CAPSULE_HEIGHT = 26;

  // 多个活动同时存在时：错误 > 进行中 > 就绪 > 普通；同级按最近更新。
  function pickActivity(activities) {
    const rank = { error: 3, busy: 2, ready: 1, info: 0 };
    let best = null;
    for (const item of activities.values()) {
      if (!best || rank[item.tone] > rank[best.tone]
        || (rank[item.tone] === rank[best.tone] && item.at > best.at)) best = item;
    }
    return best;
  }

  function normalizeActivity(key, spec = {}, at = 0) {
    const tone = TONES.includes(spec.tone) ? spec.tone : 'info';
    const progress = Number(spec.progress);
    return {
      key: String(key),
      tone,
      title: String(spec.title || ''),
      value: spec.value == null ? '' : String(spec.value),
      detail: spec.detail == null ? '' : String(spec.detail),
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null,
      facts: Array.isArray(spec.facts) ? spec.facts.slice(0, 4).map(([label, value]) => [String(label), String(value)]) : [],
      actions: Array.isArray(spec.actions) ? spec.actions.filter(action => typeof action?.run === 'function').slice(0, 2) : [],
      at
    };
  }

  function createFluidCloud(deps = {}) {
    const doc = deps.document;
    const win = deps.window || doc?.defaultView;
    const tempo = Number(deps.tempo) > 0 ? Number(deps.tempo) : 1;
    const host = doc?.getElementById?.('fluidCloud');
    const inert = Object.freeze({ setActivity() {}, clearActivity() {}, collapse() {}, dispose() {}, getState: () => 'hidden' });
    if (!host) return inert;
    const shell = host.querySelector('.fluid-cloud-shell');
    const capsule = host.querySelector('.fluid-cloud-capsule');
    const panel = host.querySelector('.fluid-cloud-panel');
    const toast = host.querySelector('.toast');
    const $ = selector => host.querySelector(selector);
    const activities = new Map();
    const cleanups = [];
    let clock = 0;
    let expanded = false;
    let current = null;
    let glint = null;
    let frame = 0;
    let disposed = false;

    function listen(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }
    const reduced = () => { try { return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
    const noticeShown = () => Boolean(toast?.classList.contains('show') && toast.textContent);

    function setText(selector, text) {
      const node = $(selector);
      if (node && node.textContent !== text) node.textContent = text;
      return node;
    }

    function renderMeter(meter, progress) {
      if (!meter) return;
      meter.hidden = progress == null && current?.tone !== 'busy';
      host.style.setProperty('--cloud-p', String(progress == null ? .382 : Math.max(.04, progress)));
    }

    function renderPanel(item) {
      setText('.fluid-cloud-panel-title', item.title);
      const detail = setText('.fluid-cloud-detail', item.detail);
      if (detail) detail.hidden = !item.detail;
      renderMeter($('.fluid-cloud-panel .fluid-cloud-meter'), item.progress);
      const facts = $('.fluid-cloud-facts');
      if (facts) {
        facts.hidden = !item.facts.length;
        facts.replaceChildren(...item.facts.map(([label, value]) => {
          const cell = doc.createElement('div');
          const term = doc.createElement('dt');
          const data = doc.createElement('dd');
          term.textContent = label;
          data.textContent = value;
          cell.append(term, data);
          return cell;
        }));
      }
      const actions = $('.fluid-cloud-actions');
      if (actions) {
        actions.replaceChildren(...item.actions.map(action => {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = `${action.primary ? 'btn-primary' : 'btn-ghost'} btn-compact`;
          button.textContent = String(action.label || '');
          button.addEventListener('click', () => { collapse(); action.run(); });
          return button;
        }));
      }
    }

    // 进行中的活动上，一道光沿进度条向前流动；失焦、隐藏和减少动态效果时停下。
    function syncGlint() {
      const node = $('.fluid-cloud-capsule .fluid-cloud-glint');
      const want = current?.tone === 'busy' && host.dataset.state === 'capsule' && !reduced()
        && !doc.hidden && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
      if (!want || !node || typeof node.animate !== 'function') {
        try { glint?.cancel(); } catch {}
        glint = null;
        return;
      }
      if (glint) return;
      try {
        glint = node.animate([{ translate: '-100% 0' }, { translate: '262% 0' }],
          { duration: 1618 * tempo, iterations: Infinity, easing: 'cubic-bezier(.45, 0, .25, 1)' });
      } catch { glint = null; }
    }

    // 尺寸：读取当前要显示的那一层内容的自然尺寸，写入外壳的目标宽高。
    function measure() {
      frame = 0;
      if (disposed) return;
      const state = host.dataset.state;
      let width = CAPSULE_HEIGHT;
      let height = CAPSULE_HEIGHT;
      if (state === 'notice' && toast) {
        width = Math.ceil(toast.scrollWidth || toast.offsetWidth || 0);
        height = Math.max(CAPSULE_HEIGHT + 6, Math.ceil(toast.offsetHeight || 0));
      } else if (state === 'expanded' && panel) {
        width = Math.ceil(panel.offsetWidth || 0);
        height = Math.ceil(panel.offsetHeight || 0);
      } else if (state === 'capsule' && capsule) {
        width = Math.ceil(capsule.scrollWidth || capsule.offsetWidth || 0);
      }
      const max = Math.max(160, (win?.innerWidth || 1200) - 280);
      host.style.setProperty('--cloud-w', `${Math.min(max, Math.max(CAPSULE_HEIGHT, width))}px`);
      host.style.setProperty('--cloud-h', `${Math.max(CAPSULE_HEIGHT, height)}px`);
      syncGlint();
    }
    function scheduleMeasure() {
      if (frame || typeof win?.requestAnimationFrame !== 'function') { if (!frame) measure(); return; }
      frame = win.requestAnimationFrame(measure);
    }

    function render() {
      if (disposed) return;
      current = pickActivity(activities);
      if (!current) expanded = false;
      const state = noticeShown() ? 'notice' : !current ? 'hidden' : expanded ? 'expanded' : 'capsule';
      host.dataset.state = state;
      host.dataset.tone = state === 'notice' ? (toast.classList.contains('error') ? 'error' : 'info') : current?.tone || 'info';
      if (current) {
        setText('.fluid-cloud-title', current.title);
        const value = setText('.fluid-cloud-value', current.value);
        if (value) value.hidden = !current.value;
        renderMeter($('.fluid-cloud-capsule .fluid-cloud-meter'), current.progress);
        renderPanel(current);
        capsule?.setAttribute('aria-label', [current.title, current.value, current.detail].filter(Boolean).join('，'));
      }
      capsule?.setAttribute('aria-expanded', String(state === 'expanded'));
      if (capsule) capsule.tabIndex = state === 'capsule' || state === 'expanded' ? 0 : -1;
      if (panel) {
        panel.inert = state !== 'expanded';
        panel.setAttribute('aria-hidden', String(state !== 'expanded'));
      }
      host.setAttribute('aria-hidden', String(state === 'hidden'));
      scheduleMeasure();
    }

    function setActivity(key, spec) {
      activities.set(String(key), normalizeActivity(key, spec, ++clock));
      render();
    }
    function clearActivity(key) {
      if (!activities.delete(String(key))) return;
      render();
    }
    function collapse() {
      if (!expanded) return;
      expanded = false;
      render();
    }

    listen(capsule, 'click', () => {
      if (!current) return;
      expanded = !expanded;
      render();
      if (expanded) win?.setTimeout?.(() => $('.fluid-cloud-actions button')?.focus?.({ preventScroll: true }), 300 * tempo);
    });
    listen(doc, 'keydown', event => {
      if (event.key === 'Escape' && expanded) { collapse(); capsule?.focus?.({ preventScroll: true }); }
    });
    listen(doc, 'pointerdown', event => {
      if (expanded && !host.contains(event.target)) collapse();
    }, { capture: true, passive: true });
    listen(host, 'pointermove', event => {
      const rect = shell?.getBoundingClientRect?.();
      if (rect?.width) host.style.setProperty('--gaze-x', `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
    }, { passive: true });
    listen(win, 'resize', scheduleMeasure);
    listen(win, 'focus', syncGlint);
    listen(win, 'blur', syncGlint);
    listen(doc, 'visibilitychange', syncGlint);
    const observer = toast && win?.MutationObserver ? new win.MutationObserver(render) : null;
    observer?.observe(toast, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
    render();

    return Object.freeze({
      setActivity,
      clearActivity,
      collapse,
      getState: () => host.dataset.state,
      dispose() {
        disposed = true;
        observer?.disconnect();
        try { glint?.cancel(); } catch {}
        if (frame) win?.cancelAnimationFrame?.(frame);
        for (const remove of cleanups.splice(0)) remove();
      }
    });
  }

  return Object.freeze({ createFluidCloud, pickActivity, normalizeActivity });
});
