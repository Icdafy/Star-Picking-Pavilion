'use strict';

// 摘星阁 · 极光引擎（Aurora Engine）—— 流体设计的融合渲染层。
// 凝光视效（涟漪、彗星追光、下拉压暗）、流体动效（果冻滑动、方向入场）与
// 柔性反馈（按压收缩、拖拽拉伸、水滴融合）共用一个按需帧时钟、一组委托监听
// 和一份性能预算：没有交互时不占用任何帧，档位随刷新率、硬件、电量与实测
// 掉帧自动升降。所有效果都只写 transform 族与 opacity，失败时静默落回终态。
(function exposeAuroraEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.AuroraEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAuroraModule() {
  const FLUID_MODES = Object.freeze(['auto', 'full', 'lite', 'off']);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // 越拉越重的橡皮筋位移：位移趋近 dimension，手感与系统边界回弹一致。
  function rubberBand(offset, dimension = 320, constant = .55) {
    if (!offset || !(dimension > 0)) return 0;
    const distance = Math.abs(offset);
    return Math.sign(offset) * (1 - 1 / (distance * constant / dimension + 1)) * dimension;
  }

  // 半隐式欧拉 + 240Hz 子步：长帧后依旧稳定；返回是否已经静止。
  function stepSpring(axis, dt, stiffness, ratio, epsilon = .05) {
    const damping = 2 * ratio * Math.sqrt(stiffness);
    let remaining = clamp(dt, 0, .064);
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 240);
      axis.v += (-stiffness * (axis.p - axis.t) - damping * axis.v) * h;
      axis.p += axis.v * h;
      remaining -= h;
    }
    if (Math.abs(axis.p - axis.t) < epsilon && Math.abs(axis.v) < epsilon * 12) {
      axis.p = axis.t; axis.v = 0;
      return true;
    }
    return false;
  }

  // 档位：用户选择优先；自动档按硬件、省电与实测掉帧降到轻盈。
  function resolveFluidLevel({ mode = 'auto', reduced = false, fxTier = 'full', saver = false, strained = false } = {}) {
    if (reduced || mode === 'off' || fxTier === 'static') return 'off';
    if (mode === 'full') return 'full';
    if (mode === 'lite') return 'lite';
    return fxTier === 'lite' || saver || strained ? 'lite' : 'full';
  }

  // 两个圆之间的水滴连桥（metaball）。距离过远或完全包含时返回空串。
  function metaballPath(c1, r1, c2, r2, { v = .5, handle = 2.4 } = {}) {
    const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    if (!(r1 > 0) || !(r2 > 0) || d > r1 + r2 * 2.5 || d <= Math.abs(r1 - r2)) return '';
    const overlap = d < r1 + r2;
    const u1 = overlap ? Math.acos(clamp((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d), -1, 1)) : 0;
    const u2 = overlap ? Math.acos(clamp((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d), -1, 1)) : 0;
    const between = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const spread = Math.acos(clamp((r1 - r2) / d, -1, 1));
    const a1 = between + u1 + (spread - u1) * v;
    const a2 = between - u1 - (spread - u1) * v;
    const a3 = between + Math.PI - u2 - (Math.PI - u2 - spread) * v;
    const a4 = between - Math.PI + u2 + (Math.PI - u2 - spread) * v;
    const at = (center, angle, radius) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    const p1 = at(c1, a1, r1), p2 = at(c1, a2, r1), p3 = at(c2, a3, r2), p4 = at(c2, a4, r2);
    const reach = Math.min(v * handle, Math.hypot(p3.x - p1.x, p3.y - p1.y) / (r1 + r2)) * Math.min(1, d * 2 / (r1 + r2));
    const h1 = at(p1, a1 - Math.PI / 2, r1 * reach), h2 = at(p2, a2 + Math.PI / 2, r1 * reach);
    const h3 = at(p3, a3 + Math.PI / 2, r2 * reach), h4 = at(p4, a4 - Math.PI / 2, r2 * reach);
    const f = point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    return `M ${f(p1)} C ${f(h1)} ${f(h3)} ${f(p3)} A ${r2.toFixed(2)} ${r2.toFixed(2)} 0 ${d > r1 ? 1 : 0} 0 ${f(p4)} C ${f(h4)} ${f(h2)} ${f(p2)} Z`;
  }

  // 两个矩形边缘之间的最短距离；重叠时为负的重叠深度。
  function rectGap(a, b) {
    const dx = Math.max(b.left - a.right, a.left - b.right);
    const dy = Math.max(b.top - a.bottom, a.top - b.bottom);
    if (dx > 0 && dy > 0) return Math.hypot(dx, dy);
    return Math.max(dx, dy);
  }

  // 胶囊端头的近似圆：把对方中心夹进己方矩形内缩一个半径后的区域。
  function capsuleCircle(rect, toward) {
    const r = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const x = clamp(toward.x, rect.left + r, Math.max(rect.left + r, rect.right - r));
    const y = clamp(toward.y, rect.top + r, Math.max(rect.top + r, rect.bottom - r));
    return { c: { x, y }, r };
  }

  const SURFACE_SELECTOR = '.card, .glass, .common-links-card, .release-entry, .daily-item, .set-panel, .glass-dialog, .maintenance-action-card';
  const FIELD_SELECTOR = 'input, select, textarea, button, [contenteditable="true"], [role="switch"], [role="slider"], .switch-track, .lexicon-panel';
  const PRESS_SELECTOR = '.searchbox, button, select, summary, a.btn-ghost, a.btn-primary, label.btn-primary, label.btn-ghost, .settings-nav a';
  const DRAG_GROUPS = '.tower-actions, .domain-pills, .cat-chips, .nav-tabs, .intel-domains, .intel-tabs, .period-switch, .daily-actions, .export-group, .btn-row, .common-links-categories, .lexicon-scopes, .appearance-segments, .banner-aside, .card-foot, .src-actions, .pointer-palette, .daily-date-controls, .models-active-controls, .scale-options';
  const BRIDGE_HOST = '.glass, .glass-dialog, .set-panel, .page-banner, .common-links-card';
  const JELLY_SELECTOR = '.page-banner, .feed-banner, .feed-toolbar, .date-head, .tl-row, .hot-item, .daily-toolbar, .daily-head, .issue-lead, .daily-section, .intel-toolbar, .cap-kpi, .cap-card, .release-toolbar, .release-entry, .common-links-toolbar, .common-links-card, .src-toolbar, .src-card, .set-card, .feed-foot, .empty-state';
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

  function createAuroraEngine(deps = {}) {
    const doc = deps.document;
    const win = deps.window;
    const motion = deps.motion || null;
    // v0.2.39 节奏：时长 × tempo，弹簧刚度 ÷ tempo²（同一条运动曲线按时间轴整体放慢），阻尼略增，
    // 回弹更柔、更像真实的手与材料。单测不传 tempo 时保持 v0.2.38 的原始参数。
    const tempo = Number(deps.tempo) > 0 ? Math.min(3, Number(deps.tempo)) : 1;
    const soft = 1 / (tempo * tempo);
    const calm = tempo > 1 ? .12 : 0;
    const inert = Object.freeze({
      enterView() { return false; }, refresh() {}, dispose() {},
      getStatus() { return { level: 'off', mode: 'auto', reason: 'unsupported' }; }
    });
    if (!doc?.documentElement || !doc.body || typeof win?.requestAnimationFrame !== 'function') return inert;

    const root = doc.documentElement;
    const viewport = doc.getElementById('appViewport');
    const cleanups = [];
    let disposed = false;
    const now = () => win.performance?.now?.() ?? Date.now();
    const media = query => { try { return win.matchMedia?.(query) || null; } catch { return null; } };
    const reducedQuery = media('(prefers-reduced-motion: reduce)');
    const forcedQuery = media('(forced-colors: active)');
    const transparencyQuery = media('(prefers-reduced-transparency: reduce)');
    function listen(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }
    try {
      if (typeof deps.springEasing === 'function' && win.CSS?.supports?.('transition-timing-function', 'linear(0, 1)')) {
        root.style.setProperty('--fluid-spring', deps.springEasing({ bounce: tempo > 1 ? .22 : .32 }));
        root.style.setProperty('--fluid-spring-soft', deps.springEasing({ bounce: tempo > 1 ? .08 : .14 }));
      }
    } catch { /* 回落到样式表里的贝塞尔曲线 */ }

    // ---------- 融合帧时钟：所有流体任务合并到同一个 RAF ----------
    const tasks = new Map();
    let frameHandle = null;
    let lastFrame = 0;
    function loop(time) {
      frameHandle = null;
      const dt = lastFrame ? clamp((time - lastFrame) / 1000, 0, .1) : 1 / 60;
      lastFrame = time;
      const started = now();
      for (const [name, task] of [...tasks]) {
        let alive = false;
        try { alive = task(Math.min(dt, .064), time); } catch { alive = false; }
        if (!alive && tasks.get(name) === task) tasks.delete(name);
      }
      recordFrame(dt, now() - started);
      if (tasks.size && !disposed) frameHandle = win.requestAnimationFrame(loop);
      else lastFrame = 0;
    }
    function run(name, task) {
      if (disposed) return;
      tasks.set(name, task);
      if (frameHandle == null) frameHandle = win.requestAnimationFrame(loop);
    }

    // ---------- 调速器：刷新率、硬件、电量与实测掉帧 ----------
    const governor = { level: '', saver: false, strained: false, strainTimer: 0, drops: [], battery: null };
    const focused = () => !doc.hidden && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
    const mode = () => (FLUID_MODES.includes(root.dataset.fluidMode) ? root.dataset.fluidMode : 'auto');
    const allowed = () => !disposed && governor.level !== 'off' && focused() && !forcedQuery?.matches;
    const full = () => governor.level === 'full' && allowed();
    function recordFrame(dt, cost) {
      if (mode() !== 'auto' || governor.strained) return;
      const budget = 1 / (Number(root.dataset.refreshRate) || 60);
      governor.drops.push(dt > budget * 1.85 || cost > budget * 450 ? 1 : 0);
      if (governor.drops.length > 120) governor.drops.shift();
      if (governor.drops.length < 72) return;
      const ratio = governor.drops.reduce((sum, value) => sum + value, 0) / governor.drops.length;
      if (ratio <= .34) return;
      // 连续掉帧：自动档暂降轻盈 20 秒，再试探回到完整档。
      governor.strained = true;
      governor.drops.length = 0;
      win.clearTimeout(governor.strainTimer);
      governor.strainTimer = win.setTimeout(() => { governor.strained = false; syncLevel(); }, 20000);
      syncLevel();
    }
    function reason() {
      if (reducedQuery?.matches) return '系统开启了“减少动态效果”，界面保持静止';
      const hz = Number(root.dataset.refreshRate) || 60;
      const chosen = mode();
      if (chosen === 'off') return '已关闭流体动效，只保留即时的状态变化';
      if (chosen === 'full') return `始终完整：涟漪、果冻滑动与水滴融合全部开启 · ${hz}Hz`;
      if (chosen === 'lite') return '始终轻盈：保留按压回弹与单圈涟漪，关闭果冻滑动';
      if (governor.saver) return '自动适配：电量低且未充电，已切到轻盈档';
      if (governor.strained) return '自动适配：检测到连续掉帧，暂时切到轻盈档';
      if (root.dataset.fxTier === 'lite') return '自动适配：本机内存或处理器核心偏少，使用轻盈档';
      return `自动适配：当前为完整档 · ${hz}Hz${hz >= 90 ? ' 高刷' : ''}`;
    }
    function syncHint() {
      const hint = doc.getElementById('fluidModeHint');
      if (hint) hint.textContent = reason();
      for (const button of doc.querySelectorAll('[data-fluid-mode]')) {
        button.setAttribute('aria-pressed', String(button.dataset.fluidMode === mode()));
      }
    }
    function syncLevel() {
      if (disposed) return;
      const level = resolveFluidLevel({
        mode: mode(), reduced: Boolean(reducedQuery?.matches), fxTier: root.dataset.fxTier || 'full',
        saver: governor.saver, strained: governor.strained
      });
      if (level !== governor.level) {
        governor.level = level;
        root.dataset.fluid = level;
        if (level !== 'full') resetJelly();
        if (level === 'off') settleEverything();
      }
      root.dataset.fluidMaterial = transparencyQuery?.matches || forcedQuery?.matches ? 'solid' : 'glass';
      syncHint();
    }
    function syncFocus() { if (!allowed()) settleEverything(); }
    try {
      win.navigator?.getBattery?.().then(battery => {
        if (disposed || !battery) return;
        const sync = () => { governor.saver = !battery.charging && battery.level <= .2; syncLevel(); };
        battery.addEventListener?.('chargingchange', sync);
        battery.addEventListener?.('levelchange', sync);
        cleanups.push(() => {
          battery.removeEventListener?.('chargingchange', sync);
          battery.removeEventListener?.('levelchange', sync);
        });
        sync();
      }).catch(() => {});
    } catch { /* 电量接口只是自动档的参考 */ }

    // ---------- 凝光涟漪：点击处亮起，再一圈圈向外扩散 ----------
    const ripples = [];
    const rippleHosts = new Map();
    function dropRipple(record) {
      const index = ripples.indexOf(record);
      if (index >= 0) ripples.splice(index, 1);
      win.clearTimeout(record.timer);
      for (const animation of record.animations) { try { animation.cancel(); } catch {} }
      record.host.remove();
      const count = (rippleHosts.get(record.surface) || 1) - 1;
      if (count > 0) { rippleHosts.set(record.surface, count); return; }
      rippleHosts.delete(record.surface);
      record.surface.classList.remove('fluid-ripple-host', 'fluid-ripple-positioned');
    }
    function makeSpan(className, parent) {
      const node = doc.createElement('span');
      node.className = className;
      node.setAttribute('aria-hidden', 'true');
      parent.appendChild(node);
      return node;
    }
    function ripple(surface, clientX, clientY) {
      if (!allowed() || !surface?.isConnected) return;
      const rect = surface.getBoundingClientRect();
      if (rect.width < 32 || rect.height < 24) return;
      while (ripples.length >= (full() ? 3 : 2)) dropRipple(ripples[0]);
      const x = clamp(clientX - rect.left, 0, rect.width);
      const y = clamp(clientY - rect.top, 0, rect.height);
      const reach = Math.min(1400, Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)));
      const host = doc.createElement('span');
      host.className = 'fluid-ripple';
      host.setAttribute('aria-hidden', 'true');
      if (!rippleHosts.has(surface)) {
        surface.classList.add('fluid-ripple-host');
        if (win.getComputedStyle(surface).position === 'static') surface.classList.add('fluid-ripple-positioned');
      }
      rippleHosts.set(surface, (rippleHosts.get(surface) || 0) + 1);
      const record = { surface, host, animations: [], timer: 0 };
      const place = (node, size) => {
        node.style.width = node.style.height = `${size}px`;
        node.style.left = `${x - size / 2}px`;
        node.style.top = `${y - size / 2}px`;
      };
      const bloom = makeSpan('fluid-ripple-bloom', host);
      place(bloom, Math.min(reach, 260) * 2);
      const rings = full() ? 3 : 1;
      const ringNodes = Array.from({ length: rings }, () => {
        const ring = makeSpan('fluid-ripple-ring', host);
        place(ring, reach * 2);
        return ring;
      });
      surface.appendChild(host);
      ripples.push(record);
      try {
        record.animations.push(bloom.animate([
          { transform: 'scale(.12)', opacity: 0 },
          { transform: 'scale(.42)', opacity: 1, offset: .16 },
          { transform: 'scale(1)', opacity: 0 }
        ], { duration: 760 * tempo, easing: 'cubic-bezier(.2, .7, .2, 1)' }));
        ringNodes.forEach((ring, index) => {
          record.animations.push(ring.animate([
            { transform: 'scale(.02)', opacity: 0 },
            { transform: 'scale(.14)', opacity: .95 - index * .22, offset: .1 },
            { transform: 'scale(1)', opacity: 0 }
          ], { duration: (1150 + index * 120) * tempo, delay: index * 150 * tempo, easing: 'cubic-bezier(.12, .8, .3, 1)', fill: 'backwards' }));
        });
      } catch { dropRipple(record); return; }
      record.timer = win.setTimeout(() => dropRipple(record), (1600 + rings * 150) * tempo);
    }

    // ---------- 柔性反馈：按压收缩、拖拽拉伸、松手 Q 弹 ----------
    const bodies = new Map();
    const axis = (value = 0) => ({ p: value, v: 0, t: value });
    let gesture = null;
    function bodyOf(element) {
      let body = bodies.get(element);
      if (!body) {
        const selected = element.matches('.active, [aria-selected="true"], [aria-pressed="true"]');
        const mirror = selected ? element.parentElement?.querySelector(':scope > .selection-indicator, :scope > .tab-indicator') : null;
        body = { el: element, mirror, x: axis(), y: axis(), s: axis(1), kx: 900 * soft, zx: .7 + calm, ks: 900 * soft, zs: .7 + calm, pressed: false, attracted: false };
        bodies.set(element, body);
        element.classList.add('fluid-body');
      }
      return body;
    }
    function clearBody(body) {
      bodies.delete(body.el);
      body.el.style.removeProperty('translate');
      body.el.style.removeProperty('scale');
      body.mirror?.style.removeProperty('translate');
      body.el.style.removeProperty('opacity');
      body.el.classList.remove('fluid-body', 'fluid-droplet', 'fluid-lifted', 'fluid-lift-positioned');
    }
    function stepBodies(dt) {
      let alive = false;
      for (const body of [...bodies.values()]) {
        if (!body.el.isConnected) { clearBody(body); continue; }
        const settled = [stepSpring(body.x, dt, body.kx, body.zx, .08), stepSpring(body.y, dt, body.kx, body.zx, .08),
          stepSpring(body.s, dt, body.ks, body.zs, .0006)].every(Boolean);
        const dragging = gesture?.dragging && gesture.body === body;
        if (settled && !body.pressed && !dragging && !body.attracted && !body.x.t && !body.y.t && body.s.t === 1
          && (body.fadeNow || 0) < .01) {
          clearBody(body);
          continue;
        }
        alive = true;
        // 速度与位移共同决定沿运动方向的拉伸，垂直方向略收，近似体积守恒。
        const speed = Math.hypot(body.x.v, body.y.v);
        const offset = Math.hypot(body.x.p, body.y.p);
        const amount = clamp(speed / 3200, 0, .14) + clamp(offset / 560, 0, .08);
        const ux = speed > 30 ? body.x.v / speed : offset > .5 ? body.x.p / offset : 0;
        const uy = speed > 30 ? body.y.v / speed : offset > .5 ? body.y.p / offset : 0;
        const sx = 1 + amount * Math.abs(ux) - amount * .45 * Math.abs(uy);
        const sy = 1 + amount * Math.abs(uy) - amount * .45 * Math.abs(ux);
        body.fadeNow = (body.fadeNow || 0) + ((body.fade || 0) - (body.fadeNow || 0)) * (1 - Math.exp(-dt * 18));
        if (body.fadeNow > .01) body.el.style.opacity = (1 - body.fadeNow).toFixed(3);
        else body.el.style.removeProperty('opacity');
        body.el.style.translate = `${body.x.p.toFixed(2)}px ${body.y.p.toFixed(2)}px`;
        if (body.mirror) body.mirror.style.translate = body.el.style.translate;
        body.el.style.scale = `${(body.s.p * sx).toFixed(4)} ${(body.s.p * sy).toFixed(4)}`;
      }
      if (gesture?.dragging) { drawBridges(); alive = true; }
      return alive;
    }
    function pressDepth(rect) {
      return Math.min(.085, 9 / Math.max(24, Math.min(rect.width, rect.height * 3)));
    }
    function isDisabled(element) {
      return element.disabled || element.getAttribute('aria-disabled') === 'true' || element.closest?.('fieldset:disabled');
    }
    function press(element, clientX, clientY) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || rect.width * rect.height > 160000 || rect.height > 140) return null;
      const body = bodyOf(element);
      body.pressed = true;
      body.s.t = 1 - pressDepth(rect);
      body.ks = 1300 * soft; body.zs = .78 + calm;
      // 受力挤压：按在哪一侧，材质就朝那一侧轻轻让开（最多 1.5px），松手随回弹归位。
      if (tempo > 1 && Number.isFinite(clientX) && Number.isFinite(clientY)) {
        body.x.t = clamp((clientX - rect.left) / rect.width - .5, -.5, .5) * 3;
        body.y.t = clamp((clientY - rect.top) / rect.height - .5, -.5, .5) * 2;
      }
      run('soft', stepBodies);
      return body;
    }
    function release(body, velocityX = 0, velocityY = 0) {
      if (!body) return;
      const lite = governor.level !== 'full';
      body.pressed = false;
      body.s.t = 1;
      body.ks = 560 * soft; body.zs = (lite ? .55 : .3) + calm;
      body.x.t = 0; body.y.t = 0;
      const energy = clamp(Math.hypot(velocityX, velocityY) / 2400, 0, 1);
      body.kx = (260 + 360 * energy) * soft; body.zx = (lite ? .6 : .3 - .06 * energy) + calm;
      run('soft', stepBodies);
    }

    // 水滴连桥：只在拖拽时存在，画在所在面板的装饰层之下、按钮之下。
    function ensureBridgeLayer(element) {
      const host = element.closest(BRIDGE_HOST) || element.parentElement;
      if (!host) return null;
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'fluid-goo');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const paths = [0, 1].map(() => {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg.appendChild(path);
        return path;
      });
      const positioned = win.getComputedStyle(host).position === 'static';
      host.classList.add('fluid-goo-host');
      if (positioned) host.classList.add('fluid-goo-positioned');
      host.appendChild(svg);
      return { host, svg, paths, positioned };
    }
    function removeBridgeLayer(layer) {
      if (!layer) return;
      layer.svg.remove();
      layer.host.classList.remove('fluid-goo-host', 'fluid-goo-positioned');
    }
    function visualRect(rect, body) {
      const dx = body?.x.p || 0, dy = body?.y.p || 0;
      return { left: rect.left + dx, right: rect.right + dx, top: rect.top + dy, bottom: rect.bottom + dy,
        width: rect.width, height: rect.height, x: rect.left + dx + rect.width / 2, y: rect.top + dy + rect.height / 2 };
    }
    function drawBridges() {
      const g = gesture;
      if (!g?.dragging) return;
      const own = visualRect(g.rect, g.body);
      const range = 34;
      const near = [];
      for (const neighbor of g.neighbors) {
        const body = bodies.get(neighbor.el);
        const rect = visualRect(neighbor.rect, body);
        const gap = rectGap(own, neighbor.rect);
        if (gap < range) {
          // 靠近的邻居被轻轻吸过来；真正重叠时被挤压，像两滴水相触。
          const pull = 1 - clamp(gap / range, 0, 1);
          const nb = bodyOf(neighbor.el);
          const dx = own.x - (neighbor.rect.left + neighbor.rect.width / 2);
          const dy = own.y - (neighbor.rect.top + neighbor.rect.height / 2);
          const length = Math.hypot(dx, dy) || 1;
          nb.attracted = true;
          nb.kx = 640; nb.zx = .5; nb.ks = 640; nb.zs = .5;
          nb.x.t = dx / length * pull * 7;
          nb.y.t = dy / length * pull * 7;
          nb.s.t = gap < 0 ? 1 - clamp(-gap / 160, 0, .06) : 1;
          nb.fade = gap < 0 ? clamp(-gap / Math.max(24, Math.min(neighbor.rect.width, neighbor.rect.height) * 1.4), 0, .55) : 0;
          nb.el.classList.add('fluid-droplet');
          near.push({ gap, rect });
        } else if (body?.attracted) {
          body.attracted = false; body.x.t = 0; body.y.t = 0; body.s.t = 1; body.fade = 0;
          body.el.classList.remove('fluid-droplet');
        }
      }
      if (!g.layer) return;
      near.sort((a, b) => a.gap - b.gap);
      const base = g.layer.svg.getBoundingClientRect();
      g.layer.paths.forEach((path, index) => {
        const item = near[index];
        if (!item || item.gap > range - 2) { path.removeAttribute('d'); return; }
        const a = capsuleCircle(own, { x: item.rect.x, y: item.rect.y });
        const b = capsuleCircle(item.rect, a.c);
        const shift = c => ({ x: c.x - base.left, y: c.y - base.top });
        const d = metaballPath(shift(a.c), a.r * .96, shift(b.c), b.r * .96, { v: .5, handle: 2.4 });
        if (d) {
          path.setAttribute('d', d);
          path.style.opacity = (1 - clamp(item.gap / range, 0, 1)).toFixed(3);
        } else path.removeAttribute('d');
      });
    }
    function canDrag(element) {
      return element.matches('button') && Boolean(element.parentElement?.matches(DRAG_GROUPS));
    }
    function startDrag(g, event) {
      g.dragging = true;
      root.dataset.fluidDragging = '';
      try { win.getSelection?.()?.removeAllRanges?.(); } catch {}
      try { g.el.setPointerCapture?.(event.pointerId); } catch {}
      g.rect = g.el.getBoundingClientRect();
      g.neighbors = [...g.el.parentElement.children]
        .filter(node => node !== g.el && node.matches?.('button, .searchbox, a, select') && !node.hidden)
        .map(node => ({ el: node, rect: node.getBoundingClientRect() }))
        .filter(item => item.rect.width && item.rect.height)
        .map(item => ({ el: item.el, rect: visualRect(item.rect) }));
      g.layer = full() ? ensureBridgeLayer(g.el) : null;
      g.el.classList.add('fluid-droplet', 'fluid-lifted');
      if (win.getComputedStyle(g.el).position === 'static') g.el.classList.add('fluid-lift-positioned');
      g.body.kx = 1500 * Math.sqrt(soft); g.body.zx = .92;
      g.body.s.t = Math.max(g.body.s.t, .96);
    }
    function endGesture(event, cancelled = false) {
      const g = gesture;
      if (!g) return;
      gesture = null;
      if (g.dragging) {
        delete root.dataset.fluidDragging;
        try { g.el.releasePointerCapture?.(g.pointerId); } catch {}
        if (!cancelled) suppressClick();
        removeBridgeLayer(g.layer);
        for (const neighbor of g.neighbors) {
          const body = bodies.get(neighbor.el);
          if (body) { body.attracted = false; body.fade = 0; body.el.classList.remove('fluid-droplet'); release(body); }
        }
        g.el.classList.remove('fluid-droplet');
      }
      release(g.body, g.vx, g.vy);
    }
    function suppressClick() {
      const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      win.addEventListener('click', stop, { capture: true, once: true });
      win.setTimeout(() => win.removeEventListener('click', stop, { capture: true }), 360);
    }

    function onPointerDown(event) {
      if (event.button !== 0 || !allowed() || event.pointerType === 'touch' && !event.isPrimary) return;
      const target = event.target;
      if (!target?.closest) return;
      const control = target.closest(PRESS_SELECTOR);
      if (control && !isDisabled(control) && !control.closest('.fluid-scrim')) {
        if (gesture) endGesture(event, true);
        const body = press(control, event.clientX, event.clientY);
        if (body) {
          gesture = { el: control, body, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            lastX: event.clientX, lastY: event.clientY, lastT: now(), vx: 0, vy: 0, dragging: false, neighbors: [], layer: null };
        }
      }
      if (!target.closest(FIELD_SELECTOR)) {
        const surface = target.closest(SURFACE_SELECTOR);
        if (surface && !surface.matches('.command-rail, .tower, .filter-dock')) ripple(surface, event.clientX, event.clientY);
      }
      if (viewport && target === viewport) markScrollIntent();
    }
    function onPointerMove(event) {
      jelly.pointerY = event.clientY;
      jelly.pointerAt = now();
      const g = gesture;
      if (!g || event.pointerId !== g.pointerId) return;
      const t = now();
      const elapsed = Math.max(1, t - g.lastT) / 1000;
      g.vx = g.vx * .6 + (event.clientX - g.lastX) / elapsed * .4;
      g.vy = g.vy * .6 + (event.clientY - g.lastY) / elapsed * .4;
      g.lastX = event.clientX; g.lastY = event.clientY; g.lastT = t;
      const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
      if (!g.dragging) {
        if (Math.hypot(dx, dy) < 8 || !canDrag(g.el) || !allowed()) return;
        startDrag(g, event);
      }
      const reach = governor.level === 'full' ? 300 : 120;
      g.body.x.t = rubberBand(dx, reach, .62);
      g.body.y.t = rubberBand(dy, reach, .62);
      run('soft', stepBodies);
    }

    // ---------- 流体滑动：果冻跟随、速度决定幅度、边界橡皮筋 ----------
    const jelly = { items: [], states: new WeakMap(), collectedAt: 0, lastTop: viewport?.scrollTop || 0, pending: 0,
      speed: 0, intentUntil: 0, pointerY: null, pointerAt: 0, edge: axis(0), edgePull: 0, edgeAt: 0, edgeSide: 0 };
    function markScrollIntent(span = 420) { jelly.intentUntil = now() + span; }
    function collectJelly() {
      jelly.collectedAt = now();
      const view = viewport?.querySelector('main .view:not([hidden])');
      if (!view) { jelly.items = []; return; }
      const bounds = viewport.getBoundingClientRect();
      const next = [];
      let below = 0;
      for (const element of view.querySelectorAll(JELLY_SELECTOR)) {
        const parent = element.parentElement?.closest(JELLY_SELECTOR);
        if (parent && view.contains(parent)) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.height || rect.bottom < bounds.top - 60) continue;
        if (rect.top > bounds.bottom + 60) { if (++below > 3) break; continue; }
        let state = jelly.states.get(element);
        if (!state) { state = axis(0); jelly.states.set(element, state); }
        state.center = (rect.top + Math.min(rect.bottom, bounds.bottom) ) / 2 - bounds.top;
        next.push({ el: element, o: state });
        if (next.length >= 28) break;
      }
      for (const item of jelly.items) {
        if (!next.some(candidate => candidate.el === item.el)) {
          item.o.p = 0; item.o.v = 0;
          item.el.style.removeProperty('translate');
          item.el.classList.remove('fluid-jelly');
        }
      }
      for (const item of next) item.el.classList.add('fluid-jelly');
      jelly.items = next;
    }
    function resetJelly() {
      for (const item of jelly.items) {
        item.o.p = 0; item.o.v = 0;
        item.el.style.removeProperty('translate');
        item.el.classList.remove('fluid-jelly');
      }
      jelly.items = [];
      jelly.pending = 0; jelly.edgePull = 0; jelly.edge.p = jelly.edge.t = jelly.edge.v = 0;
      tasks.delete('jelly');
    }
    function stepJelly(dt) {
      if (!full() || !viewport) { resetJelly(); return false; }
      const t = now();
      if (t - jelly.collectedAt > 140 || !jelly.items.length) collectJelly();
      const delta = jelly.pending;
      jelly.pending = 0;
      const instant = Math.abs(delta) / Math.max(dt, 1 / 240);
      jelly.speed = jelly.speed * .72 + instant * .28;
      // 快速滑动：幅度更大、回弹更快；慢慢滑：动画放缓、回弹更轻。
      const energy = clamp(jelly.speed / 3400, 0, 1);
      const gain = .035 + .095 * energy;
      const stiffness = (150 + 420 * energy) * soft;
      const ratio = .52 - .14 * energy + calm * .5;
      const span = Math.max(1, viewport.clientHeight);
      const origin = jelly.pointerY != null && t - jelly.pointerAt < 4000
        ? clamp(jelly.pointerY - viewport.getBoundingClientRect().top, 0, span) : span / 2;
      if (jelly.edgePull && t - jelly.edgeAt > 150) jelly.edgePull = 0;
      jelly.edge.t = rubberBand(jelly.edgePull, Math.min(110, span * .1), .55);
      const edgeSettled = stepSpring(jelly.edge, dt, 300 * soft, .42 + calm * .5, .1);
      const limit = 18 + 22 * energy;
      let alive = !edgeSettled || Boolean(jelly.edgePull);
      for (const item of jelly.items) {
        const distance = clamp(Math.abs(item.o.center - origin) / span, 0, 1);
        if (delta) item.o.p = clamp(item.o.p + delta * gain * (.15 + distance * 1.1), -limit, limit);
        const settled = stepSpring(item.o, dt, stiffness, ratio, .06);
        const fromEdge = jelly.edgeSide > 0 ? 1 - item.o.center / span : jelly.edgeSide < 0 ? item.o.center / span : 0;
        const edgeOffset = jelly.edge.p * clamp(.45 + fromEdge * .7, .3, 1.1);
        const value = item.o.p + edgeOffset;
        if (Math.abs(value) < .05) item.el.style.removeProperty('translate');
        else item.el.style.translate = `0 ${value.toFixed(2)}px`;
        alive ||= !settled;
      }
      if (!alive && !jelly.pending) {
        for (const item of jelly.items) { item.el.style.removeProperty('translate'); item.el.classList.remove('fluid-jelly'); }
        jelly.items = [];
        return false;
      }
      return true;
    }
    function onScroll() {
      const top = viewport.scrollTop;
      scrim.style.translate = `0 ${top}px`;
      const delta = top - jelly.lastTop;
      jelly.lastTop = top;
      if (!delta || !full() || now() > jelly.intentUntil) return;
      jelly.pending += delta;
      run('jelly', stepJelly);
    }
    function onWheel(event) {
      if (event.ctrlKey || !full()) return;
      markScrollIntent();
      const max = viewport.scrollHeight - viewport.clientHeight;
      const top = viewport.scrollTop;
      const delta = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaMode === 2 ? event.deltaY * viewport.clientHeight : event.deltaY;
      const atTop = top <= 0 && delta < 0;
      const atBottom = top >= max - 1 && delta > 0;
      if (!atTop && !atBottom) return;
      // 已到边界仍继续滑：内容被拉开再弹回，靠近边缘的一侧位移更大。
      if (event.target?.closest?.('.nav-tabs, .lexicon-panel, dialog, [popover], textarea, select')) return;
      jelly.edgeSide = atTop ? 1 : -1;
      jelly.edgePull = clamp(jelly.edgePull - delta * .35, -260, 260);
      jelly.edgeAt = now();
      run('jelly', stepJelly);
    }
    function onKeyDown(event) {
      if (SCROLL_KEYS.has(event.key) && !event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) markScrollIntent(700);
      if (event.key === 'Escape' && gesture) endGesture(event, true);
    }

    // ---------- 彗星追光：滑杆进度上的指引光，拖动时光随指弥散 ----------
    const comets = new Map();
    let registered = false;
    try {
      win.CSS?.registerProperty?.({ name: '--fluid-comet', syntax: '<number>', inherits: true, initialValue: '1' });
      win.CSS?.registerProperty?.({ name: '--fluid-glint', syntax: '<number>', inherits: true, initialValue: '0' });
      registered = true;
    } catch { registered = Boolean(win.CSS?.supports?.('--fluid-comet: 1')); }
    function syncRange(input) {
      const min = Number(input.min || 0);
      const max = input.max === '' ? 100 : Number(input.max);
      const value = Number(input.value);
      const progress = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
      input.style.setProperty('--fluid-p', progress.toFixed(4));
    }
    function syncRanges(scope = doc) {
      for (const input of scope.querySelectorAll?.('input[type="range"]') || []) syncRange(input);
    }
    function stopComet(input) {
      const animation = comets.get(input);
      if (!animation) return;
      comets.delete(input);
      try { animation.cancel(); } catch {}
    }
    function comet(input, loop) {
      if (!registered || !allowed() || typeof input.animate !== 'function') return;
      const current = comets.get(input);
      if (current && (current.effect?.getTiming?.().iterations === Infinity) === loop) return;
      stopComet(input);
      try {
        const animation = input.animate([
          { '--fluid-comet': 0, '--fluid-glint': 0 },
          { '--fluid-glint': 1, offset: .18 },
          { '--fluid-glint': 1, offset: .78 },
          { '--fluid-comet': 1.12, '--fluid-glint': 0 }
        ], { duration: (governor.level === 'full' ? 1500 : 1100) * tempo, iterations: loop && full() ? Infinity : 1,
          easing: 'cubic-bezier(.45, 0, .2, 1)' });
        comets.set(input, animation);
        animation.finished.then(() => { if (comets.get(input) === animation) comets.delete(input); }).catch(() => {});
      } catch { /* 追光只是指引层 */ }
    }
    function lockComet(input, locked) {
      stopComet(input);
      if (locked && allowed()) {
        input.style.setProperty('--fluid-comet', '1');
        input.style.setProperty('--fluid-glint', '1');
        input.classList.add('fluid-range-active');
      } else {
        input.style.removeProperty('--fluid-comet');
        input.style.removeProperty('--fluid-glint');
        input.classList.remove('fluid-range-active');
      }
    }
    let lockedRange = null;
    function onRangeEvent(event) {
      const input = event.target;
      if (!(input?.matches?.('input[type="range"]'))) return;
      syncRange(input);
      if (event.type === 'pointerdown') { lockedRange = input; lockComet(input, true); }
      else if (event.type === 'pointerover' || event.type === 'focusin') { if (lockedRange !== input) comet(input, true); }
      else if (event.type === 'pointerout' || event.type === 'focusout') {
        if (lockedRange !== input && doc.activeElement !== input) stopComet(input);
      } else if (event.type === 'change' && lockedRange !== input) comet(input, false);
    }
    function onRangeRelease() {
      if (!lockedRange) return;
      const input = lockedRange;
      lockedRange = null;
      lockComet(input, false);
      comet(input, false);
    }

    // ---------- 下拉压暗：先把背景压暗，再让选项出现 ----------
    const scrim = doc.createElement('div');
    scrim.className = 'fluid-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    (viewport || doc.body).prepend(scrim);
    const lexicon = doc.getElementById('lexiconPanel');
    function syncScrim() {
      const menus = [...doc.querySelectorAll('[popover].report-export-menu, [popover][data-fluid-menu]')];
      const menuOpen = menus.some(node => { try { return node.matches(':popover-open'); } catch { return false; } });
      const lexiconOpen = Boolean(lexicon && !lexicon.hidden);
      const layer = menuOpen ? 'top' : lexiconOpen ? 'lexicon' : '';
      if (layer && governor.level !== 'off') root.dataset.fluidScrim = layer;
      else delete root.dataset.fluidScrim;
    }
    for (const menu of doc.querySelectorAll('[popover].report-export-menu, [popover][data-fluid-menu]')) listen(menu, 'toggle', syncScrim);
    const lexiconObserver = lexicon && win.MutationObserver ? new win.MutationObserver(syncScrim) : null;
    lexiconObserver?.observe(lexicon, { attributes: true, attributeFilter: ['hidden'] });

    // ---------- 方向入场：从哪边切过来，内容就从哪边先到 ----------
    function enterView(panel, direction = 1) {
      if (!panel || !allowed() || typeof motion?.spring !== 'function') return false;
      const lite = governor.level !== 'full';
      const distance = (lite ? 10 : 24) * (direction < 0 ? -1 : 1);
      try {
        // 流体融合入场：从切换方向浮上来，同时由略小舒展到原尺寸。整页失焦滤镜实测让切换期
        // p95 帧耗时从约 7ms 升到约 21ms，因此只用合成层友好的位移、缩放与透明度。
        const fuse = tempo > 1 && !lite;
        motion.spring(panel, {
          from: { transform: `translateY(${distance}px)${fuse ? ' scale(.985)' : ''}`, opacity: '0' },
          to: { transform: 'none', opacity: '1' },
          duration: lite ? 260 : 560, bounce: lite ? .06 : tempo > 1 ? .14 : .26, restoreStyles: true
        });
        return true;
      } catch { return false; }
    }

    // ---------- 凝光：指针靠近的那一段轮廓被点亮，光随手势在边缘上流动 ----------
    const GAZE_SELECTOR = '.glass, .card, .set-panel, .release-entry, .common-links-card';
    const gazes = new Map();
    let gazeTarget = null, gazeX = 0, gazeY = 0;
    // 开启“跟手动效 · 追光”时由原有追光负责表面的光，凝光轮廓不再叠加，也不在同一帧改写表面的样式变量。
    const pointerGlow = () => root.dataset.pointerEnabled === 'on' && root.dataset.fxTier === 'full'
      && (!root.dataset.pointerStyle || root.dataset.pointerStyle === 'glow');
    const gazeAllowed = () => full() && tempo > 1 && !pointerGlow();
    function clearGaze(element) {
      gazes.delete(element);
      for (const name of ['--gaze-x', '--gaze-y', '--gaze-o']) element.style.removeProperty(name);
    }
    function stepGaze(dt) {
      if (!gazeAllowed()) { for (const element of [...gazes.keys()]) clearGaze(element); return false; }
      let alive = false;
      for (const [element, record] of [...gazes]) {
        if (!element.isConnected) { clearGaze(element); continue; }
        const target = element === gazeTarget && !element.classList.contains('motion-surface') ? 1 : 0;
        if (target) {
          const rect = element.getBoundingClientRect();
          const px = gazeX - rect.left, py = gazeY - rect.top;
          if (!record.seen) { record.x = px; record.y = py; record.seen = true; }
          const follow = 1 - Math.exp(-dt * 16 / tempo);
          record.x += (px - record.x) * follow;
          record.y += (py - record.y) * follow;
        }
        record.o += (target - record.o) * (1 - Math.exp(-dt * (target ? 7 : 4) / tempo));
        if (!target && record.o < .01) { clearGaze(element); continue; }
        element.style.setProperty('--gaze-x', `${record.x.toFixed(1)}px`);
        element.style.setProperty('--gaze-y', `${record.y.toFixed(1)}px`);
        element.style.setProperty('--gaze-o', record.o.toFixed(3));
        alive = true;
      }
      return alive;
    }
    function onGazeMove(event) {
      if (!gazeAllowed() || event.pointerType === 'touch' || gesture?.dragging) return;
      const surface = event.target?.closest?.(GAZE_SELECTOR);
      gazeX = event.clientX; gazeY = event.clientY;
      gazeTarget = surface && !surface.closest('.fluid-cloud') ? surface : null;
      if (gazeTarget && !gazes.has(gazeTarget)) gazes.set(gazeTarget, { x: 0, y: 0, o: 0, seen: false });
      if (gazes.size) run('gaze', stepGaze);
    }
    listen(doc, 'pointermove', onGazeMove, { passive: true });
    listen(doc.documentElement, 'pointerleave', () => { gazeTarget = null; if (gazes.size) run('gaze', stepGaze); }, { passive: true });

    function settleEverything() {
      endGesture(null, true);
      gazeTarget = null;
      for (const element of [...gazes.keys()]) clearGaze(element);
      for (const body of [...bodies.values()]) clearBody(body);
      for (const record of [...ripples]) dropRipple(record);
      for (const input of [...comets.keys()]) stopComet(input);
      if (lockedRange) lockComet(lockedRange, false);
      lockedRange = null;
      resetJelly();
      tasks.clear();
    }

    listen(doc, 'pointerdown', onPointerDown, { capture: true, passive: true });
    listen(doc, 'pointermove', onPointerMove, { passive: true });
    listen(doc, 'pointerup', event => { if (gesture && event.pointerId === gesture.pointerId) endGesture(event); onRangeRelease(); }, { passive: true });
    listen(doc, 'pointercancel', event => { if (gesture && event.pointerId === gesture.pointerId) endGesture(event, true); onRangeRelease(); }, { passive: true });
    for (const type of ['pointerdown', 'pointerover', 'pointerout', 'focusin', 'focusout', 'input', 'change']) {
      listen(doc, type, onRangeEvent, { passive: true });
    }
    listen(doc, 'keydown', onKeyDown, { capture: true });
    listen(doc, 'visibilitychange', syncFocus);
    listen(win, 'blur', syncFocus);
    if (viewport) {
      listen(viewport, 'scroll', onScroll, { passive: true });
      listen(viewport, 'wheel', onWheel, { passive: true });
    }
    for (const query of [reducedQuery, forcedQuery, transparencyQuery]) listen(query, 'change', syncLevel);
    const rootObserver = win.MutationObserver ? new win.MutationObserver(syncLevel) : null;
    rootObserver?.observe(root, { attributes: true, attributeFilter: ['data-fx-tier', 'data-fluid-mode', 'data-refresh-rate'] });
    syncLevel();
    syncRanges();

    return Object.freeze({
      enterView,
      refresh(scope) { syncRanges(scope || doc); syncScrim(); syncHint(); },
      getStatus() {
        return { level: governor.level, mode: mode(), reason: reason(), saver: governor.saver, strained: governor.strained,
          tasks: [...tasks.keys()], bodies: bodies.size, ripples: ripples.length, jelly: jelly.items.length };
      },
      dispose() {
        if (disposed) return;
        settleEverything();
        disposed = true;
        if (frameHandle != null) win.cancelAnimationFrame?.(frameHandle);
        frameHandle = null;
        win.clearTimeout(governor.strainTimer);
        rootObserver?.disconnect();
        lexiconObserver?.disconnect();
        scrim.remove();
        cleanups.splice(0).forEach(cleanup => cleanup());
        delete root.dataset.fluid;
        delete root.dataset.fluidScrim;
      }
    });
  }

  return Object.freeze({
    FLUID_MODES,
    rubberBand,
    stepSpring,
    resolveFluidLevel,
    metaballPath,
    rectGap,
    capsuleCircle,
    createAuroraEngine
  });
});
