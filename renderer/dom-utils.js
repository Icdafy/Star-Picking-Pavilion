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

  // 高频交互的装饰层；委托监听，不为每张卡片安装事件或常驻 RAF。
  function createInteractionMotion({ document: doc, window: win, motion } = {}) {
    if (!doc || !win || !motion || !win.MutationObserver) return Object.freeze({ dispose() {} });
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const forcedColors = win.matchMedia?.('(forced-colors: active)');
    const cleanups = [], groups = [], waves = new Map();
    const controlSelector = 'button:not(:disabled):not([aria-disabled="true"])';
    const hoverSelector = '.tab, .pill, .chip, .icon-btn, .btn-icon, .btn-primary, .btn-ghost, .rt-toggle, .card-act, .common-links-category, .update-pill';
    const surfaceSelector = '.card, .common-links-card, .page-banner';
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
    const full = () => canMove() && !forcedColors?.matches && doc.documentElement.dataset.fxTier === 'full';
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
        record.follower = kind === 'surface' ? element.querySelector('.banner-art')
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
      if (!full()) { clearGlow(); return; }
      const elapsed = lastTime ? Math.max(0, (now - lastTime) / 1000) : 1 / 60;
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
        record.node.style.opacity = record.alpha.toFixed(3);
        if (record.follower) {
          const weight = record.kind === 'surface' ? 2.5 : .6;
          record.follower.style.translate = `${(record.magnetX.position * weight).toFixed(2)}px ${(record.magnetY.position * weight).toFixed(2)}px`;
        }
        if (record.kind === 'surface') {
          record.glow.style.transform = `translate(${record.x.position - 160}px, ${record.y.position - 160}px)`;
          record.halo.style.transform = `translate(${record.haloX.position - 220}px, ${record.haloY.position - 220}px)`;
          record.rim.style.transform = `translate(${record.x.position - 190}px, ${record.y.position - 190}px)`;
        } else {
          record.node.style.transform = `translate(${record.magnetX.position}px, ${record.magnetY.position}px)`;
          record.glow.style.transform = `translate(${record.x.position - 80}px, ${record.y.position - 80}px)`;
        }
        moving ||= fading || !settled;
      }
      if (moving) schedule(); else lastTime = 0;
    }
    function onOver(event) {
      if (event.pointerType === 'touch') { clearGlow(); return; }
      if (!full()) return;
      const nextSurface = event.target.closest?.(surfaceSelector) || null;
      const nextControl = event.target.closest?.('button:not(:disabled)');
      const hoverControl = nextControl && !isUnavailable(nextControl) && nextControl.matches(hoverSelector) ? nextControl : null;
      if (nextSurface !== surface) { leave(surfaces, surface); surface = nextSurface; }
      if (hoverControl !== control) { leave(controls, control); control = hoverControl; }
      if (surface) enter(surfaces, surface, event, 'surface');
      if (control) enter(controls, control, event, 'control');
    }
    function onMove(event) { onOver(event); }
    function onOut(event) {
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
      if (!full()) clearGlow();
      if (!canMove()) { for (const button of waves.keys()) clearWave(button); }
      syncSizes();
    }
    const environment = new win.MutationObserver(settleEnvironment);
    environment.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-fx-tier'] });
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
    listen(doc, 'scroll', clearGlow, { passive: true, capture: true });
    listen(doc, 'pointercancel', clearGlow, { passive: true });
    listen(doc, 'visibilitychange', settleEnvironment);
    listen(win, 'blur', settleEnvironment);
    listen(win, 'resize', () => { clearGlow(); syncSizes(); }, { passive: true });
    listen(reduced, 'change', settleEnvironment);
    listen(forcedColors, 'change', settleEnvironment);
    return Object.freeze({
      dispose() {
        if (disposed) return;
        disposed = true;
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
    createMotion,
    createInteractionMotion
  });
});
