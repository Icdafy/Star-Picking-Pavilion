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

  // ---------- 液态玻璃阶段 3：微型运动引擎（WAAPI） ----------
  // 只做 transform/opacity 的合成层动画：spring 曲线预烘焙成少量 offset
  // 采样帧交给 el.animate()，不做运行时求解。reduced 偏好或 static 档位
  // 直接落终态不播动画；el.animate 缺席同样优雅降级为终态。document /
  // matchMedia / rAF 一律经 deps 注入，工厂体内不裸读全局。
  const MOTION_STIFFNESS = Object.freeze({
    light: Object.freeze({ duration: 240 }),
    medium: Object.freeze({ duration: 320 }),
    heavy: Object.freeze({ duration: 440 })
  });
  const SPRING_SAMPLES = 10;    // 采样帧数（含首尾共 11 帧，落在 8-12 预算内）
  const STAGGER_LIMIT = 8;      // 错峰入场上限：只作用于本次新增的前 N 个节点
  const SPRING_EASING = 'cubic-bezier(.34, 1.56, .5, 1)';

  // 阻尼振荡采样：0 → 约 +9% 过冲 → 回摆收敛于 1（t=1 强制落定）
  function springProgress(t) {
    if (t >= 1) return 1;
    return 1 - Math.exp(-6 * t) * Math.cos(8 * t);
  }

  function createMotion(deps = {}) {
    const { document: doc = null, matchMedia = null, raf = null } = deps || {};

    function prefersReducedMotion() {
      try {
        return typeof matchMedia === 'function'
          && Boolean(matchMedia('(prefers-reduced-motion: reduce)')?.matches);
      } catch {
        return false;
      }
    }
    function fxTier() {
      try {
        return doc?.documentElement?.dataset?.fxTier || '';
      } catch {
        return '';
      }
    }
    // reduced 偏好与 static 档都跳过动画，直接落终态
    function shouldSkip() {
      return prefersReducedMotion() || fxTier() === 'static';
    }

    function settle(el, endStyle) {
      if (!el?.style || !endStyle) return;
      for (const [name, value] of Object.entries(endStyle)) {
        try { el.style[name] = value; } catch { /* 动画是增强层，写样式失败不影响内容 */ }
      }
    }

    function lastFrameStyle(keyframes) {
      if (!Array.isArray(keyframes) || !keyframes.length) return null;
      const last = keyframes[keyframes.length - 1] || {};
      const style = {};
      if ('transform' in last) style.transform = last.transform;
      if ('opacity' in last) style.opacity = last.opacity;
      return Object.keys(style).length ? style : null;
    }

    // spring(el, { keyframes | from/to, duration, stiffness, delay })
    // 优先 el.animate()：预烘焙帧走 linear，双帧走弹簧 bezier；先把终态写成
    // inline，动画结束后自然落定。fill 只取 backwards：delay 期内应用首帧，
    // 避免错峰延迟期以 inline 终态闪现；不用 forwards/both，终态由 inline
    // 保证，动画结束不留 fill 锁住合成层
    function spring(el, { keyframes, from, to, duration, stiffness = 'medium', delay = 0 } = {}) {
      if (!el) return null;
      const preset = MOTION_STIFFNESS[stiffness] || MOTION_STIFFNESS.medium;
      const total = Number(duration) > 0 ? Number(duration) : preset.duration;
      const endStyle = to || lastFrameStyle(keyframes);
      if (shouldSkip() || typeof el.animate !== 'function') {
        settle(el, endStyle);
        return null;
      }
      const preBaked = Array.isArray(keyframes) && keyframes.length >= 2;
      const frames = preBaked ? keyframes : [from || {}, endStyle || {}];
      try {
        settle(el, endStyle);
        const animation = el.animate(frames, {
          duration: total,
          delay: Number(delay) > 0 ? Number(delay) : 0,
          easing: preBaked ? 'linear' : SPRING_EASING,
          fill: 'backwards'
        });
        // 结束后取消动画对象，释放合成层资源；终态已落在 inline style，
        // 取消不产生视觉跳变。rAF 缺失时直接取消，不作资源兜底的依赖，
        // rAF 只是「再等一帧」的可选优化
        if (animation && typeof animation.finished?.then === 'function') {
          animation.finished
            .then(() => {
              const release = () => { try { animation.cancel(); } catch {} };
              if (typeof raf === 'function') raf(release);
              else release();
            })
            .catch(() => {});
        }
        return animation;
      } catch {
        return null;
      }
    }

    // 预烘焙 fadeSlideIn 采样帧：translateY(distance)→0 + opacity 0→1
    function fadeSlideFrames(distance) {
      const frames = [];
      for (let i = 0; i <= SPRING_SAMPLES; i += 1) {
        const t = i / SPRING_SAMPLES;
        const progress = springProgress(t);
        frames.push({
          offset: Number(t.toFixed(3)),
          transform: `translateY(${((1 - progress) * distance).toFixed(2)}px)`,
          opacity: String(Math.max(0, Math.min(1, progress)))
        });
      }
      return frames;
    }

    function fadeSlideIn(el, opts = {}) {
      const distance = Number(opts.distance) > 0 ? Number(opts.distance) : 10;
      return spring(el, {
        keyframes: fadeSlideFrames(distance),
        to: { transform: 'translateY(0)', opacity: '1' },
        duration: opts.duration,
        stiffness: opts.stiffness || 'medium',
        delay: opts.delay
      });
    }

    // 错峰入场：只作用于列表前 STAGGER_LIMIT 个节点（上限截断），
    // 返回实际参与动画的节点数
    function staggerIn(els, opts = {}) {
      const nodes = (Array.isArray(els) ? els : Array.from(els || [])).filter(Boolean);
      const limited = nodes.slice(0, STAGGER_LIMIT);
      const step = Number(opts.step) > 0 ? Number(opts.step) : 45;
      const baseDelay = Number(opts.delay) > 0 ? Number(opts.delay) : 0;
      limited.forEach((el, index) => fadeSlideIn(el, { ...opts, delay: baseDelay + index * step }));
      return limited.length;
    }

    return Object.freeze({
      spring,
      fadeSlideIn,
      staggerIn,
      STAGGER_LIMIT,
      MOTION_STIFFNESS
    });
  }

  return Object.freeze({
    escapeHTML,
    safeHttpUrl,
    findFocusKey,
    restoreFocusByKey,
    createMotion
  });
});
