'use strict';

/* 摘星阁 · Aqua 外观控制器
   单一 UMD 模块承接外观状态、设置控件、原创 Canvas 流体星云、按钮涟漪、
   原创星鲸粒子和本地壁纸。算法未复制参考插件的官网 shader、品牌鱼路径或
   Harness 徽标；它只复用“可调玻璃 + 动态背景 + 低功耗降级”的产品思想。 */

(function exposeAquaShell(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  if (!root) return;
  root.AquaShell = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAquaShellModule() {
  const WALLPAPER_KEY = 'star-picking-pavilion.aqua-wallpaper.v1';
  const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024;
  const MAX_WALLPAPER_EDGE = 1920;
  const PERSIST_DELAY = 220;
  const DEFAULTS = Object.freeze({
    aquaMode: 'mica',
    aquaBlur: 2,
    aquaFrost: 20,
    aquaHue: 316,
    aquaBrightness: 50,
    aquaBackground: 'fluid',
    aquaWallpaperBlur: 0,
    aquaWallpaperFrost: 0,
    aquaWhale: true,
    aquaCritters: true
  });
  const FIELDS = Object.freeze(Object.keys(DEFAULTS));
  const FLUID_PALETTES = Object.freeze({
    light: Object.freeze([
      Object.freeze({ id: 'clear-sky', name: '晴空蓝', hue: 316, brightness: 50, swatch: 'linear-gradient(125deg, #bdeaff, #8aa9ff 52%, #f3c8ff)' }),
      Object.freeze({ id: 'rain-jade', name: '雨后青', hue: 132, brightness: 62, swatch: 'linear-gradient(125deg, #c9fff0, #72d6c1 52%, #bde8ff)' }),
      Object.freeze({ id: 'dawn-violet', name: '晨曦紫', hue: 260, brightness: 60, swatch: 'linear-gradient(125deg, #edd7ff, #b79aff 52%, #ffd1e5)' }),
      Object.freeze({ id: 'coral-haze', name: '珊瑚霞', hue: 12, brightness: 64, swatch: 'linear-gradient(125deg, #ffe0d0, #ff9e9d 52%, #f7c6ec)' }),
      Object.freeze({ id: 'sunlit-gold', name: '日光金', hue: 48, brightness: 66, swatch: 'linear-gradient(125deg, #fff2bd, #f4c66f 52%, #ffd9b8)' }),
      Object.freeze({ id: 'glacier-blue', name: '冰川蓝', hue: 198, brightness: 60, swatch: 'linear-gradient(125deg, #d8f7ff, #79cdeb 52%, #b9d7ff)' })
    ]),
    dark: Object.freeze([
      Object.freeze({ id: 'star-ocean', name: '星海蓝', hue: 316, brightness: 50, swatch: 'linear-gradient(125deg, #14385f, #3158a2 52%, #503a85)' }),
      Object.freeze({ id: 'ink-jade', name: '墨玉青', hue: 126, brightness: 40, swatch: 'linear-gradient(125deg, #071d1b, #0d5549 52%, #173c50)' }),
      Object.freeze({ id: 'deep-violet', name: '深空紫', hue: 260, brightness: 38, swatch: 'linear-gradient(125deg, #140d2d, #38226f 52%, #511f58)' }),
      Object.freeze({ id: 'ember-red', name: '熔星红', hue: 12, brightness: 40, swatch: 'linear-gradient(125deg, #281015, #6b2029 52%, #51223f)' }),
      Object.freeze({ id: 'amber-night', name: '琥珀夜', hue: 48, brightness: 42, swatch: 'linear-gradient(125deg, #241b08, #67501b 52%, #4b2f20)' }),
      Object.freeze({ id: 'polar-night', name: '极夜冰蓝', hue: 198, brightness: 44, swatch: 'linear-gradient(125deg, #071723, #174b68 52%, #203a6b)' })
    ])
  });

  function clampNumber(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function normalizeSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      aquaMode: value.aquaMode === 'compat' ? 'compat' : 'mica',
      aquaBlur: clampNumber(value.aquaBlur, 0, 40, DEFAULTS.aquaBlur),
      aquaFrost: clampNumber(value.aquaFrost, 0, 100, DEFAULTS.aquaFrost),
      aquaHue: clampNumber(value.aquaHue, 0, 360, DEFAULTS.aquaHue),
      aquaBrightness: clampNumber(value.aquaBrightness, 0, 100, DEFAULTS.aquaBrightness),
      aquaBackground: value.aquaBackground === 'wallpaper' ? 'wallpaper' : 'fluid',
      aquaWallpaperBlur: clampNumber(
        value.aquaWallpaperBlur,
        0,
        40,
        DEFAULTS.aquaWallpaperBlur
      ),
      aquaWallpaperFrost: clampNumber(
        value.aquaWallpaperFrost,
        0,
        100,
        DEFAULTS.aquaWallpaperFrost
      ),
      aquaWhale: typeof value.aquaWhale === 'boolean' ? value.aquaWhale : DEFAULTS.aquaWhale,
      aquaCritters: typeof value.aquaCritters === 'boolean'
        ? value.aquaCritters
        : DEFAULTS.aquaCritters
    };
  }

  function createSeededRandom(seed = 0x5a17c9) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function createFluidBackdrop({ canvas, document: doc, window: win } = {}) {
    const context = canvas?.getContext?.('2d', { alpha: true });
    if (!canvas || !context || !doc || !win) {
      return Object.freeze({ stir() {}, setTheme() {}, setPaused() {}, dispose() {} });
    }

    const nodes = [
      { x: .12, y: .72, radius: .54, phase: .2, speed: .14, tone: 0 },
      { x: .72, y: .2, radius: .46, phase: 2.1, speed: .11, tone: 1 },
      { x: .62, y: .82, radius: .5, phase: 4.2, speed: .09, tone: 2 },
      { x: .92, y: .52, radius: .32, phase: 1.3, speed: .17, tone: 0 },
      { x: .35, y: .35, radius: .28, phase: 5.4, speed: .13, tone: 2 }
    ];
    const ripples = [];
    const hoverTimes = new WeakMap();
    let dark = doc.documentElement.dataset.theme !== 'light';
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let previousFrame = 0;
    let paused = false;
    let disposed = false;

    function tier() {
      return doc.documentElement.dataset.fxTier || 'full';
    }

    function frameRate() {
      if (tier() === 'static') return 0;
      return tier() === 'lite' ? 10 : 24;
    }

    function resize() {
      const factor = tier() === 'full' ? .52 : .34;
      const nextWidth = Math.max(1, Math.round(canvas.clientWidth * factor));
      const nextHeight = Math.max(1, Math.round(canvas.clientHeight * factor));
      if (nextWidth === width && nextHeight === height) return false;
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      return true;
    }

    function palette(tone, alpha) {
      const darkColors = [
        [17, 164, 160],
        [36, 112, 165],
        [14, 83, 113]
      ];
      const lightColors = [
        [71, 197, 195],
        [112, 180, 212],
        [211, 246, 242]
      ];
      const color = (dark ? darkColors : lightColors)[tone % 3];
      return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
    }

    function draw(now = 0) {
      resize();
      const time = now / 1000;
      context.clearRect(0, 0, width, height);
      context.fillStyle = dark ? '#03141b' : '#eaf8f7';
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = dark ? 'screen' : 'source-over';

      for (const node of nodes) {
        const driftX = Math.sin(time * node.speed + node.phase) * .1;
        const driftY = Math.cos(time * node.speed * .83 + node.phase) * .09;
        const x = (node.x + driftX) * width;
        const y = (node.y + driftY) * height;
        const radius = node.radius * Math.max(width, height);
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, palette(node.tone, dark ? .48 : .55));
        gradient.addColorStop(.44, palette(node.tone, dark ? .24 : .3));
        gradient.addColorStop(1, palette(node.tone, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }

      context.globalCompositeOperation = dark ? 'screen' : 'multiply';
      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        const elapsed = Math.max(0, now - ripple.startedAt);
        const progress = elapsed / ripple.duration;
        if (progress >= 1) {
          ripples.splice(index, 1);
          continue;
        }
        const ease = 1 - Math.pow(1 - progress, 3);
        const radius = Math.max(width, height) * (.025 + ease * ripple.radius);
        const alpha = (1 - progress) * ripple.strength;
        const ring = context.createRadialGradient(
          ripple.x * width,
          ripple.y * height,
          Math.max(0, radius - Math.max(2, radius * .08)),
          ripple.x * width,
          ripple.y * height,
          radius + Math.max(3, radius * .08)
        );
        ring.addColorStop(0, palette(ripple.tone, 0));
        ring.addColorStop(.48, palette(ripple.tone, alpha));
        ring.addColorStop(.52, palette(ripple.tone, alpha));
        ring.addColorStop(1, palette(ripple.tone, 0));
        context.fillStyle = ring;
        context.beginPath();
        context.arc(ripple.x * width, ripple.y * height, radius * 1.1, 0, Math.PI * 2);
        context.fill();
      }
      context.globalCompositeOperation = 'source-over';
    }

    function schedule() {
      if (disposed || paused || animationFrame) return;
      animationFrame = win.requestAnimationFrame(frame);
    }

    function frame(now) {
      animationFrame = 0;
      if (disposed || paused) return;
      const fps = frameRate();
      if (fps === 0) {
        draw(now);
        return;
      }
      const interval = 1000 / fps;
      if (now - previousFrame >= interval) {
        previousFrame = now - ((now - previousFrame) % interval);
        draw(now);
      }
      schedule();
    }

    function stir(clientX, clientY, strong = false) {
      if (disposed || paused) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      ripples.push({
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
        startedAt: win.performance.now(),
        duration: strong ? 1450 : 820,
        radius: strong ? .13 : .07,
        strength: strong ? .24 : .13,
        tone: strong ? 1 : 0
      });
      if (ripples.length > 6) ripples.shift();
      if (frameRate() === 0) draw(win.performance.now());
    }

    function buttonCenter(event) {
      const button = event.target?.closest?.('button, [role="button"]');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { button, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function onPointerOver(event) {
      const point = buttonCenter(event);
      if (!point) return;
      const now = win.performance.now();
      const last = hoverTimes.get(point.button) || 0;
      if (now - last < 420) return;
      hoverTimes.set(point.button, now);
      stir(point.x, point.y, false);
    }

    function onClick(event) {
      const point = buttonCenter(event);
      if (point) stir(point.x, point.y, true);
    }

    function onResize() {
      const changed = resize();
      if (changed && (paused || frameRate() === 0)) draw(win.performance.now());
    }

    doc.addEventListener('pointerover', onPointerOver, { capture: true, passive: true });
    doc.addEventListener('click', onClick, { capture: true });
    win.addEventListener('resize', onResize, { passive: true });
    draw(0);
    schedule();

    return Object.freeze({
      stir,
      setTheme(nextDark) {
        dark = Boolean(nextDark);
        draw(win.performance.now());
      },
      setPaused(nextPaused) {
        paused = Boolean(nextPaused);
        if (paused && animationFrame) {
          win.cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        } else if (!paused) {
          if (frameRate() === 0) draw(win.performance.now());
          schedule();
        }
      },
      dispose() {
        disposed = true;
        if (animationFrame) win.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        ripples.length = 0;
        doc.removeEventListener('pointerover', onPointerOver, { capture: true });
        doc.removeEventListener('click', onClick, { capture: true });
        win.removeEventListener('resize', onResize);
      }
    });
  }

  function createStarWhale({ host, document: doc, window: win } = {}) {
    if (!host || !doc || !win) {
      return Object.freeze({ setTheme() {}, setPaused() {}, dispose() {} });
    }
    const holder = doc.createElement('div');
    holder.className = 'aqua-particle-whale';
    holder.setAttribute('aria-hidden', 'true');
    const canvas = doc.createElement('canvas');
    holder.appendChild(canvas);
    host.appendChild(holder);
    const context = canvas.getContext('2d');
    if (!context) {
      holder.remove();
      return Object.freeze({ setTheme() {}, setPaused() {}, dispose() {} });
    }

    const random = createSeededRandom();
    const points = [];
    const addPoint = (x, y, edge = 0) => {
      const angle = random() * Math.PI * 2;
      const radius = .7 + random() * .8;
      points.push({
        x,
        y,
        edge,
        sx: Math.cos(angle) * radius,
        sy: Math.sin(angle) * radius,
        phase: random() * Math.PI * 2,
        size: .7 + random() * 1.5
      });
    };

    // 原创轮廓：椭圆星鲸躯干、双叶尾与舒展胸鳍，不使用任何品牌 SVG 路径。
    for (let index = 0; index < 250; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      const x = -.14 + Math.cos(angle) * radius * .76;
      const y = Math.sin(angle) * radius * (.3 + .08 * (x + .8));
      addPoint(x, y, radius > .82 ? 1 : 0);
    }
    for (let index = 0; index < 72; index += 1) {
      const t = random();
      const branch = random() > .5 ? 1 : -1;
      addPoint(.5 + t * .48, branch * t * .3 * (1 - t * .18), 1);
    }
    for (let index = 0; index < 56; index += 1) {
      const t = random();
      const branch = random() > .5 ? 1 : -1;
      addPoint(-.15 + t * .55, branch * (.18 + t * .28) * (1 - t), 1);
    }

    let dark = doc.documentElement.dataset.theme !== 'light';
    let pointerX = 0;
    let pointerY = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let animationFrame = 0;
    let previousFrame = 0;
    let paused = false;
    let disposed = false;
    const startedAt = win.performance.now();

    function resize() {
      const rect = holder.getBoundingClientRect();
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      const nextDpr = Math.min(win.devicePixelRatio || 1, 1.25);
      if (nextWidth === width && nextHeight === height && nextDpr === dpr) return false;
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      return true;
    }

    function draw(now, forceComplete = false) {
      if (width <= 1 || height <= 1) resize();
      const time = now / 1000;
      const raw = forceComplete ? 1 : Math.min(1, Math.max(0, (now - startedAt - 240) / 2100));
      const assembly = 1 - Math.pow(1 - raw, 3);
      const scale = Math.min(width, height) * .37;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      const base = dark ? [178, 231, 236] : [46, 99, 108];
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const sway = Math.sin(time * .72 + point.phase + point.x * 4) * (.009 + point.edge * .018);
        let x = point.sx + (point.x - point.sx) * assembly;
        let y = point.sy + (point.y + sway - point.sy) * assembly;
        const dx = x - pointerX;
        const dy = y - pointerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < .32 && distance > .001 && assembly > .88) {
          const push = Math.pow(1 - distance / .32, 2) * .08;
          x += dx / distance * push;
          y += dy / distance * push;
        }
        const shimmer = .52 + .34 * Math.sin(time * 1.3 + point.phase);
        const alpha = Math.max(.06, shimmer) * assembly * (point.edge ? .8 : .48);
        context.fillStyle = `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha.toFixed(3)})`;
        const size = point.size * (dark ? 1 : .85);
        context.fillRect(
          width / 2 + x * scale - size / 2,
          height / 2 - y * scale - size / 2,
          size,
          size
        );
      }
      context.globalCompositeOperation = 'source-over';
    }

    function reduced() {
      return doc.documentElement.dataset.fxTier === 'static'
        || Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    }

    function schedule() {
      if (disposed || paused || animationFrame || reduced()) return;
      animationFrame = win.requestAnimationFrame(frame);
    }

    function frame(now) {
      animationFrame = 0;
      if (disposed || paused) return;
      const fps = doc.documentElement.dataset.fxTier === 'lite' ? 10 : 20;
      const interval = 1000 / fps;
      if (now - previousFrame >= interval) {
        previousFrame = now - ((now - previousFrame) % interval);
        draw(now);
      }
      schedule();
    }

    function onPointerMove(event) {
      if (disposed || paused) return;
      const rect = holder.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerX += ((((event.clientX - rect.left) / rect.width) * 2 - 1) - pointerX) * .14;
      pointerY += ((-(((event.clientY - rect.top) / rect.height) * 2 - 1)) - pointerY) * .14;
    }

    function onResize() {
      const changed = resize();
      if (changed && (paused || reduced())) draw(win.performance.now(), reduced());
    }

    win.addEventListener('pointermove', onPointerMove, { passive: true });
    win.addEventListener('resize', onResize, { passive: true });
    resize();
    draw(win.performance.now(), reduced());
    schedule();

    return Object.freeze({
      setTheme(nextDark) {
        dark = Boolean(nextDark);
        if (reduced()) draw(win.performance.now(), true);
      },
      setPaused(nextPaused) {
        paused = Boolean(nextPaused);
        if (paused && animationFrame) {
          win.cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        } else if (!paused) {
          if (reduced()) draw(win.performance.now(), true);
          schedule();
        }
      },
      dispose() {
        disposed = true;
        if (animationFrame) win.cancelAnimationFrame(animationFrame);
        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('resize', onResize);
        holder.remove();
      }
    });
  }

  /* DSH-Transparent-UI-Plugin 1.1.0 compatibility adapters. The standalone
     engine is extracted from the plugin's compiled client, so these wrappers
     only translate 摘星阁's lifecycle API (theme / pause / dispose). */
  function createDshFluidBackdrop({ canvas, window: win, engine } = {}) {
    if (!canvas || !win || !engine?.attachFluidShader || !engine?.SITE_FLUID_PARAMS) {
      return Object.freeze({ stir() {}, setTheme() {}, setPaused() {}, dispose() {} });
    }

    const palettes = Object.freeze({
      light: Object.freeze({
        ...engine.SITE_FLUID_PARAMS,
        color1: '#5B8DE0',
        color2: '#A9C6F5',
        color3: '#FFFFFF',
        distortion: 24,
        swirl: 14,
        offsetY: 40
      }),
      dark: Object.freeze({
        ...engine.SITE_FLUID_PARAMS,
        color1: '#2D4F8D',
        color2: '#101E38',
        color3: '#0B1628',
        offsetY: 40
      })
    });
    let dark = true;
    let paused = false;
    let disposed = false;
    let handle = engine.attachFluidShader(canvas, palettes.dark);
    let previous = { x: .5, y: .5 };

    function normalized(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return previous;
      return {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height))
      };
    }

    return Object.freeze({
      stir(clientX, clientY, strong = false) {
        if (disposed || paused) return;
        const point = normalized(clientX, clientY);
        const gain = strong ? 1.8 : 1;
        handle?.stir(
          point.x,
          point.y,
          (point.x - previous.x) * gain,
          (point.y - previous.y) * gain
        );
        previous = point;
      },
      setTheme(nextDark) {
        dark = Boolean(nextDark);
        handle?.setParams(palettes[dark ? 'dark' : 'light']);
      },
      setPaused(nextPaused) {
        const shouldPause = Boolean(nextPaused);
        if (paused === shouldPause) return;
        paused = shouldPause;
        canvas.toggleAttribute('data-dsh-fluid-paused', paused);
        handle?.setPaused?.(paused);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        handle?.dispose();
        handle = null;
      }
    });
  }

  function createDshParticleWhale({ host, document: doc, engine } = {}) {
    if (!host || !doc || !engine?.mountWhale) {
      return Object.freeze({ setTheme() {}, setPaused() {}, dispose() {} });
    }
    let dark = doc.documentElement.dataset.theme !== 'light';
    let paused = false;
    let disposed = false;
    let handle = engine.mountWhale(host, dark);
    const holder = host.querySelector('[data-dsh-aqua-whale]');
    return Object.freeze({
      setTheme(nextDark) {
        dark = Boolean(nextDark);
        handle?.setDark(dark);
      },
      setPaused(nextPaused) {
        const shouldPause = Boolean(nextPaused);
        if (paused === shouldPause) return;
        paused = shouldPause;
        if (holder) holder.toggleAttribute('data-dsh-whale-paused', paused);
        handle?.setPaused?.(paused);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        handle?.dispose();
        handle = null;
      }
    });
  }

  function readStorage(storage, key) {
    try {
      return storage?.getItem?.(key) || '';
    } catch {
      return '';
    }
  }

  function writeStorage(storage, key, value) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    try {
      if (value) storage.setItem(key, value);
      else storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function isSupportedWallpaperDataUrl(value) {
    return typeof value === 'string'
      && value.length <= 3_000_000
      && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
  }

  function fileToDataUrl(file, win) {
    return new Promise((resolve, reject) => {
      const reader = new win.FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('无法读取图片'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl, win) {
    return new Promise((resolve, reject) => {
      const image = new win.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片格式无法识别'));
      image.src = dataUrl;
    });
  }

  async function compressWallpaper(file, { document: doc, window: win } = {}) {
    if (!file || !doc || !win) throw new Error('未选择图片');
    if (!/^image\/(?:png|jpeg|webp)$/u.test(file.type || '')) {
      throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_WALLPAPER_BYTES) {
      throw new Error('图片需小于 12 MB');
    }
    const source = await fileToDataUrl(file, win);
    const image = await loadImage(source, win);
    const longest = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = Math.min(1, MAX_WALLPAPER_EDGE / Math.max(1, longest));
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前环境无法处理图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let compressed = canvas.toDataURL('image/webp', .84);
    if (!compressed.startsWith('data:image/webp')) compressed = canvas.toDataURL('image/jpeg', .84);
    if (compressed.length > 2_400_000) {
      compressed = canvas.toDataURL('image/jpeg', .7);
    }
    if (compressed.length > 3_000_000) throw new Error('压缩后图片仍过大，请换一张尺寸更小的图片');
    return compressed;
  }

  function createAquaShell(deps = {}) {
    const doc = deps.document;
    const win = deps.window;
    const storage = deps.storage || null;
    const wallpaperStore = deps.wallpaperStore
      && typeof deps.wallpaperStore.load === 'function'
      && typeof deps.wallpaperStore.save === 'function'
      && typeof deps.wallpaperStore.clear === 'function'
      ? deps.wallpaperStore
      : null;
    const persist = typeof deps.persist === 'function' ? deps.persist : () => Promise.resolve();
    const onChange = typeof deps.onChange === 'function' ? deps.onChange : () => {};
    if (!doc || !win) throw new TypeError('aqua shell requires document and window');

    const root = doc.documentElement;
    const state = normalizeSettings(deps.preferences);
    const byId = id => doc.getElementById(id);
    const atmosphere = doc.querySelector('.atmosphere');
    const dshEngine = win.DshAquaEngine;
    root.dataset.dshEngine = dshEngine ? 'plugin-1.1.0' : 'compatibility';
    const fluid = dshEngine
      ? createDshFluidBackdrop({ canvas: byId('aquaFluidCanvas'), document: doc, window: win, engine: dshEngine })
      : createFluidBackdrop({ canvas: byId('aquaFluidCanvas'), document: doc, window: win });
    const whale = dshEngine
      ? createDshParticleWhale({ host: atmosphere, document: doc, window: win, engine: dshEngine })
      : createStarWhale({ host: atmosphere, document: doc, window: win });
    const wallpaper = byId('aquaWallpaperImage');
    const wallpaperStatus = byId('aquaWallpaperStatus');
    const wallpaperControls = byId('aquaWallpaperControls');
    const palettePresets = byId('aquaPalettePresets');
    const wallpaperOnly = [...doc.querySelectorAll('.wallpaper-only')];
    const legacyWallpaper = readStorage(storage, WALLPAPER_KEY);
    let wallpaperData = wallpaperStore
      ? ''
      : (isSupportedWallpaperDataUrl(legacyWallpaper) ? legacyWallpaper : '');
    let persistenceTimer = 0;
    let pendingPatch = {};
    let disposed = false;
    let wallpaperRequest = 0;
    let wallpaperWriteQueue = Promise.resolve();
    let appliedWallpaper = null;
    let appliedDark = null;
    const cleanups = [];

    const dustPositions = [
      [8, 12, 11, -2], [14, 31, 15, -7], [27, 7, 9, -4], [45, 18, 13, -9],
      [62, 9, 16, -5], [76, 28, 12, -8], [86, 11, 14, -3], [93, 37, 10, -6]
    ];
    const dust = dustPositions.map(([left, bottom, duration, delay]) => {
      const node = doc.createElement('span');
      node.className = 'aqua-critter';
      node.setAttribute('aria-hidden', 'true');
      node.style.left = `${left}%`;
      node.style.bottom = `${bottom}%`;
      node.style.setProperty('--aqua-dust-duration', `${duration}s`);
      node.style.setProperty('--aqua-dust-delay', `${delay}s`);
      atmosphere?.appendChild(node);
      return node;
    });

    function setStatus(message, error = false) {
      if (!wallpaperStatus) return;
      wallpaperStatus.textContent = message;
      wallpaperStatus.classList.toggle('error', error);
    }

    function currentThemeIsDark() {
      return root.dataset.theme !== 'light';
    }

    function applyBrightness() {
      const value = state.aquaBrightness;
      const dark = currentThemeIsDark();
      // Plugin 1.1.0 contract: the dark palette uses 0–50 as its useful half;
      // the light palette uses 50–100. Fifty is the unmodified background.
      const black = dark ? Math.max(0, (50 - value) / 50) : 0;
      const white = dark ? 0 : Math.max(0, (value - 50) / 50);
      root.style.setProperty('--aqua-user-brightness-black', black.toFixed(3));
      root.style.setProperty('--aqua-user-brightness-white', white.toFixed(3));
      root.style.setProperty('--dsh-aqua-brightness-black', black.toFixed(3));
      root.style.setProperty('--dsh-aqua-brightness-white', white.toFixed(3));
    }

    function syncPalettePresets() {
      if (!palettePresets) return;
      const theme = currentThemeIsDark() ? 'dark' : 'light';
      if (palettePresets.dataset.paletteTheme !== theme) {
        const fragment = doc.createDocumentFragment();
        for (const preset of FLUID_PALETTES[theme]) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'fluid-palette-option';
          button.dataset.aquaPalette = preset.id;
          button.dataset.aquaHue = String(preset.hue);
          button.dataset.aquaBrightness = String(preset.brightness);
          button.setAttribute('aria-pressed', 'false');
          button.setAttribute('title', `${preset.name} · 色相 ${preset.hue}° · 明暗 ${preset.brightness}%`);
          const swatch = doc.createElement('span');
          swatch.className = 'fluid-palette-swatch';
          swatch.setAttribute('aria-hidden', 'true');
          swatch.style.setProperty('--palette-swatch', preset.swatch);
          const name = doc.createElement('span');
          name.className = 'fluid-palette-name';
          name.textContent = preset.name;
          button.append(swatch, name);
          fragment.appendChild(button);
        }
        palettePresets.replaceChildren(fragment);
        palettePresets.dataset.paletteTheme = theme;
      }
      for (const button of palettePresets.querySelectorAll('[data-aqua-palette]')) {
        const active = Number(button.dataset.aquaHue) === state.aquaHue
          && Number(button.dataset.aquaBrightness) === state.aquaBrightness;
        button.setAttribute('aria-pressed', String(active));
      }
    }

    function syncControls() {
      for (const button of doc.querySelectorAll('[data-aqua-mode]')) {
        button.setAttribute('aria-pressed', String(button.dataset.aquaMode === state.aquaMode));
      }
      for (const button of doc.querySelectorAll('[data-aqua-background]')) {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.aquaBackground === state.aquaBackground)
        );
      }
      const values = [
        ['setAquaBlur', 'outAquaBlur', state.aquaBlur, 'px'],
        ['setAquaFrost', 'outAquaFrost', state.aquaFrost, '%'],
        ['setAquaHue', 'outAquaHue', state.aquaHue, '°'],
        ['setAquaBrightness', 'outAquaBrightness', state.aquaBrightness, '%'],
        ['setAquaWallpaperBlur', 'outAquaWallpaperBlur', state.aquaWallpaperBlur, 'px'],
        ['setAquaWallpaperFrost', 'outAquaWallpaperFrost', state.aquaWallpaperFrost, '%']
      ];
      for (const [inputId, outputId, value, unit] of values) {
        const input = byId(inputId);
        const output = byId(outputId);
        if (input && String(input.value) !== String(value)) input.value = String(value);
        if (input) input.setAttribute('aria-valuetext', `${value}${unit}`);
        if (output) output.textContent = `${value}${unit}`;
      }
      const whaleSwitch = byId('setAquaWhale');
      const critterSwitch = byId('setAquaCritters');
      if (whaleSwitch) whaleSwitch.checked = state.aquaWhale;
      if (critterSwitch) critterSwitch.checked = state.aquaCritters;
      const showWallpaper = state.aquaBackground === 'wallpaper';
      if (wallpaperControls) wallpaperControls.hidden = !showWallpaper;
      wallpaperOnly.forEach(node => { node.hidden = !showWallpaper; });
      syncPalettePresets();
    }

    function apply() {
      root.dataset.aquaMode = state.aquaMode;
      root.dataset.aquaBackground = state.aquaBackground === 'wallpaper' && wallpaperData
        ? 'wallpaper'
        : 'fluid';
      root.dataset.aquaWhale = state.aquaWhale ? 'on' : 'off';
      root.dataset.aquaCritters = state.aquaCritters ? 'on' : 'off';
      root.toggleAttribute('data-dsh-float', state.aquaMode === 'mica');
      root.toggleAttribute('data-dsh-compat', state.aquaMode === 'compat');
      root.style.setProperty('--aqua-user-blur', `${state.aquaBlur}px`);
      root.style.setProperty('--aqua-user-frost', String(state.aquaFrost));
      root.style.setProperty('--aqua-user-hue', `${state.aquaHue}deg`);
      root.style.setProperty('--aqua-wallpaper-blur', `${state.aquaWallpaperBlur}px`);
      root.style.setProperty('--aqua-wallpaper-frost', (state.aquaWallpaperFrost / 100).toFixed(3));
      root.style.setProperty('--dsh-aqua-blur', `${state.aquaBlur}px`);
      root.style.setProperty('--dsh-aqua-frost', String(Math.min(state.aquaFrost / 50, 1.4)));
      root.style.setProperty('--dsh-aqua-fluid-hue', `${state.aquaHue}deg`);
      root.style.setProperty('--dsh-aqua-wallpaper-blur', `${state.aquaWallpaperBlur}px`);
      root.style.setProperty('--dsh-aqua-wallpaper-frost', (state.aquaWallpaperFrost / 100).toFixed(3));
      if (atmosphere) atmosphere.dataset.background = root.dataset.aquaBackground;
      applyBrightness();
      if (wallpaper) {
        if (appliedWallpaper !== wallpaperData) {
          if (wallpaperData) wallpaper.src = wallpaperData;
          else wallpaper.removeAttribute('src');
          appliedWallpaper = wallpaperData;
        }
      }
      const dark = currentThemeIsDark();
      if (dark !== appliedDark) {
        fluid.setTheme(dark);
        whale.setTheme(dark);
        appliedDark = dark;
      }
      syncControls();
      syncPlayback();
    }

    function flushPersist() {
      if (persistenceTimer) win.clearTimeout(persistenceTimer);
      persistenceTimer = 0;
      const patch = pendingPatch;
      pendingPatch = {};
      if (!Object.keys(patch).length) return Promise.resolve();
      return Promise.resolve(persist(patch)).catch(() => {
        setStatus('外观偏好保存失败，本次调整仍会保留到窗口关闭', true);
      });
    }

    function schedulePersist(field, immediate = false) {
      pendingPatch[field] = state[field];
      if (persistenceTimer) win.clearTimeout(persistenceTimer);
      if (immediate) return flushPersist();
      persistenceTimer = win.setTimeout(flushPersist, PERSIST_DELAY);
      return Promise.resolve();
    }

    function enqueueWallpaperWrite(operation) {
      const task = wallpaperWriteQueue.then(operation, operation);
      wallpaperWriteQueue = task.then(() => undefined, () => undefined);
      return task;
    }

    async function writeWallpaperAsset(dataUrl) {
      if (wallpaperStore) {
        if (dataUrl) await wallpaperStore.save(dataUrl);
        else await wallpaperStore.clear();
        return true;
      }
      return writeStorage(storage, WALLPAPER_KEY, dataUrl || '');
    }

    function update(field, value, { immediate = false } = {}) {
      if (!FIELDS.includes(field)) return false;
      const next = normalizeSettings({ ...state, [field]: value });
      // “流体星云”也是一次有权威性的用户选择：即使当前状态本来就是
      // fluid，也必须使仍在压缩或写盘的旧壁纸请求失效。
      if (field === 'aquaBackground' && next.aquaBackground !== 'wallpaper') {
        wallpaperRequest += 1;
      }
      if (Object.is(state[field], next[field])) return false;
      state[field] = next[field];
      onChange({ [field]: next[field] });
      apply();
      schedulePersist(field, immediate);
      return true;
    }

    function listen(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    for (const button of doc.querySelectorAll('[data-aqua-mode]')) {
      listen(button, 'click', () => update('aquaMode', button.dataset.aquaMode, { immediate: true }));
    }
    for (const button of doc.querySelectorAll('[data-aqua-background]')) {
      listen(button, 'click', () => update(
        'aquaBackground',
        button.dataset.aquaBackground,
        { immediate: true }
      ));
    }
    listen(palettePresets, 'click', event => {
      const button = event.target.closest('[data-aqua-palette]');
      if (!button || !palettePresets.contains(button)) return;
      const hue = Number(button.dataset.aquaHue);
      const brightness = Number(button.dataset.aquaBrightness);
      update('aquaHue', hue);
      update('aquaBrightness', brightness);
      flushPersist();
    });

    const ranges = [
      ['setAquaBlur', 'aquaBlur'],
      ['setAquaFrost', 'aquaFrost'],
      ['setAquaHue', 'aquaHue'],
      ['setAquaBrightness', 'aquaBrightness'],
      ['setAquaWallpaperBlur', 'aquaWallpaperBlur'],
      ['setAquaWallpaperFrost', 'aquaWallpaperFrost']
    ];
    for (const [id, field] of ranges) {
      const input = byId(id);
      listen(input, 'input', () => update(field, Number(input.value)));
      listen(input, 'change', () => schedulePersist(field, true));
    }

    listen(byId('setAquaWhale'), 'change', event => update(
      'aquaWhale',
      Boolean(event.currentTarget.checked),
      { immediate: true }
    ));
    listen(byId('setAquaCritters'), 'change', event => update(
      'aquaCritters',
      Boolean(event.currentTarget.checked),
      { immediate: true }
    ));

    listen(byId('btnAquaReset'), 'click', () => {
      wallpaperRequest += 1;
      Object.assign(state, DEFAULTS);
      onChange({ ...DEFAULTS });
      pendingPatch = { ...DEFAULTS };
      apply();
      flushPersist();
      setStatus('已恢复默认氛围');
    });

    listen(byId('btnAquaWallpaperClear'), 'click', async () => {
      wallpaperRequest += 1;
      try {
        const cleared = await enqueueWallpaperWrite(() => writeWallpaperAsset(''));
        if (!cleared) throw new Error('无法清除本机壁纸');
        if (disposed) return;
        wallpaperData = '';
        state.aquaBackground = 'fluid';
        onChange({ aquaBackground: 'fluid' });
        pendingPatch.aquaBackground = 'fluid';
        apply();
        await flushPersist();
        setStatus('壁纸已移除');
      } catch (error) {
        if (!disposed) setStatus(error?.message || '壁纸移除失败', true);
      }
    });

    listen(byId('setAquaWallpaper'), 'change', async event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const request = ++wallpaperRequest;
      const previousWallpaper = wallpaperData;
      setStatus('正在本机压缩图片…');
      try {
        const dataUrl = await compressWallpaper(file, { document: doc, window: win });
        if (disposed || request !== wallpaperRequest) return;
        const result = await enqueueWallpaperWrite(async () => {
          if (disposed || request !== wallpaperRequest) return { stale: true };
          const saved = await writeWallpaperAsset(dataUrl);
          if (!saved) return { saved: false };
          if (!disposed && request !== wallpaperRequest) {
            // 写盘途中若用户恢复默认、切回流体或选了另一张图，就把固定
            // 资产槽恢复为原壁纸。写队列保证该恢复不会覆盖后续新请求。
            await writeWallpaperAsset(previousWallpaper).catch(() => {});
            return { stale: true };
          }
          return { saved: true };
        });
        if (result.stale || disposed || request !== wallpaperRequest) return;
        if (!result.saved) {
          throw new Error('本机存储空间不足，请选择更小的图片');
        }
        wallpaperData = dataUrl;
        state.aquaBackground = 'wallpaper';
        onChange({ aquaBackground: 'wallpaper' });
        pendingPatch.aquaBackground = 'wallpaper';
        apply();
        await flushPersist();
        setStatus('壁纸已应用');
      } catch (error) {
        setStatus(error?.message || '壁纸处理失败', true);
      }
    });

    function syncPlayback() {
      const idle = doc.hidden || (typeof doc.hasFocus === 'function' && !doc.hasFocus());
      const fluidVisible = state.aquaBackground !== 'wallpaper' || !wallpaperData;
      fluid.setPaused(idle || !fluidVisible);
      whale.setPaused(idle || !state.aquaWhale);
    }
    listen(doc, 'visibilitychange', syncPlayback);
    listen(win, 'blur', syncPlayback);
    listen(win, 'focus', syncPlayback);

    const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    listen(reducedMotion, 'change', syncPlayback);

    const environmentObserver = typeof win.MutationObserver === 'function'
      ? new win.MutationObserver(records => {
        if (records.some(record => record.attributeName === 'data-theme')) apply();
        else if (records.some(record => record.attributeName === 'data-fx-tier')) syncPlayback();
      })
      : null;
    environmentObserver?.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-fx-tier']
    });

    const navigation = doc.querySelector('.nav-tabs');
    function syncNavigationOrientation() {
      const vertical = Boolean(win.matchMedia?.('(min-width: 70rem)').matches);
      navigation?.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    }
    listen(win, 'resize', syncNavigationOrientation, { passive: true });

    function setGreeting() {
      const hour = new Date().getHours();
      const greeting = hour < 6 ? '夜航未眠，星图仍在更新'
        : hour < 11 ? '晨星已就位'
          : hour < 17 ? '探索未至之境'
            : hour < 22 ? '暮色升起，情报归航'
              : '夜航模式已开启';
      doc.querySelectorAll('[data-aqua-greeting]').forEach(node => { node.textContent = greeting; });
    }

    async function hydrateWallpaper() {
      if (!wallpaperStore) return;
      const request = wallpaperRequest;
      try {
        const stored = await wallpaperStore.load();
        if (disposed || request !== wallpaperRequest) return;
        if (isSupportedWallpaperDataUrl(stored)) {
          wallpaperData = stored;
        } else if (isSupportedWallpaperDataUrl(legacyWallpaper)) {
          await enqueueWallpaperWrite(async () => {
            if (disposed || request !== wallpaperRequest) return;
            await wallpaperStore.save(legacyWallpaper);
          });
          if (disposed || request !== wallpaperRequest) return;
          wallpaperData = legacyWallpaper;
          writeStorage(storage, WALLPAPER_KEY, '');
        }
        apply();
      } catch {
        if (!disposed) setStatus('本机壁纸读取失败，已暂时使用流体星云', true);
      }
    }

    apply();
    syncPlayback();
    syncNavigationOrientation();
    setGreeting();
    hydrateWallpaper();

    return Object.freeze({
      getSettings: () => ({ ...state }),
      update,
      flush: flushPersist,
      dispose() {
        if (disposed) return;
        disposed = true;
        flushPersist();
        cleanups.splice(0).forEach(cleanup => cleanup());
        environmentObserver?.disconnect();
        fluid.dispose();
        whale.dispose();
        dust.forEach(node => node.remove());
      }
    });
  }

  return Object.freeze({
    DEFAULTS,
    FIELDS,
    FLUID_PALETTES,
    WALLPAPER_KEY,
    normalizeSettings,
    createFluidBackdrop,
    createStarWhale,
    compressWallpaper,
    createAquaShell
  });
});
