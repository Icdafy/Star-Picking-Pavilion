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
    light: Object.freeze({ duration: 160 }),
    medium: Object.freeze({ duration: 260 }),
    heavy: Object.freeze({ duration: 320 })
  });
  const SPRING_SAMPLES = 10;    // 采样帧数（含首尾共 11 帧，落在 8-12 预算内）
  const STAGGER_LIMIT = 8;      // 错峰入场上限：只作用于本次新增的前 N 个节点
  const SPRING_EASING = 'cubic-bezier(.22, .9, .3, 1)';

  // 轻阻尼采样：小幅回弹后收敛于 1（t=1 强制落定），正文少位移。
  function springProgress(t) {
    if (t >= 1) return 1;
    return 1 - Math.exp(-8 * t) * Math.cos(5 * t);
  }

  function createMotion(deps = {}) {
    const { document: doc = null, matchMedia = null, raf = null } = deps || {};
    const win = deps.window || doc?.defaultView;
    const setTimer = deps.setTimeout || win?.setTimeout?.bind(win);
    const clearTimer = deps.clearTimeout || win?.clearTimeout?.bind(win);
    const active = new Map();
    let disposed = false;
    let media = null;
    try { media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null; } catch {}

    function prefersReducedMotion() {
      try {
        return Boolean(media?.matches);
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
      return disposed || Boolean(doc?.hidden)
        || (typeof doc?.hasFocus === 'function' && !doc.hasFocus())
        || prefersReducedMotion() || fxTier() === 'static';
    }

    function release(el, record) {
      if (record.timeout != null) clearTimer?.(record.timeout);
      if (active.get(el) === record) {
        active.delete(el);
        if (record.restoreStyles) settle(el, record.original);
      }
      try { record.animation?.cancel(); } catch {}
    }
    function cancel(el) {
      const record = active.get(el);
      if (record) release(el, record);
    }
    function cancelAll() {
      for (const [el, record] of active) release(el, record);
    }
    function cancelTree(root) {
      if (!root) return;
      for (const [el, record] of active) {
        if (el === root || root.contains?.(el)) release(el, record);
      }
    }
    function syncEnvironment() { if (shouldSkip()) cancelAll(); }
    media?.addEventListener?.('change', syncEnvironment);
    doc?.addEventListener?.('visibilitychange', syncEnvironment);
    win?.addEventListener?.('blur', syncEnvironment);

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
    function spring(el, { keyframes, from, to, duration, stiffness = 'medium', delay = 0, restoreStyles = false } = {}) {
      if (!el) return null;
      cancel(el);
      const preset = MOTION_STIFFNESS[stiffness] || MOTION_STIFFNESS.medium;
      const total = Number(duration) > 0 ? Number(duration) : preset.duration;
      const endStyle = to || lastFrameStyle(keyframes);
      const original = {};
      if (restoreStyles && el.style) {
        for (const name of Object.keys(endStyle || {})) original[name] = el.style[name] || '';
      }
      if (shouldSkip() || typeof el.animate !== 'function') {
        settle(el, endStyle);
        if (restoreStyles) settle(el, original);
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
        const record = { animation, original, restoreStyles, timeout: null };
        active.set(el, record);
        // 视觉时钟或 finished 回调延迟时，仍按交互时限提交已写入的终态。
        // 重新定向与环境清理会撤销旧时限，不让旧回调覆盖最新意图。
        if (typeof setTimer === 'function') record.timeout = setTimer(
          () => release(el, record), total + (Number(delay) > 0 ? Number(delay) : 0) + 50
        );
        // 结束后取消动画对象，释放合成层资源；终态已落在 inline style，
        // 取消不产生视觉跳变。rAF 缺失时直接取消，不作资源兜底的依赖，
        // rAF 只是「再等一帧」的可选优化
        if (animation && typeof animation.finished?.then === 'function') {
          animation.finished
            .then(() => {
              const finish = () => release(el, record);
              if (typeof raf === 'function' && !shouldSkip()) raf(finish);
              else finish();
            })
            .catch(() => { if (active.get(el) === record) release(el, record); });
        }
        return animation;
      } catch {
        if (restoreStyles) settle(el, original);
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
      const distance = Number(opts.distance) > 0 ? Number(opts.distance) : 6;
      return spring(el, {
        keyframes: fadeSlideFrames(distance),
        to: { transform: 'translateY(0)', opacity: '1' },
        duration: opts.duration,
        stiffness: opts.stiffness || 'medium',
        delay: opts.delay,
        restoreStyles: opts.restoreStyles
      });
    }

    // 错峰入场：只作用于列表前 STAGGER_LIMIT 个节点（上限截断），
    // 返回实际参与动画的节点数
    function staggerIn(els, opts = {}) {
      const nodes = (Array.isArray(els) ? els : Array.from(els || [])).filter(Boolean);
      const limited = nodes.slice(0, STAGGER_LIMIT);
      const step = Number(opts.step) > 0 ? Number(opts.step) : 25;
      const baseDelay = Number(opts.delay) > 0 ? Number(opts.delay) : 0;
      limited.forEach((el, index) => fadeSlideIn(el, { ...opts, delay: baseDelay + index * step }));
      return limited.length;
    }

    // FLIP：在改向前捕获实际视觉位置，尺寸一次落定，只插值 transform。
    // 连点时从正在播放的帧继续，不从上一个目标重新起跑。
    function retargetIndicator(el, { x, y, width, height, immediate = false } = {}) {
      if (!el?.style || !width || !height) return null;
      const target = `${x},${y},${width},${height}`;
      if (!immediate && el.dataset?.motionTarget === target) return null;
      const before = el.getBoundingClientRect?.();
      cancel(el);
      el.style.transition = 'none';
      el.style.transformOrigin = '0 0';
      el.style.setProperty('--ti-x', `${x}px`);
      el.style.setProperty('--ti-y', `${y}px`);
      el.style.setProperty('--ti-w', `${width}px`);
      el.style.setProperty('--ti-h', `${height}px`);
      el.style.setProperty('--ti-o', '1');
      el.style.transform = `translate(${x}px, ${y}px)`;
      if (el.dataset) el.dataset.motionTarget = target;
      if (immediate || shouldSkip() || !before?.width || !before?.height) return null;
      const after = el.getBoundingClientRect?.();
      if (!after?.width || !after?.height) return null;
      const dx = before.left - after.left, dy = before.top - after.top;
      const sx = before.width / after.width, sy = before.height / after.height;
      const frames = Array.from({ length: SPRING_SAMPLES + 1 }, (_, i) => {
        const t = i / SPRING_SAMPLES, remaining = 1 - springProgress(t);
        return {
          offset: t,
          transform: `translate(${x + dx * remaining}px, ${y + dy * remaining}px) scale(${1 + (sx - 1) * remaining}, ${1 + (sy - 1) * remaining})`
        };
      });
      return spring(el, { keyframes: frames, duration: fxTier() === 'lite' ? 180 : 300 });
    }

    return Object.freeze({
      spring,
      fadeSlideIn,
      staggerIn,
      retargetIndicator,
      cancel,
      cancelAll,
      cancelTree,
      dispose() {
        disposed = true;
        cancelAll();
        media?.removeEventListener?.('change', syncEnvironment);
        doc?.removeEventListener?.('visibilitychange', syncEnvironment);
        win?.removeEventListener?.('blur', syncEnvironment);
      },
      STAGGER_LIMIT,
      MOTION_STIFFNESS
    });
  }

  // 高频交互的装饰层；委托监听，不为每张卡片安装事件或常驻 RAF。
  function createInteractionMotion({ document: doc, window: win, motion } = {}) {
    if (!doc || !win || !motion || !win.MutationObserver) return Object.freeze({ dispose() {} });
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const cleanups = [], groups = [], waves = new Map();
    const controlSelector = 'button:not(:disabled):not([aria-disabled="true"])';
    const surfaceSelector = '.card, .common-links-card';
    let disposed = false, glow = null, surface = null, rect = null, frame = null;
    let x = 0, y = 0, targetX = 0, targetY = 0, lastTime = 0;
    let velocityX = 0, velocityY = 0;
    const canMove = () => !disposed && !doc.hidden && !reduced?.matches
      && doc.documentElement.dataset.fxTier !== 'static'
      && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
    const full = () => canMove() && doc.documentElement.dataset.fxTier === 'full';
    function listen(target, event, handler, options) {
      target?.addEventListener?.(event, handler, options);
      cleanups.push(() => target?.removeEventListener?.(event, handler, options));
    }
    function clearWave(button) {
      const wave = waves.get(button);
      if (!wave) return;
      waves.delete(button);
      win.clearTimeout(wave.timeout);
      try { wave.animation?.cancel(); } catch {}
      wave.node.remove();
      button.classList.remove('motion-wave-host');
      if (wave.positioned) button.classList.remove('motion-control');
    }
    function press(button, event) {
      if (!canMove() || !button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      clearWave(button);
      if (waves.size >= 4) clearWave(waves.keys().next().value);
      const bounds = button.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const node = doc.createElement('span');
      node.className = 'press-wave'; node.setAttribute('aria-hidden', 'true');
      const keyboard = !event || event.type === 'keydown';
      node.style.left = `${keyboard ? bounds.width / 2 : event.clientX - bounds.left}px`;
      node.style.top = `${keyboard ? bounds.height / 2 : event.clientY - bounds.top}px`;
      const positioned = win.getComputedStyle(button).position === 'static';
      if (positioned) button.classList.add('motion-control');
      button.classList.add('motion-wave-host');
      button.appendChild(node);
      const wave = { node, positioned, animation: null, timeout: null };
      waves.set(button, wave);
      try {
        wave.animation = node.animate([
          { transform: 'translate(-50%, -50%) scale(.25)', opacity: .24 },
          { transform: `translate(-50%, -50%) scale(${Math.max(bounds.width, bounds.height) / 18})`, opacity: 0 }
        ], { duration: 420, easing: 'cubic-bezier(.16, 1, .3, 1)' });
        wave.animation.finished.then(() => { if (waves.get(button) === wave) clearWave(button); })
          .catch(() => { if (waves.get(button) === wave) clearWave(button); });
        // 渲染时钟暂停或完成回调延迟时也有 500ms 的资源寿命上限。
        // 正常完成先清理；替换、减少动画、失焦和销毁都撤销此计时器。
        wave.timeout = win.setTimeout(() => { if (waves.get(button) === wave) clearWave(button); }, 500);
      } catch { clearWave(button); }
    }
    function clearGlow() {
      motion.cancel(glow);
      if (frame != null) win.cancelAnimationFrame(frame);
      frame = null; lastTime = 0; velocityX = 0; velocityY = 0;
      glow?.remove(); surface?.classList.remove('motion-surface');
      glow = null; surface = null; rect = null;
    }
    function tick(now) {
      frame = null;
      if (!full() || !surface?.isConnected || !glow) { clearGlow(); return; }
      // 有限步长防止长帧后弹簧发散；运动停止即释放帧循环。
      const elapsed = lastTime ? Math.min((now - lastTime) / 1000, .032) : 1 / 60;
      lastTime = now;
      const steps = Math.max(1, Math.ceil(elapsed / .008));
      const dt = elapsed / steps;
      for (let i = 0; i < steps; i += 1) {
        velocityX += ((targetX - x) * 600 - velocityX * 42) * dt;
        velocityY += ((targetY - y) * 600 - velocityY * 42) * dt;
        x += velocityX * dt; y += velocityY * dt;
      }
      const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < .3
        && Math.abs(velocityX) + Math.abs(velocityY) < 2;
      if (settled) { x = targetX; y = targetY; velocityX = 0; velocityY = 0; lastTime = 0; }
      glow.style.transform = `translate(${x - 90}px, ${y - 90}px)`;
      if (!settled) frame = win.requestAnimationFrame(tick);
    }
    function onOver(event) {
      if (!full() || event.pointerType === 'touch') return;
      const next = event.target.closest?.(surfaceSelector);
      if (!next || next === surface) return;
      clearGlow(); surface = next; rect = next.getBoundingClientRect();
      surface.classList.add('motion-surface');
      glow = doc.createElement('span'); glow.className = 'surface-glow';
      glow.setAttribute('aria-hidden', 'true'); surface.appendChild(glow);
      x = targetX = event.clientX - rect.left; y = targetY = event.clientY - rect.top;
      glow.style.transform = `translate(${x - 90}px, ${y - 90}px)`;
      motion.spring(glow, { from: { opacity: '0' }, to: { opacity: '1' }, duration: 180 });
    }
    function onMove(event) {
      if (!surface) onOver(event);
      if (!surface || !rect || !full()) return;
      targetX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      targetY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      if (frame == null) frame = win.requestAnimationFrame(tick);
    }
    function onOut(event) {
      if (surface && !surface.contains(event.relatedTarget)) {
        motion.cancel(glow); clearGlow();
      }
    }
    function syncGroup(record, immediate = false) {
      if (disposed || record.busy) return;
      const { group, indicator } = record;
      const selected = [...group.children].find(node => node.matches?.('button.active'));
      if (!selected || !selected.offsetWidth || !selected.offsetHeight) return;
      record.busy = true;
      if (indicator.parentNode !== group) group.appendChild(indicator);
      motion.retargetIndicator(indicator, {
        x: selected.offsetLeft, y: selected.offsetTop,
        width: selected.offsetWidth, height: selected.offsetHeight, immediate
      });
      record.busy = false;
    }
    // 只观察小型选择控件，信息流的全量 DOM 不进入 MutationObserver。
    const groupNodes = doc.querySelectorAll('.domain-pills, #hotDomains, #capitalDomains, #capitalTabs, #periodSwitch, #catChips');
    for (const group of groupNodes) {
      const indicator = doc.createElement('span');
      indicator.className = 'selection-indicator'; indicator.setAttribute('aria-hidden', 'true');
      group.classList.add('motion-segmented');
      const record = { group, indicator, busy: false };
      groups.push(record); syncGroup(record, true);
      const observer = new win.MutationObserver(mutations => {
        if (mutations.some(m => m.type === 'attributes'
          || [...m.addedNodes, ...m.removedNodes].some(n => n !== indicator && n.nodeType === 1 && !n.matches?.('.press-wave')))) syncGroup(record);
      });
      observer.observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      cleanups.push(() => observer.disconnect());
    }
    function syncSizes() { for (const record of groups) syncGroup(record, true); }
    const resize = win.ResizeObserver ? new win.ResizeObserver(syncSizes) : null;
    groups.forEach(({ group }) => resize?.observe(group));
    doc.fonts?.ready?.then(() => { if (!disposed) syncSizes(); }).catch(() => {});
    function settleEnvironment() {
      if (!full()) { motion.cancel(glow); clearGlow(); }
      if (!canMove()) { for (const button of waves.keys()) clearWave(button); }
      syncSizes();
    }
    const environment = new win.MutationObserver(settleEnvironment);
    environment.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-fx-tier'] });
    listen(doc, 'pointerdown', event => { if (event.button === 0) press(event.target.closest?.(controlSelector), event); }, { passive: true });
    listen(doc, 'keydown', event => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) press(event.target.closest?.(controlSelector), event);
    });
    listen(doc, 'pointerover', onOver, { passive: true });
    listen(doc, 'pointermove', onMove, { passive: true });
    listen(doc, 'pointerout', onOut, { passive: true });
    listen(doc, 'scroll', () => { motion.cancel(glow); clearGlow(); }, { passive: true, capture: true });
    listen(doc, 'visibilitychange', settleEnvironment);
    listen(win, 'blur', settleEnvironment);
    listen(win, 'resize', () => { clearGlow(); syncSizes(); }, { passive: true });
    listen(reduced, 'change', settleEnvironment);
    return Object.freeze({
      dispose() {
        if (disposed) return;
        disposed = true;
        motion.cancel(glow); clearGlow();
        for (const button of waves.keys()) clearWave(button);
        cleanups.splice(0).forEach(cleanup => cleanup());
        resize?.disconnect(); environment.disconnect();
        for (const { group, indicator } of groups) {
          motion.cancel(indicator); indicator.remove(); group.classList.remove('motion-segmented');
        }
      }
    });
  }

  return Object.freeze({
    escapeHTML,
    safeHttpUrl,
    findFocusKey,
    restoreFocusByKey,
    createMotion,
    createInteractionMotion
  });
});
