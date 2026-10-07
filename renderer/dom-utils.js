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

  // 解析阻尼弹簧：采样后仍交给 WAAPI，改向时沿用实际播放时刻的速度。
  function indicatorSpring(displacement, velocity, seconds) {
    const decay = 28, frequency = 14;
    const envelope = Math.exp(-decay * seconds);
    const a = displacement, b = (velocity + decay * a) / frequency;
    const cosine = Math.cos(frequency * seconds), sine = Math.sin(frequency * seconds);
    const position = envelope * (a * cosine + b * sine);
    return { position, velocity: envelope * frequency * (-a * sine + b * cosine) - decay * position };
  }

  // The uploaded SVG keeps its original SMIL timeline. Its clock only runs
  // while the pointer is over the mark; every exit returns to the first pose.
  function createBrandLogo({ document: doc, window: win }) {
    const mark = doc.querySelector('[data-brand-logo]');
    if (!mark) return null;
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const abort = new win.AbortController();
    const listeners = [];
    let svg = null, hovered = false, playing = false, disposed = false;
    function listen(target, event, handler) {
      target?.addEventListener?.(event, handler);
      listeners.push(() => target?.removeEventListener?.(event, handler));
    }
    function canPlay() {
      return !disposed && !doc.hidden && doc.hasFocus() && !reduced?.matches
        && doc.documentElement.dataset.fxTier !== 'static';
    }
    function reset() {
      if (!svg) return;
      svg.pauseAnimations();
      svg.setCurrentTime(0);
      playing = false;
    }
    function sync() {
      if (!svg) return;
      if (!hovered || !canPlay()) { reset(); return; }
      if (playing) return;
      svg.setCurrentTime(0);
      svg.unpauseAnimations();
      playing = true;
    }
    function leave() { hovered = false; reset(); }
    listen(mark, 'pointerenter', event => {
      hovered = event.pointerType !== 'touch';
      sync();
    });
    listen(mark, 'pointerleave', leave);
    listen(mark, 'pointercancel', leave);
    listen(win, 'blur', leave);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) leave(); });
    listen(reduced, 'change', sync);
    const observer = new win.MutationObserver(sync);
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-fx-tier'] });

    const ready = win.fetch('/logo.svg', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('Logo asset unavailable');
      const source = new win.DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      if (source.querySelector('parsererror') || source.documentElement.localName !== 'svg') {
        throw new Error('Invalid logo SVG');
      }
      if (disposed) return;
      svg = doc.importNode(source.documentElement, true);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.removeAttribute('role');
      svg.removeAttribute('aria-label');
      // Pause before mounting and again synchronously after mounting, so the
      // first paint cannot show an autoplay frame. The image remains a fallback.
      svg.pauseAnimations();
      mark.replaceChildren(svg);
      reset();
      hovered = mark.matches(':hover');
      sync();
    }).catch(() => { /* Keep the static first pose if the enhancement fails. */ });

    return Object.freeze({ ready, dispose() {
      disposed = true;
      abort.abort();
      leave();
      observer.disconnect();
      for (const remove of listeners) remove();
    } });
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
      for (const name of ['transform', 'opacity', 'clipPath']) {
        if (name in last) style[name] = last[name];
      }
      return Object.keys(style).length ? style : null;
    }

    // spring(el, { keyframes | from/to, duration, stiffness, delay })
    // 优先 el.animate()：预烘焙帧走 linear，双帧走弹簧 bezier；先把终态写成
    // inline，动画结束后自然落定。fill 只取 backwards：delay 期内应用首帧，
    // 避免错峰延迟期以 inline 终态闪现；不用 forwards/both，终态由 inline
    // 保证，动画结束不留 fill 锁住合成层
    function spring(el, { keyframes, from, to, duration, stiffness = 'medium', delay = 0, restoreStyles = false } = {}) {
      if (!el) return null;
      // 连续改向先读当前合成帧，再释放旧动画；弹窗连开和状态切换不会重跳首帧。
      let visual;
      if (active.has(el) && from && typeof win?.getComputedStyle === 'function') {
        const computed = win.getComputedStyle(el);
        visual = Object.fromEntries(Object.keys(from).map(name => [name, computed[name]]));
      }
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
      const frames = preBaked ? keyframes : [visual || from || {}, endStyle || {}];
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

    // 文字按语义层次入场，保留完整可选中文和读屏顺序，不拆成字粒子。
    function revealText(els) {
      const lite = fxTier() === 'lite';
      const nodes = Array.from(els || []).slice(0, 6);
      nodes.forEach((el, index) => {
        const distance = lite ? 5 : el.matches?.('h1, h2, h3') ? 14 : 8;
        spring(el, {
          from: { transform: `translateY(${distance}px)`, opacity: '0' },
          to: { transform: 'none', opacity: '1' },
          duration: lite ? 180 : 420, delay: index * (lite ? 20 : 45), restoreStyles: true
        });
      });
      return nodes.length;
    }

    function unfold(el) {
      const animation = spring(el, {
        from: { transform: 'translateY(-8px)', opacity: '0', clipPath: 'inset(0 0 100% 0)' },
        to: { transform: 'none', opacity: '1', clipPath: 'inset(0)' },
        duration: fxTier() === 'lite' ? 160 : 280, restoreStyles: true
      });
      Array.from(el?.querySelectorAll?.('.dim-bar > i') || []).slice(0, STAGGER_LIMIT).forEach((bar, index) => {
        spring(bar, { from: { transform: 'scaleX(0)' }, to: { transform: 'none' },
          duration: 320, delay: index * 25, restoreStyles: true });
      });
      return animation;
    }

    // 展开高度只提交一次；相邻可见元素用 FLIP 补偿位移，避免逐帧改变布局。
    // 捕获现有动画的视觉位置使连点改向连续；最多八项，不扫描整条信息流。
    function layoutChange(root, mutate, content) {
      if (typeof mutate !== 'function') return;
      const bounds = [];
      if (!shouldSkip()) {
        let next = root?.nextElementSibling;
        while (next && bounds.length < STAGGER_LIMIT) {
          const rect = next.getBoundingClientRect();
          if (rect.height && rect.top < (win?.innerHeight || Infinity) && rect.bottom > 0) bounds.push([next, rect]);
          else if (rect.top >= (win?.innerHeight || Infinity)) break;
          next = next.nextElementSibling;
        }
      }
      mutate();
      const changes = bounds.map(([node, before]) => {
        cancel(node);
        return [node, before.top - node.getBoundingClientRect().top];
      });
      for (const [node, delta] of changes) {
        if (Math.abs(delta) < .5) continue;
        spring(node, { from: { transform: `translateY(${delta}px)` },
          to: { transform: 'none' }, duration: fxTier() === 'lite' ? 180 : 320, restoreStyles: true });
      }
      if (content && !content.hidden && content.getBoundingClientRect?.().height) unfold(content);
    }

    // FLIP：在改向前捕获实际视觉位置，尺寸一次落定，只插值 transform。
    // 连点时从正在播放的帧继续，不从上一个目标重新起跑。
    function retargetIndicator(el, { x, y, width, height, immediate = false } = {}) {
      if (!el?.style || !width || !height) return null;
      const target = `${x},${y},${width},${height}`;
      if (!immediate && el.dataset?.motionTarget === target) return null;
      const before = el.getBoundingClientRect?.();
      const previous = active.get(el);
      const previousTime = Math.max(0, Number(previous?.animation?.currentTime) || 0) / 1000;
      const momentum = previous?.trajectory?.map(axis => indicatorSpring(axis.position, axis.velocity, previousTime).velocity);
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
      const duration = fxTier() === 'lite' ? 180 : 300;
      const displacement = [dx, dy, (sx - 1) * after.width, (sy - 1) * after.height];
      const trajectory = displacement.map((position, index) => ({ position,
        velocity: fxTier() === 'lite' ? 0 : Math.max(-2200, Math.min(2200, momentum?.[index] || 0))
      }));
      const frames = Array.from({ length: SPRING_SAMPLES + 1 }, (_, i) => {
        const t = i / SPRING_SAMPLES;
        const offsets = trajectory.map(axis => t === 1 ? 0 : indicatorSpring(axis.position, axis.velocity, t * duration / 1000).position);
        return {
          offset: t,
          transform: `translate(${x + offsets[0]}px, ${y + offsets[1]}px) scale(${Math.max(.01, 1 + offsets[2] / after.width)}, ${Math.max(.01, 1 + offsets[3] / after.height)})`
        };
      });
      const animation = spring(el, { keyframes: frames, duration });
      if (active.has(el)) active.get(el).trajectory = trajectory;
      return animation;
    }

    return Object.freeze({
      spring,
      fadeSlideIn,
      staggerIn,
      revealText,
      unfold,
      layoutChange,
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

  function advancePointerAxis(value, elapsed, stiffness = 900, damping = 48) {
    const decay = damping / 2, frequency = Math.sqrt(stiffness - decay * decay);
    const envelope = Math.exp(-decay * elapsed);
    const a = value.position - value.target, b = (value.velocity + decay * a) / frequency;
    const cosine = Math.cos(frequency * elapsed), sine = Math.sin(frequency * elapsed);
    const displacement = envelope * (a * cosine + b * sine);
    value.position = value.target + displacement;
    value.velocity = envelope * frequency * (-a * sine + b * cosine) - decay * displacement;
    const settled = Math.abs(value.target - value.position) < .1 && Math.abs(value.velocity) < .8;
    if (settled) { value.position = value.target; value.velocity = 0; }
    return settled;
  }

  // 连续尾迹、星尘和光环共用一个按需 RAF。输入只采样，几何与绘制按帧合并。
  // 参考 Cuberto 的速度形变和 Codrops 的短尾迹设计；实现不依赖第三方动画库。
  function createPointerEffects({ document: doc, window: win } = {}) {
    const noop = Object.freeze({ move() {}, clear() {}, sync() {}, recordFrame() {}, dispose() {}, getSnapshot() { return {}; } });
    if (!doc?.body || !win?.requestAnimationFrame) return noop;
    const root = doc.documentElement;
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const contrast = win.matchMedia?.('(forced-colors: active)');
    const styles = { comet: [80, 800, 240], stars: [2, 18, 6], ring: [12, 160, 40] };
    const pool = Array.from({ length: 96 }, () => ({ alive: false, drawX: 0, drawY: 0, drawSize: 0, drawAlpha: 0 }));
    const pending = [], trail = [], curve = new Float64Array(385 * 3);
    const metrics = { frames: 0, totalMs: 0, maxMs: 0 };
    const clock = () => win.performance?.now?.() || 0;
    const axis = () => ({ position: 0, target: 0, velocity: 0 });
    const x = axis(), y = axis();
    let disposed = false, config = null, signature = '', frame = null, lastTime = 0;
    let host = null, canvas = null, context = null, ring = null, sprites = null;
    let width = 0, height = 0, ratio = 1, dirty = null, topLayer = null;
    let bufferWidth = 0, bufferHeight = 0;
    let slowFrames = 0, compositionLite = false;
    let cursor = null, present = false, carry = 0, seed = 0x02315a, slot = 0, orbitAngle = 0;
    function allowed() {
      return !disposed && !doc.hidden && !reduced?.matches && !contrast?.matches
        && root.dataset.pointerEnabled !== 'off' && root.dataset.fxTier !== 'static'
        && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
    }
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    }
    function hide() {
      if (!host) return;
      if (host.matches?.(':popover-open')) host.hidePopover();
      host.hidden = true;
      host.style.willChange = '';
      if (ring) { ring.style.opacity = '0'; ring.style.willChange = ''; }
    }
    function clearPixels() {
      if (context && dirty) context.clearRect(dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top);
      dirty = null;
    }
    function reset() {
      if (frame != null) win.cancelAnimationFrame(frame);
      frame = null; lastTime = 0; carry = 0;
      pending.length = 0; trail.length = 0;
      pool.forEach(p => { p.alive = false; });
      clearPixels(); hide();
    }
    function clear() { present = false; cursor = null; reset(); }
    function resize() {
      const nextWidth = Math.max(1, win.innerWidth || root.clientWidth || 1);
      const nextHeight = Math.max(1, win.innerHeight || root.clientHeight || 1);
      // 视口只用来限幅；实际缓冲区按轨迹边界分配，不合成整屏透明纹理。
      const nextRatio = Math.min(win.devicePixelRatio || 1, config.lite ? 1 : 1.5,
        Math.sqrt(4_000_000 / (nextWidth * nextHeight)));
      if (width === nextWidth && height === nextHeight && ratio === nextRatio) return;
      width = nextWidth; height = nextHeight; ratio = nextRatio;
      bufferWidth = bufferHeight = 0;
      canvas.width = canvas.height = 1;
      dirty = null;
    }
    function placeCanvas() {
      if (!dirty) return false;
      const left = Math.floor(dirty.left / 32) * 32, top = Math.floor(dirty.top / 32) * 32;
      const neededWidth = Math.min(width, Math.ceil((dirty.right - left) / 64) * 64);
      const neededHeight = Math.min(height, Math.ceil((dirty.bottom - top) / 64) * 64);
      // 64px 档位且只增长，移动时复用纹理，避免每帧调整 Canvas 大小。
      if (neededWidth > bufferWidth || neededHeight > bufferHeight) {
        bufferWidth = Math.max(bufferWidth, neededWidth); bufferHeight = Math.max(bufferHeight, neededHeight);
        canvas.width = Math.round(bufferWidth * ratio); canvas.height = Math.round(bufferHeight * ratio);
      }
      host.style.width = `${bufferWidth}px`; host.style.height = `${bufferHeight}px`;
      host.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      host.style.willChange = 'transform';
      context.setTransform(ratio, 0, 0, ratio, -left * ratio, -top * ratio);
      return true;
    }
    function mount() {
      if (host) { resize(); return true; }
      host = doc.createElement('div'); host.className = 'pointer-effects';
      host.setAttribute('aria-hidden', 'true'); host.hidden = true;
      // 手动 popover 不夺取焦点；透明顶层让装饰在原生 dialog 上也能显示。
      if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
      canvas = doc.createElement('canvas'); canvas.className = 'pointer-trail-canvas';
      ring = doc.createElement('span'); ring.className = 'pointer-orbit';
      host.append(canvas, ring); doc.body.appendChild(host);
      try { context = canvas.getContext('2d', { alpha: true }); } catch {}
      if (!context && config.style !== 'ring') { host.remove(); host = null; return false; }
      resize(); return true;
    }
    function show() {
      host.hidden = false;
      if (host.hasAttribute('popover') && !host.matches(':popover-open')) {
        try { host.showPopover(); } catch { host.removeAttribute('popover'); }
      }
    }
    function sprite(star) {
      const image = doc.createElement('canvas'); image.width = image.height = 48;
      const ctx = image.getContext('2d');
      const gradient = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
      gradient.addColorStop(0, config.color); gradient.addColorStop(.23, `${config.color}90`);
      gradient.addColorStop(1, `${config.color}00`);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 48, 48);
      ctx.fillStyle = config.color; ctx.beginPath();
      if (star) {
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4, radius = i % 2 ? 3.2 : 13;
          const px = 24 + Math.cos(angle) * radius, py = 24 + Math.sin(angle) * radius;
          if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      } else ctx.arc(24, 24, 6, 0, Math.PI * 2);
      ctx.closePath(); ctx.fill(); return image;
    }
    function prepare() {
      bufferWidth = bufferHeight = 0; canvas.width = canvas.height = 1;
      if (config.style !== 'ring' && context) sprites = [sprite(false), sprite(true)];
      ring.style.width = ring.style.height = `${config.size}px`;
      ring.hidden = config.style !== 'ring'; canvas.hidden = config.style === 'ring';
      host.style.setProperty('--pointer-effect-opacity', String(config.opacity));
      host.style.setProperty('--pointer-effect-color', config.color);
    }
    function schedule() {
      if (frame != null) return;
      if (!lastTime) lastTime = clock();
      frame = win.requestAnimationFrame(tick);
    }
    function recordFrame(elapsed, cost) {
      if (!compositionLite) {
        slowFrames = elapsed > 1 / 45 && elapsed < .2 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames >= 4) compositionLite = true;
      }
      if (compositionLite && root.dataset.pointerEnabled !== 'off') root.dataset.pointerComposition = 'lite';
      metrics.frames++; metrics.totalMs += cost; metrics.maxMs = Math.max(metrics.maxMs, cost);
    }
    function sync() {
      const style = root.dataset.pointerStyle || 'glow';
      const spec = Object.hasOwn(styles, style) ? styles[style] : null;
      const color = /^#[0-9a-f]{6}$/i.test(root.dataset.pointerColor || '') ? root.dataset.pointerColor : '#8b5cf6';
      const size = spec ? Math.max(spec[0], Math.min(spec[1], Number(root.dataset.pointerEffectSize) || spec[2])) : 320;
      const opacity = Math.max(.1, Math.min(1, Number(root.dataset.pointerOpacity) || 1));
      const next = [style, size, color, opacity, root.dataset.fxTier, root.dataset.theme].join('/');
      // 软件合成持续慢帧时只降低背景材质成本，轨迹和输入保持原有刷新率。
      // 会话内记住检测结果，避免暂停、换样式或打开弹窗时反复切换材质。
      if (root.dataset.pointerEnabled === 'off') delete root.dataset.pointerComposition;
      else if (compositionLite) root.dataset.pointerComposition = 'lite';
      if (!spec || !allowed()) { clear(); return; }
      if (signature !== next) {
        reset(); signature = next;
        config = { style, size, color, opacity, lite: root.dataset.fxTier === 'lite' };
        if (!mount()) return;
        prepare();
        if (present && cursor) { x.position = x.target = cursor.x; y.position = y.target = cursor.y; x.velocity = y.velocity = 0; }
      }
      if (host) resize();
      if (present) { show(); schedule(); }
    }
    function move(event) {
      if (event.pointerType === 'touch') { clear(); return; }
      const px = event.clientX, py = event.clientY;
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      if (!Object.hasOwn(styles, root.dataset.pointerStyle) || !allowed()) { clear(); return; }
      const now = clock();
      present = true;
      sync();
      if (!host || !config) return;
      const layer = event.target.closest?.('dialog[open], [popover]:popover-open') || null;
      if (layer !== topLayer) {
        topLayer = layer;
        if (host.matches?.(':popover-open')) { host.hidePopover(); show(); }
      }
      let coalesced;
      try { coalesced = event.getCoalescedEvents?.(); } catch {}
      const samples = coalesced?.length ? coalesced.slice(-6) : [event];
      for (const sample of samples) if (Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY)) {
        pending.push({ x: sample.clientX, y: sample.clientY, born: now });
      }
      if (samples[samples.length - 1] !== event) pending.push({ x: px, y: py, born: now });
      if (pending.length > 32) pending.splice(0, pending.length - 32);
      show(); schedule();
    }
    function emit(px, py, now, dx, dy) {
      const capacity = config.lite ? 36 : 96;
      const p = pool[slot++ % capacity];
      p.alive = true; p.x = px; p.y = py; p.born = now;
      p.life = 480 + random() * 360;
      p.vx = (random() - .5) * 100 + dx * .09;
      p.vy = (random() - .5) * 100 + dy * .09;
      p.size = config.size * (.55 + random() * .65);
      p.star = random() > .65; p.phase = random() * Math.PI;
    }
    function input(now) {
      const stride = Math.max(1, Math.ceil(pending.length / 12));
      let emitted = 0;
      for (let i = stride - 1; i < pending.length; i += stride) accept(pending[i]);
      if (pending.length && (pending.length - 1) % stride !== stride - 1) accept(pending[pending.length - 1]);
      pending.length = 0;
      function accept(point) {
        if (!cursor || point.born - cursor.born > 180) {
          cursor = { ...point }; x.position = x.target = point.x; y.position = y.target = point.y;
          x.velocity = y.velocity = 0; carry = 0;
          if (config.style === 'comet') trail.push(point);
          return;
        }
        const dx = point.x - cursor.x, dy = point.y - cursor.y;
        const distance = Math.hypot(dx, dy);
        if (distance < .2) return;
        if (config.style === 'comet') {
          trail.push(point);
          if (trail.length > 96) trail.shift();
        } else if (config.style === 'stars') {
          const spacing = Math.max(6, config.size * 1.3) * (config.lite ? 1.8 : 1);
          const count = Math.min(Math.floor((carry + distance) / spacing), 24 - emitted);
          for (let j = 0; j < count; j++) {
            const fraction = Math.min(1, (spacing - carry + j * spacing) / distance);
            emit(cursor.x + dx * fraction, cursor.y + dy * fraction, now, dx, dy);
          }
          emitted += count; carry = (carry + distance) % spacing;
        }
        cursor = { ...point }; x.target = point.x; y.target = point.y;
      }
    }
    function bounds(px, py, radius) {
      const left = Math.max(0, Math.floor(px - radius - 2)), top = Math.max(0, Math.floor(py - radius - 2));
      const right = Math.min(width, Math.ceil(px + radius + 2)), bottom = Math.min(height, Math.ceil(py + radius + 2));
      if (right <= left || bottom <= top) return;
      if (!dirty) dirty = { left, top, right, bottom };
      else { dirty.left = Math.min(dirty.left, left); dirty.top = Math.min(dirty.top, top); dirty.right = Math.max(dirty.right, right); dirty.bottom = Math.max(dirty.bottom, bottom); }
    }
    function drawComet(now) {
      while (trail.length && now - trail[0].born > 520) trail.shift();
      let length = 0;
      for (let i = trail.length - 1; i > 0; i--) {
        const newer = trail[i], older = trail[i-1];
        const distance = Math.hypot(newer.x - older.x, newer.y - older.y);
        if (length + distance > config.size) {
          const fraction = (config.size - length) / distance;
          trail[i-1] = { x: newer.x + (older.x - newer.x) * fraction,
            y: newer.y + (older.y - newer.y) * fraction, born: newer.born + (older.born - newer.born) * fraction };
          trail.splice(0, i - 1); break;
        }
        length += distance;
      }
      if (!trail.length) return false;
      const head = trail[trail.length - 1];
      const fade = Math.max(0, 1 - (now - head.born) / 520);
      const thickness = Math.max(1.4, Math.min(3.8, config.size / 90));
      // 连续样条一次填充为渐细带，消除逐段描边在接头处累积的亮点。
      let count = 0, arcLength = 0;
      const put = (px, py) => {
        if (count) arcLength += Math.hypot(px - curve[(count-1)*3], py - curve[(count-1)*3+1]);
        curve[count*3] = px; curve[count*3+1] = py; curve[count*3+2] = arcLength; count++;
        bounds(px, py, thickness * 4);
      };
      for (let i = 0; i < trail.length - 1; i++) {
        const a = trail[i-1] || trail[i], b = trail[i], c = trail[i+1], d = trail[i+2] || c;
        for (let j = 0; j < 4; j++) {
          const t = j / 4, t2 = t * t, t3 = t2 * t;
          put(.5 * (2*b.x + (-a.x+c.x)*t + (2*a.x-5*b.x+4*c.x-d.x)*t2 + (-a.x+3*b.x-3*c.x+d.x)*t3),
            .5 * (2*b.y + (-a.y+c.y)*t + (2*a.y-5*b.y+4*c.y-d.y)*t2 + (-a.y+3*b.y-3*c.y+d.y)*t3));
        }
      }
      put(head.x, head.y);
      bounds(head.x, head.y, 12);
      if (!placeCanvas()) return true;
      if (count > 1) {
        const gradient = context.createLinearGradient(curve[0], curve[1], head.x, head.y);
        gradient.addColorStop(0, `${config.color}00`); gradient.addColorStop(.45, `${config.color}90`); gradient.addColorStop(1, config.color);
        context.fillStyle = gradient;
        for (const halo of config.lite ? [false] : [true, false]) {
          context.globalAlpha = config.opacity * fade * (halo ? .13 : .9);
          context.beginPath();
          for (const side of [1, -1]) for (let n = 0; n < count; n++) {
            const i = side === 1 ? n : count - 1 - n;
            const previous = Math.max(0, i-1)*3, next = Math.min(count-1, i+1)*3;
            const dx = curve[next] - curve[previous], dy = curve[next+1] - curve[previous+1];
            const normal = Math.hypot(dx, dy) || 1;
            const halfWidth = Math.pow(curve[i*3+2] / (arcLength || 1), .8) * thickness * (halo ? 1.8 : .5);
            const px = curve[i*3] - dy / normal * halfWidth * side, py = curve[i*3+1] + dx / normal * halfWidth * side;
            if (!n && side === 1) context.moveTo(px, py); else context.lineTo(px, py);
          }
          context.closePath(); context.fill();
        }
      }
      context.globalAlpha = config.opacity * fade * .85;
      context.drawImage(sprites[0], head.x - 10, head.y - 10, 20, 20);
      context.globalAlpha = 1; return true;
    }
    function drawStars(now) {
      let live = false;
      for (const p of pool) {
        if (!p.alive) continue;
        const age = (now - p.born) / p.life;
        if (age >= 1) { p.alive = false; continue; }
        live = true;
        const seconds = (now - p.born) / 1000, drift = (1 - Math.exp(-seconds * 2.8)) / 2.8;
        p.drawX = p.x + p.vx * drift; p.drawY = p.y + p.vy * drift + seconds * seconds * 18;
        p.drawSize = p.size * (1 - age * .35) * (p.star ? 1.8 : 1.1);
        p.drawAlpha = config.opacity * Math.min(1, age * 12) * Math.pow(1 - age, 1.5) * (.82 + .18 * Math.sin(age * 5 + p.phase));
        bounds(p.drawX, p.drawY, p.drawSize + 1);
      }
      if (!placeCanvas()) return live;
      for (const p of pool) {
        if (!p.alive) continue;
        context.globalAlpha = p.drawAlpha;
        context.drawImage(sprites[p.star ? 1 : 0], p.drawX - p.drawSize, p.drawY - p.drawSize, p.drawSize * 2, p.drawSize * 2);
      }
      context.globalAlpha = 1; return live;
    }
    function drawRing(elapsed) {
      const settledX = advancePointerAxis(x, elapsed), settledY = advancePointerAxis(y, elapsed);
      const speed = Math.hypot(x.velocity, y.velocity), stretch = Math.min(.14, speed / 6500);
      if (speed > 40) {
        const targetAngle = Math.atan2(y.velocity, x.velocity) * 180 / Math.PI;
        const delta = ((targetAngle - orbitAngle + 540) % 360 + 360) % 360 - 180;
        orbitAngle += delta * (1 - Math.exp(-elapsed * 16));
      }
      const padding = Math.ceil(config.size * .08) + 8;
      host.style.width = host.style.height = `${config.size + padding * 2}px`;
      host.style.transform = `translate3d(${(x.position - config.size / 2 - padding).toFixed(2)}px, ${(y.position - config.size / 2 - padding).toFixed(2)}px, 0)`;
      host.style.willChange = settledX && settledY ? '' : 'transform';
      ring.style.transform = `translate3d(${padding}px, ${padding}px, 0) rotate(${orbitAngle.toFixed(2)}deg) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch).toFixed(3)})`;
      ring.style.opacity = String(config.opacity);
      ring.style.willChange = settledX && settledY ? '' : 'transform';
      return !settledX || !settledY;
    }
    function tick(now) {
      frame = null;
      if (!allowed() || !present || !host) { clear(); return; }
      const started = clock(), elapsed = Math.max(0, (now - lastTime) / 1000);
      lastTime = now; input(now); clearPixels();
      const live = config.style === 'ring' ? drawRing(elapsed)
        : config.style === 'comet' ? drawComet(now) : drawStars(now);
      const cost = Math.max(0, clock() - started);
      recordFrame(elapsed, cost);
      if (live || pending.length) schedule();
      else { lastTime = 0; if (config.style !== 'ring') hide(); }
    }
    return Object.freeze({ move, clear, sync, recordFrame,
      getSnapshot() { return { ...metrics, style: root.dataset.pointerStyle || 'glow', present,
        framePending: frame != null, points: trail.length, particles: pool.filter(p => p.alive).length,
        width, height, ratio, bufferWidth, bufferHeight, compositionLite, x: x.position, y: y.position, targetX: x.target, targetY: y.target }; },
      dispose() { if (disposed) return; clear(); disposed = true; delete root.dataset.pointerComposition; host?.remove(); host = null; sprites = null; }
    });
  }

  // 高频交互的装饰层；委托监听，不为每张卡片安装事件或常驻 RAF。
  function createInteractionMotion({ document: doc, window: win, motion } = {}) {
    if (!doc || !win || !motion || !win.MutationObserver) return Object.freeze({ dispose() {} });
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const forcedColors = win.matchMedia?.('(forced-colors: active)');
    const pointerEffects = createPointerEffects({ document: doc, window: win });
    const cleanups = [], groups = [], waves = new Map();
    const controlSelector = 'button:not(:disabled):not([aria-disabled="true"])';
    const hoverSelector = 'button, a, input, select, textarea, summary, label[for], .desktop-switch';
    const surfaceSelector = '.card, .common-links-card, .page-banner, .glass, .view, .app-stage, .release-entry, .src-row, .intel-card, .intel-story, .daily-paper, dialog, [popover]';
    const surfaces = new Map(), controls = new Map();
    const isUnavailable = element => element.disabled || (element.getAttribute('aria-disabled') === 'true' && !element.matches('.update-pill'));
    // 只在存在追光时监听节点移除，每次检查最多四个目标；不扫描内容树。
    const detached = new win.MutationObserver(() => {
      for (const records of [surfaces, controls]) for (const element of records.keys()) {
        if (!element.isConnected || isUnavailable(element)) removeLight(records, element);
      }
    });
    let disposed = false, surface = null, control = null, frame = null, lastTime = 0;
    const canMove = () => !disposed && !doc.hidden && !reduced?.matches
      && doc.documentElement.dataset.fxTier !== 'static'
      && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
    const full = () => canMove() && !forcedColors?.matches && doc.documentElement.dataset.fxTier === 'full'
      && doc.documentElement.dataset.pointerEnabled !== 'off';
    const glowEnabled = () => full() && (!doc.documentElement.dataset.pointerStyle || doc.documentElement.dataset.pointerStyle === 'glow');
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
    function removeLight(records, element) {
      const record = records.get(element);
      if (!record) return;
      win.clearTimeout(record.timeout);
      record.node.remove();
      record.follower?.style.removeProperty('translate');
      element.classList.remove(record.kind === 'surface' ? 'motion-surface' : 'motion-hover-host');
      if (record.positioned) element.classList.remove(record.kind === 'surface' ? 'motion-surface-positioned' : 'motion-hover-positioned');
      records.delete(element);
      if (surface === element) surface = null;
      if (control === element) control = null;
      if (!surfaces.size && !controls.size) detached.disconnect();
    }
    function clearGlow() {
      if (frame != null) win.cancelAnimationFrame(frame);
      frame = null; lastTime = 0;
      for (const element of surfaces.keys()) removeLight(surfaces, element);
      for (const element of controls.keys()) removeLight(controls, element);
      surface = null; control = null;
    }
    function schedule() {
      if (frame == null) {
        if (!lastTime) lastTime = win.performance?.now?.() || 0;
        frame = win.requestAnimationFrame(tick);
      }
    }
    function axis(position = 0) { return { position, target: position, velocity: 0 }; }
    function advance(value, elapsed, stiffness, damping) {
      // 解析解按真实墙钟前进：低帧率或长帧后仍稳定，不截断时间拖慢追光。
      return advancePointerAxis(value, elapsed, stiffness, damping);
    }
    function makeSpan(className, parent) {
      const node = doc.createElement('span'); node.className = className;
      node.setAttribute('aria-hidden', 'true'); parent.appendChild(node); return node;
    }
    function point(record) {
      const bounds = record.rect;
      const x = Math.max(0, Math.min(bounds.width, record.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, record.clientY - bounds.top));
      record.x.target = x; record.y.target = y;
      record.haloX.target = x; record.haloY.target = y;
      record.magnetX.target = (x / Math.max(1, bounds.width) - .5) * 6;
      record.magnetY.target = (y / Math.max(1, bounds.height) - .5) * 4;
    }
    function enter(records, element, event, kind) {
      let record = records.get(element);
      if (!record) {
        // 一个当前表面加一个淡出表面；再快的扫动也不积压节点或计时器。
        if (records.size >= 2) removeLight(records, records.keys().next().value);
        const node = makeSpan(kind === 'surface' ? 'surface-light' : 'control-aura', element);
        record = { kind, node, rect: element.getBoundingClientRect(), alpha: 0, targetAlpha: 1,
          x: axis(), y: axis(), haloX: axis(), haloY: axis(), magnetX: axis(), magnetY: axis(), timeout: null };
        // 固定浮层、粘性状态栏和返回顶部按钮保留各自定位；仅普通流元素需要装饰定位基准。
        record.positioned = win.getComputedStyle(element).position === 'static' || element.classList.contains('motion-control');
        if (record.positioned) element.classList.add(kind === 'surface' ? 'motion-surface-positioned' : 'motion-hover-positioned');
        record.follower = kind === 'surface' ? element.querySelector(':scope > .banner-art')
          : element.querySelector('.update-core') || element.querySelector('.tab-glyph') || element.querySelector(':scope > svg');
        if (kind === 'surface') {
          record.halo = makeSpan('surface-halo', node);
          record.glow = makeSpan('surface-glow', node);
          record.rim = makeSpan('surface-rim-light', makeSpan('surface-rim', node));
        } else {
          record.glow = makeSpan('control-aura-light', node);
        }
        records.set(element, record);
        detached.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
        element.classList.add(kind === 'surface' ? 'motion-surface' : 'motion-hover-host');
        record.clientX = event.clientX; record.clientY = event.clientY;
        point(record);
        for (const value of [record.x, record.y, record.haloX, record.haloY]) value.position = value.target;
      }
      win.clearTimeout(record.timeout); record.timeout = null;
      record.targetAlpha = 1; record.dirty = true;
      record.clientX = event.clientX; record.clientY = event.clientY;
      schedule();
    }
    function leave(records, element) {
      const record = records.get(element);
      if (!record || record.targetAlpha === 0) return;
      record.targetAlpha = 0; record.magnetX.target = 0; record.magnetY.target = 0;
      // RAF 被浏览器暂停时，淡出装饰仍有明确的资源寿命上限。
      record.timeout = win.setTimeout(() => {
        if (records.get(element) === record && record.targetAlpha === 0) removeLight(records, element);
      }, 240);
      schedule();
    }
    function tick(now) {
      frame = null;
      if (!glowEnabled()) { clearGlow(); return; }
      const started = win.performance?.now?.() || 0;
      const elapsed = lastTime ? Math.max(0, (now - lastTime) / 1000) : 1 / 60;
      const lightSize = Number(doc.documentElement.dataset.pointerSize) || 320;
      lastTime = now;
      let moving = false;
      // 每帧先完成当前两个命中区域的几何读取，再写装饰层；不扫描信息流。
      for (const records of [surfaces, controls]) for (const [element, record] of records) {
        if (!element.isConnected || isUnavailable(element)) {
          removeLight(records, element); continue;
        }
        if (record.dirty && record.targetAlpha) {
          record.rect = element.getBoundingClientRect(); point(record); record.dirty = false;
        }
      }
      for (const records of [surfaces, controls]) for (const [element, record] of records) {
        record.alpha += (record.targetAlpha - record.alpha) * (1 - Math.exp(-elapsed * (record.targetAlpha ? 24 : 32)));
        const fading = Math.abs(record.alpha - record.targetAlpha) > .005;
        if (!fading) record.alpha = record.targetAlpha;
        if (!record.targetAlpha && record.alpha === 0) { removeLight(records, element); continue; }
        const settled = [advance(record.x, elapsed, 1100, 56), advance(record.y, elapsed, 1100, 56),
          advance(record.haloX, elapsed, 360, 34), advance(record.haloY, elapsed, 360, 34),
          advance(record.magnetX, elapsed, 700, 38), advance(record.magnetY, elapsed, 700, 38)].every(Boolean);
        record.node.style.opacity = (record.alpha * (Number(doc.documentElement.dataset.pointerOpacity) || 1)).toFixed(3);
        if (record.follower) {
          const weight = record.kind === 'surface' ? 2.5 : .6;
          record.follower.style.translate = `${(record.magnetX.position * weight).toFixed(2)}px ${(record.magnetY.position * weight).toFixed(2)}px`;
        }
        if (record.kind === 'surface') {
          record.glow.style.transform = `translate(${record.x.position - lightSize / 2}px, ${record.y.position - lightSize / 2}px)`;
          record.halo.style.transform = `translate(${record.haloX.position - lightSize * .6875}px, ${record.haloY.position - lightSize * .6875}px)`;
          record.rim.style.transform = `translate(${record.x.position - lightSize * .59375}px, ${record.y.position - lightSize * .59375}px)`;
        } else {
          record.node.style.transform = `translate(${record.magnetX.position}px, ${record.magnetY.position}px)`;
          record.glow.style.transform = `translate(${record.x.position - lightSize / 4}px, ${record.y.position - lightSize / 4}px)`;
        }
        moving ||= fading || !settled;
      }
      pointerEffects.recordFrame(elapsed, Math.max(0, (win.performance?.now?.() || 0) - started));
      if (moving) schedule(); else lastTime = 0;
    }
    function onOver(event) {
      // 布局或弹层改变也会触发 pointerover；轨迹只由实际移动采样，避免静止时被重新唤醒。
      if (event.type === 'pointermove') pointerEffects.move(event);
      if (event.pointerType === 'touch') { clearGlow(); return; }
      if (!glowEnabled()) return;
      const nextSurface = event.target.closest?.(surfaceSelector) || null;
      const nextControl = event.target.closest?.(hoverSelector);
      const hoverControl = nextControl && !isUnavailable(nextControl) && nextControl.matches(hoverSelector) ? nextControl : null;
      if (nextSurface !== surface) { leave(surfaces, surface); surface = nextSurface; }
      if (hoverControl !== control) { leave(controls, control); control = hoverControl; }
      if (surface) enter(surfaces, surface, event, 'surface');
      if (control) enter(controls, control, event, 'control');
    }
    function onMove(event) { onOver(event); }
    function onOut(event) {
      if (!event.relatedTarget) pointerEffects.clear();
      if (surface && !surface.contains(event.relatedTarget)) { leave(surfaces, surface); surface = null; }
      if (control && !control.contains(event.relatedTarget)) { leave(controls, control); control = null; }
    }
    function syncGroup(record, immediate = false) {
      if (disposed || record.busy) return;
      const { group, indicator } = record;
      const selected = [...group.children].find(node => node.matches?.('button.active'));
      if (!selected) {
        motion.cancel(indicator);
        indicator.style.setProperty('--ti-o', '0');
        delete indicator.dataset.motionTarget;
        return;
      }
      if (!selected.offsetWidth || !selected.offsetHeight) return;
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
          || [...m.addedNodes, ...m.removedNodes].some(n => n !== indicator && n.nodeType === 1 && !n.matches?.('.press-wave, .control-aura, .control-aura-light')))) syncGroup(record);
      });
      observer.observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      cleanups.push(() => observer.disconnect());
    }
    function syncSizes() { for (const record of groups) syncGroup(record, true); }
    const resize = win.ResizeObserver ? new win.ResizeObserver(syncSizes) : null;
    groups.forEach(({ group }) => resize?.observe(group));
    doc.fonts?.ready?.then(() => { if (!disposed) syncSizes(); }).catch(() => {});
    function settleEnvironment() {
      pointerEffects.sync();
      if (!glowEnabled()) clearGlow();
      else if (surfaces.size || controls.size) schedule();
      if (!canMove()) { for (const button of waves.keys()) clearWave(button); }
      syncSizes();
    }
    const environment = new win.MutationObserver(settleEnvironment);
    environment.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-fx-tier', 'data-theme', 'data-pointer-enabled', 'data-pointer-style', 'data-pointer-size', 'data-pointer-effect-size', 'data-pointer-color', 'data-pointer-opacity', 'style'] });
    // 原生 details、dialog 和 popover 保留浏览器的键盘、焦点及关闭语义。
    listen(doc, 'click', event => {
      const summary = event.target.closest?.('details > summary');
      if (!summary || event.target.closest('a, button, input, select, textarea') || event.defaultPrevented) return;
      const details = summary.parentElement;
      if (!details.matches('.release-entry, .models-customized')) return;
      event.preventDefault();
      motion.layoutChange(details, () => { details.open = !details.open; }, details.querySelector('.release-body, .models-customized-body'));
    });
    for (const layer of doc.querySelectorAll('dialog, [popover]')) {
      if (layer.classList.contains('pointer-effects')) continue;
      listen(layer, 'toggle', event => {
        const isOpen = layer.open || layer.matches(':popover-open');
        if (!isOpen) { motion.cancelTree(layer); return; }
        if (event.newState !== 'open') return;
        motion.spring(layer, { from: { transform: 'translateY(-8px) scale(.97)', opacity: '0' },
          to: { transform: 'none', opacity: '1' }, duration: 240, restoreStyles: true });
        motion.revealText(layer.querySelectorAll('h3, .palette-group'));
      });
      listen(layer, 'close', () => { if (!layer.open) motion.cancelTree(layer); });
    }
    // 仅观察九个静态设置章节；未触发时内容始终可读，不将全量信息流挂观察器。
    const revealed = new WeakSet();
    const scrollReveal = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting && entry.target.getBoundingClientRect().height && !revealed.has(entry.target));
      visible.slice(0, STAGGER_LIMIT).forEach((entry, index) => {
        revealed.add(entry.target);
        motion.fadeSlideIn(entry.target, { distance: 10, duration: 300, delay: index * 35, restoreStyles: true });
      });
    }, { root: doc.getElementById('appViewport'), threshold: .08 }) : null;
    const chapters = doc.querySelectorAll('[data-settings-section]');
    chapters.forEach(chapter => scrollReveal?.observe(chapter));
    cleanups.push(() => {
      scrollReveal?.disconnect();
      chapters.forEach(chapter => motion.cancelTree(chapter));
      doc.querySelectorAll('dialog, [popover]').forEach(layer => motion.cancelTree(layer));
    });
    listen(doc, 'pointerdown', event => { if (event.button === 0) press(event.target.closest?.(controlSelector), event); }, { passive: true });
    listen(doc, 'keydown', event => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) press(event.target.closest?.(controlSelector), event);
    });
    listen(doc, 'pointerover', onOver, { passive: true });
    listen(doc, 'pointermove', onMove, { passive: true });
    listen(doc, 'pointerout', onOut, { passive: true });
    // 装饰顶层在原生 Escape 的关闭步骤之前退出，不抢占 dialog 的关闭语义。
    listen(doc, 'keydown', event => { if (event.key === 'Escape') pointerEffects.clear(); }, { capture: true });
    const clearPointer = () => { clearGlow(); pointerEffects.clear(); };
    listen(doc, 'scroll', clearPointer, { passive: true, capture: true });
    listen(doc, 'pointercancel', clearPointer, { passive: true });
    listen(doc, 'visibilitychange', settleEnvironment);
    listen(win, 'blur', settleEnvironment);
    listen(win, 'resize', () => { clearPointer(); pointerEffects.sync(); syncSizes(); }, { passive: true });
    listen(reduced, 'change', settleEnvironment);
    listen(forcedColors, 'change', settleEnvironment);
    return Object.freeze({
      getPointerSnapshot: pointerEffects.getSnapshot,
      dispose() {
        if (disposed) return;
        disposed = true;
        pointerEffects.dispose();
        clearGlow();
        detached.disconnect();
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
    createBrandLogo,
    createMotion,
    createPointerEffects,
    advancePointerAxis,
    createInteractionMotion
  });
});
