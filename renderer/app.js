'use strict';
/* 摘星阁 · 前端逻辑（零依赖原生 JS）
   v0.3：双主题切换 / 时间轴日期分组信息流 / 右侧热度栏
        / 键盘快捷键 / 滑动导航指示 / 检索上下文 / 回到顶部 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const API = '';
const DomUtils = window.DomUtils;
const CommonLinks = window.CommonLinks;
const SettingsFormController = window.SettingsFormController;
const DesktopSettingsController = window.DesktopSettingsController;
const Bootstrap = window.StarPickingPavilionBootstrap;
const Desktop = window.starPickingPavilion || window.windcatcher;
const storage = Bootstrap.getSafeStorage(window);
const initialPreferences = Bootstrap.resolveInitialUiPreferences({
  desktop: Desktop,
  storage,
  commonLinks: CommonLinks,
  today: localDateString()
});
const restoredPreferences = initialPreferences.preferences;

// ---------- 状态 ----------
const state = {
  theme: restoredPreferences.theme,
  view: restoredPreferences.view,  // featured | hot | all | daily | links | sources | settings
  domain: restoredPreferences.domain,
  category: restoredPreferences.category,
  linksCategory: restoredPreferences.linksCategory,
  commonLinksFavorites: new Set(restoredPreferences.commonLinksFavorites),
  q: '',
  page: 0,
  listed: 0,             // 当前信息流已列出的条数（用于检索上下文计数）
  loading: false,
  dailyDate: restoredPreferences.dailyDate,
  dailyDates: [],
  realtime: restoredPreferences.realtime,
  knownIds: new Set(),  // 当前 feed 已显示的文章 id
  freshIds: new Set()   // 下次渲染要高亮的新 id
};

// ---------- 动效与滚动 ----------
const reducedMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
const prefersReducedMotion = () => Boolean(reducedMotionQuery?.matches);

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// ---------- 主题 ----------
function applyTheme(theme, { persist = true } = {}) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#04060e' : '#f6f4ee');
  if (persist) {
    preferenceActions.remember('theme', theme);
  }
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === 'light' ? 'dark' : 'light');
}
$('#btnTheme').addEventListener('click', toggleTheme);

// ---------- 工具 ----------
async function api(path, opts) {
  const res = await fetch(API + path, opts && opts.body ? {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body)
  } : opts);
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || `请求失败（${res.status}）`);
  if (payload === null) throw new Error('服务返回了无效响应');
  return payload;
}

function esc(s) {
  return DomUtils.escapeHTML(s);
}
const safeUrl = value => esc(DomUtils.safeHttpUrl(value));

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

let toastTimer;
function toast(msg, isError) {
  // 文本必须与消息完全一致：桌面端 E2E 会按前缀断言保存结果，图标一律走 CSS
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function persistUiPreferences(patch) {
  const sanitized = Bootstrap.sanitizeUiPreferencesPatch(patch, CommonLinks, {
    today: localDateString()
  });
  if (Object.keys(sanitized).length === 0) return Promise.resolve(null);
  try {
    const operation = Desktop?.updatePreferences
      ? Desktop.updatePreferences(sanitized)
      : Bootstrap.writeBrowserUiPreferences(
        storage,
        sanitized,
        CommonLinks,
        { today: localDateString() }
      );
    return Promise.resolve(operation).catch(() => {
      toast('界面选择保存失败，请重试', true);
      return null;
    });
  } catch {
    toast('界面选择保存失败，请重试', true);
    return Promise.resolve(null);
  }
}

const preferenceActions = Bootstrap.createUiPreferenceActions({
  commonLinks: CommonLinks,
  persist: persistUiPreferences,
  today: () => localDateString()
});
const dailyRequestGuard = Bootstrap.createLatestRequestGuard();
const feedRequestGuard = Bootstrap.createLatestRequestGuard();
const hotRailRequestGuard = Bootstrap.createLatestRequestGuard();

const DOMAIN_NAME = { lowaltitude: '低空经济', aerospace: '商业航天' };
const DIM_NAMES = {
  importance: '重要性', novelty: '新颖度', credibility: '可信度',
  impact: '行业影响', timeliness: '时效性'
};

// ---------- 塔台状态 ----------
// 统计数字变化时做一次短促补间，避免刷新瞬间的跳字
function setStat(el, value) {
  const target = Number(value);
  if (!Number.isFinite(target)) { el.textContent = '–'; return; }
  const previous = Number(el.dataset.value);
  el.dataset.value = String(target);
  if (!Number.isFinite(previous) || previous === target || prefersReducedMotion()) {
    el.textContent = target.toLocaleString('zh-CN');
    return;
  }
  const startedAt = performance.now();
  const tick = at => {
    const progress = Math.min(1, (at - startedAt) / 520);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(previous + (target - previous) * eased).toLocaleString('zh-CN');
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function refreshStats() {
  try {
    const s = await api('/api/stats');
    setStat($('#statSources'), s.sources);
    setStat($('#statToday'), s.today);
    setStat($('#statFeatured'), s.featuredToday);
    const busy = s.pipeline?.running;
    $('#statStatus').innerHTML = `<span class="pulse-dot${busy ? ' busy' : ''}"></span>`;
    $('#statStatusLabel').textContent = busy ? '采集中' : (s.aiConfigured ? 'AI 在线' : '启发模式');
    const banner = $('#feedBanner');
    if (!s.aiConfigured && (state.view === 'featured' || state.view === 'hot')) {
      banner.hidden = false;
      banner.innerHTML = '当前为<b>关键词启发式</b>降级模式 —— 在『设置』中填入 DeepSeek API Key 即可启用五维 AI 评分与智能精选。';
    } else banner.hidden = true;
    return s;
  } catch { /* 后端未就绪 */ }
}

// ---------- 卡片渲染 ----------
function scorePill(item) {
  const v = Math.round(item.quality ?? 0);
  if (item.featured) {
    return `<span class="score-pill featured" title="质量分 ${item.quality} · 当前热度 ${item.heat}（随时间消退）">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1C8 1 3 5.5 3 9.5a5 5 0 0 0 10 0c0-1.8-1-3.5-2-4.7C10.6 6.6 10 7.5 9 7.5 9.6 5.5 8 1 8 1z"/></svg>
      精选 <b>${v}</b></span>`;
  }
  if (item.quality != null) {
    return `<span class="score-pill" title="质量分 ${item.quality} · 当前热度 ${item.heat}">质量 <b>${v}</b></span>`;
  }
  return `<span class="score-pill">待评</span>`;
}

function cardInner(item) {
  const d = item.domain;
  const dims = item.scores ? Object.entries(DIM_NAMES).map(([k, name]) => `
    <div class="dim">
      <div class="dim-label"><span>${name}</span><b>${Math.round(item.scores[k] ?? 0)}</b></div>
      <div class="dim-bar"><i style="width:${Math.min(100, item.scores[k] ?? 0)}%"></i></div>
    </div>`).join('') : '';
  const cluster = item.clusterSize > 1 ? `
    <button class="cluster-toggle" data-cluster="${item.clusterId}" data-self="${item.id}" type="button" aria-expanded="false">
      <svg viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${item.clusterSize} 个信源 · 关联报道
    </button>` : '';
  // 五维分解此前只能靠"盲点"卡片才展开，现在给出显式的可聚焦入口
  const dimsToggle = dims ? `
    <button class="dims-toggle" type="button" aria-expanded="false">五维研判
      <svg viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>` : '';
  const foot = cluster || dimsToggle
    ? `<div class="card-foot">${cluster}${dimsToggle}</div>${cluster ? '<div class="cluster-items" hidden></div>' : ''}`
    : '';
  const reason = item.reason ? `
    <div class="card-reason">
      <span class="cr-label"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>情报研判</span>
      <span class="cr-text">${esc(item.reason)}</span>
    </div>` : '';
  const thumb = DomUtils.safeHttpUrl(item.image) !== '#'
    ? `<img class="card-thumb" src="${safeUrl(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '';

  return `
    <div class="card-head">
      <div class="card-meta">
        <span class="meta-source">${esc(item.source)}</span>
        <span class="tier-chip tier-${esc(item.tier)}">${esc(item.tier)}</span>
        ${d ? `<span class="domain-dot ${d === 'lowaltitude' ? 'la' : 'ae'}"><i></i>${DOMAIN_NAME[d] || ''}</span>` : ''}
        ${item.category ? `<span class="cat-tag">${esc(item.category)}</span>` : ''}
        <span>${timeAgo(item.publishedAt || item.fetchedAt)}</span>
      </div>
      ${scorePill(item)}
    </div>
    <a class="card-title" href="${safeUrl(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
    <div class="card-content${thumb ? ' has-thumb' : ''}">
      <div class="card-text">
        ${item.summary ? `<p class="card-summary">${esc(item.summary)}</p>` : ''}
        ${item.tags?.length ? `<div class="card-tags">${item.tags.map(t => `<span class="card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      ${thumb}
    </div>
    ${reason}
    ${foot}
    ${dims ? `<div class="dims">${dims}</div>` : ''}`;
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

document.addEventListener('error', event => {
  if (event.target?.matches?.('img.card-thumb')) event.target.remove();
}, true);

// 时间轴行（精选 / 全部动态）
function renderTimeline(items, startIdx) {
  // 按日期分组
  const groups = [];
  let cur = null;
  for (const item of items) {
    const label = dateLabel(item.publishedAt || item.fetchedAt);
    if (!cur || cur.label !== label) {
      cur = { label, items: [] };
      groups.push(cur);
    }
    cur.items.push(item);
  }
  return groups.map(g => `
    <div class="date-group">
      <div class="date-head">${esc(g.label)}<span class="dh-count">${g.items.length} 条</span></div>
      ${g.items.map((item, i) => `
        <div class="tl-row">
          <div class="tl-left">
            <span class="tl-time">${hhmm(item.publishedAt || item.fetchedAt)}</span>
            <i class="tl-dot ${item.domain === 'lowaltitude' ? 'la' : item.domain === 'aerospace' ? 'ae' : ''}"></i>
          </div>
          <article class="card${item.featured ? ' is-featured' : ''}" data-id="${item.id}" style="animation-delay:${Math.min(startIdx + i, 10) * 35}ms">
            ${cardInner(item)}
          </article>
        </div>`).join('')}
    </div>`).join('');
}

// 排行（热点榜）
function renderRanked(items, startIdx) {
  return items.map((item, i) => {
    const rank = startIdx + i + 1;
    return `
    <div class="rank-row">
      <div class="card-rank${rank <= 3 ? ' top' : ''}">${String(rank).padStart(2, '0')}</div>
      <article class="card${item.featured ? ' is-featured' : ''}" data-id="${item.id}" style="animation-delay:${Math.min(i, 10) * 35}ms">
        ${cardInner(item)}
      </article>
    </div>`;
  }).join('');
}

function skeletons(n = 5) {
  return Array.from({ length: n }, () => `
    <div class="card skeleton" style="margin-bottom:14px">
      <div class="sk-line" style="width:70%"></div>
      <div class="sk-line" style="width:38%;height:10px"></div>
      <div class="sk-line" style="width:95%;height:11px"></div>
    </div>`).join('');
}

// 检索上下文条：明确当前处于检索态，并给出一键退出
function renderSearchContext() {
  const box = $('#searchContext');
  if (!state.q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = `检索 <strong>「${esc(state.q)}」</strong>`
    + ` · 已列出 <span class="sc-count">${state.listed}</span> 条`
    + '<button type="button" data-act="clear-search">清除检索</button>';
}

async function loadFeed(reset = true) {
  // 分页追加不能并发，否则两批结果会交错；整表重载则以最后一次请求为准，
  // 这样在加载途中切换领域/分类不会被静默丢弃。
  if (!reset && state.loading) return;
  const request = feedRequestGuard.begin();
  state.loading = true;
  const list = $('#feedList');
  if (reset) { state.page = 0; state.listed = 0; list.innerHTML = skeletons(); $('#newFlash').hidden = true; }
  try {
    const params = new URLSearchParams({ view: state.view, page: state.page });
    if (state.domain) params.set('domain', state.domain);
    if (state.category) params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    const data = await api('/api/feed?' + params);
    if (!request.isCurrent()) return;
    const startIdx = state.page * 30;
    const html = state.view === 'hot'
      ? renderRanked(data.items, startIdx)
      : renderTimeline(data.items, 0);
    if (reset) list.innerHTML = html;
    else list.insertAdjacentHTML('beforeend', html);
    state.listed = reset ? data.items.length : state.listed + data.items.length;
    renderSearchContext();
    // 记录已知 id；高亮本次新到达的条目（实时插入）
    if (reset) state.knownIds = new Set(data.items.map(i => i.id));
    else data.items.forEach(i => state.knownIds.add(i.id));
    if (state.freshIds.size) {
      for (const id of state.freshIds) {
        const el = list.querySelector(`.card[data-id="${id}"]`);
        if (el) el.classList.add('card-new');
      }
      state.freshIds.clear();
    }
    if (reset && !data.items.length) {
      list.innerHTML = `<div class="empty-state glass">
        <div class="es-icon">风 平 浪 静</div>
        <p>${state.q ? '没有检索到相关情报，换个关键词试试' : '暂无内容 —— 点击右上角刷新按钮立即采集，或等待定时任务'}</p>
      </div>`;
    }
    $('#btnMore').hidden = !data.hasMore;
    $('#feedEnd').hidden = data.hasMore || !data.items.length;
  } catch (e) {
    if (!request.isCurrent()) return;
    if (reset) list.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>后端连接失败：${esc(e.message)}</p></div>`;
  } finally {
    if (request.isCurrent()) state.loading = false;
  }
}

// ---------- 右侧热度栏 ----------
async function loadHotRail() {
  const box = $('#hotRailList');
  const request = hotRailRequestGuard.begin();
  try {
    const params = new URLSearchParams({ view: 'hot', page: 0 });
    if (state.domain) params.set('domain', state.domain);
    const data = await api('/api/feed?' + params);
    if (!request.isCurrent()) return;
    const top = data.items.slice(0, 10);
    if (!top.length) { box.innerHTML = '<div class="hot-rail-sub">暂无热点</div>'; return; }
    box.innerHTML = top.map((it, i) => `
      <a class="hot-item" href="${safeUrl(it.url)}" target="_blank" rel="noopener" title="${esc(it.title)}">
        <span class="hi-rank">${i + 1}</span>
        <span>
          <span class="hi-title">${esc(it.title)}</span>
          <span class="hi-meta">
            <span class="hi-heat">${Math.round(it.heat ?? 0)}°</span>
            ${it.clusterSize > 1 ? `<span>${it.clusterSize} 个信源</span>` : `<span>${esc(it.source)}</span>`}
            <span>${timeAgo(it.publishedAt || it.fetchedAt)}</span>
          </span>
        </span>
      </a>`).join('');
  } catch { if (request.isCurrent()) box.innerHTML = ''; }
}

// 卡片交互：展开五维 / 事件簇
$('#feedList').addEventListener('click', async e => {
  const dimsBtn = e.target.closest('.dims-toggle');
  if (dimsBtn) {
    const card = dimsBtn.closest('.card');
    dimsBtn.setAttribute('aria-expanded', String(card.classList.toggle('expanded')));
    return;
  }
  const tgl = e.target.closest('.cluster-toggle');
  if (tgl) {
    const box = tgl.closest('.card').querySelector('.cluster-items');
    if (!box) return;
    tgl.classList.toggle('open');
    if (box.hidden && !box.dataset.loaded) {
      box.hidden = false;
      box.innerHTML = '<div class="sk-line" style="width:60%"></div>';
      try {
        const items = await api('/api/cluster/' + tgl.dataset.cluster);
        const selfId = Number(tgl.dataset.self);
        box.innerHTML = items.filter(i => i.id !== selfId).map(i => `
          <div class="cluster-item">
            <a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
            <span class="ci-meta">${esc(i.source)} · <b class="ci-tier tier-${esc(i.tier)}">${esc(i.tier)}</b> · ${timeAgo(i.publishedAt || i.fetchedAt)}</span>
          </div>`).join('') || '<div class="cluster-item">（无其他报道）</div>';
        box.dataset.loaded = '1';
      } catch { box.innerHTML = '<div class="cluster-item">加载失败</div>'; }
    } else {
      box.hidden = !box.hidden;
    }
    tgl.setAttribute('aria-expanded', String(!box.hidden));
    return;
  }
  const card = e.target.closest('.card');
  if (card && !e.target.closest('a, button')) {
    const expanded = card.classList.toggle('expanded');
    card.querySelector('.dims-toggle')?.setAttribute('aria-expanded', String(expanded));
  }
});

$('#btnMore').addEventListener('click', async () => {
  const btn = $('#btnMore');
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.textContent = '加载中…';
  state.page++;
  try {
    await loadFeed(false);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.textContent = '加载更多';
  }
});

// ---------- 日报 ----------
async function loadDaily(date) {
  const request = dailyRequestGuard.begin();
  const body = $('#dailyBody');
  body.innerHTML = skeletons(3);
  try {
    const data = await api('/api/daily' + (date ? `?date=${date}` : ''));
    if (!request.isCurrent()) return;
    const r = data.report;
    state.dailyDate = r.date;
    state.dailyDates = data.dates;
    $('#dailyDate').textContent = r.date.replace(/-/g, ' / ');
    $('#dailySub').textContent =
      `${r.total} 条精选 · 低空经济 ${r.byDomain.lowaltitude} 条 · 商业航天 ${r.byDomain.aerospace} 条 · 生成于 ${new Date(r.generatedAt).toLocaleTimeString('zh-CN')}`;
    if (!r.sections.length) {
      body.innerHTML = `<div class="empty-state glass"><div class="es-icon">今 日 无 风</div><p>该日期暂无精选情报（可能尚未采集或全部低于精选阈值）</p></div>`;
      return;
    }
    body.innerHTML = r.sections.map(sec => `
      <div class="daily-section glass" style="padding:18px 22px">
        <div class="daily-section-title">${esc(sec.category)}</div>
        ${sec.items.map(it => `
          <div class="daily-item">
            <span class="di-score">${Math.round(it.quality_score)}</span>
            <div>
              <a href="${safeUrl(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
              ${it.ai_summary ? `<div class="di-meta">${esc(it.ai_summary)}</div>` : ''}
              <div class="di-meta">${esc(it.source_name)} · ${esc(it.tier)} · ${DOMAIN_NAME[it.domain] || ''}</div>
            </div>
          </div>`).join('')}
      </div>`).join('');
  } catch (e) {
    if (!request.isCurrent()) return;
    body.innerHTML = `<div class="empty-state glass"><p>日报加载失败：${esc(e.message)}</p></div>`;
  }
}

function shiftDaily(days) {
  const cur = state.dailyDate ? parseLocalDate(state.dailyDate) : new Date();
  cur.setDate(cur.getDate() + days);
  const d = localDateString(cur);
  if (d > localDateString()) return;
  state.dailyDate = d;
  preferenceActions.remember('dailyDate', d);
  loadDaily(d);
}
$('#dailyPrev').addEventListener('click', () => shiftDaily(-1));
$('#dailyNext').addEventListener('click', () => shiftDaily(1));
$('#dailyRegen').addEventListener('click', async () => {
  const btn = $('#dailyRegen');
  btn.disabled = true;
  btn.classList.add('is-busy');
  try {
    await api('/api/daily/regenerate', { body: { date: state.dailyDate } });
    toast('日报已重新生成');
    loadDaily(state.dailyDate);
  } catch (error) {
    toast('日报重新生成失败：' + error.message, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }
});

// ---------- 信源 ----------
async function loadSources() {
  const list = $('#sourcesList');
  list.innerHTML = skeletons(4);
  try {
    const sources = await api('/api/sources');
    list.innerHTML = sources.map(s => {
      const st = !s.enabled ? 'idle' : s.last_status?.startsWith('error') ? 'err' : s.last_status === 'ok' ? 'ok' : 'idle';
      const health = s.health || {};
      const paused = health.pausedUntil
        ? `<span class="src-backoff" title="连续失败后自动拉长重试间隔，避免每轮空转">
             暂停至 ${esc(hhmm(health.pausedUntil))}</span>`
        : '';
      return `
      <div class="src-card glass${health.state === 'failing' ? ' is-failing' : ''}" data-id="${s.id}">
        <div class="src-row1">
          <span class="src-status ${st}" title="${esc(s.last_status || '未采集')}"></span>
          <span class="src-name" title="${esc(s.url)}">${esc(s.name)}</span>
          <span class="tier-chip tier-${esc(s.tier)}">${esc(s.tier)}</span>
          ${paused}
        </div>
        <div class="src-meta">
          <span>${esc(s.type.toUpperCase())}</span>
          <span>${DOMAIN_NAME[s.domain] || '双领域'}</span>
          <span>累计 ${s.item_count} 条</span>
          ${health.consecutiveErrors
            ? `<span style="color:var(--danger-ink)">连续失败 ${health.consecutiveErrors} 次</span>`
            : s.error_count ? `<span>累计失败 ${s.error_count} 次</span>` : ''}
          <span>${s.last_fetch_at ? timeAgo(s.last_fetch_at) : '未采集'}</span>
        </div>
        ${s.note ? `<div class="src-meta" style="margin-top:4px">${esc(s.note)}</div>` : ''}
        <div class="src-actions">
          <button data-act="toggle">${s.enabled ? '停用' : '启用'}</button>
          ${health.pausedUntil ? '<button data-act="retry">立即重试</button>' : ''}
          <button data-act="remove" class="danger"${s.enabled ? '' : ' disabled'}>${s.enabled ? '移出监控' : '已移出监控'}</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty-state glass"><p>加载失败：${esc(e.message)}</p></div>`;
  }
}

$('#sourcesList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.src-card').dataset.id;
  try {
    if (btn.dataset.act === 'toggle') {
      const enabled = btn.textContent === '启用';
      await api(`/api/sources/${id}`, { method: 'PATCH', body: { enabled } });
      toast(enabled ? '信源已启用' : '信源已停用');
      loadSources();
    } else if (btn.dataset.act === 'retry') {
      await api(`/api/sources/${id}/retry`, { body: {} });
      toast('已清除退避，下轮采集会重新尝试');
      loadSources();
    } else if (btn.dataset.act === 'remove') {
      if (btn.disabled) return;
      if (!confirm('确定将该信源移出监控？已采集文章和信源记录都会保留。')) return;
      await api(`/api/sources/${id}`, { method: 'DELETE' });
      toast('信源已移出监控');
      loadSources();
    }
  } catch (error) {
    toast('信源操作失败：' + error.message, true);
  }
});

$('#btnAddSource').addEventListener('click', () => $('#srcDialog').showModal());
$('#srcForm').addEventListener('submit', async e => {
  if (e.submitter?.value !== 'ok') return;
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    await api('/api/sources', { body });
    toast('信源已提报，下轮采集生效');
    e.target.reset();
    loadSources();
  } catch (err) {
    toast('保存失败：' + err.message, true);
  }
});

// ---------- 设置 ----------
const settingsForm = SettingsFormController.createSettingsFormController({
  elements: {
    apiKey: $('#setApiKey'),
    baseUrl: $('#setBaseUrl'),
    prefilterModel: $('#setPrefilterModel'),
    scoringModel: $('#setScoringModel'),
    intervalMinutes: $('#setInterval'),
    rsshubBase: $('#setRsshub'),
    retentionDays: $('#setRetentionDays'),
    irrelevantRetentionDays: $('#setIrrelevantRetentionDays'),
    clearApiKeyButton: $('#btnClearAiKey')
  },
  request: api
});

const desktopSettings = (
  DesktopSettingsController
  && Desktop?.getDesktopSettings
  && Desktop?.updateDesktopSettings
) ? DesktopSettingsController.createDesktopSettingsController({
    elements: {
      closeToTray: $('#setCloseToTray'),
      launchAtLogin: $('#setLaunchAtLogin'),
      status: $('#desktopSettingsResult')
    },
    getSettings: () => Desktop.getDesktopSettings(),
    updateSettings: patch => Desktop.updateDesktopSettings(patch)
  }) : null;

if (!desktopSettings) {
  $('#setCloseToTray').disabled = true;
  $('#setLaunchAtLogin').disabled = true;
  $('#desktopSettingsResult').textContent = '桌面运行设置仅在安装版中可用。';
  $('#desktopSettingsResult').className = 'test-result desktop-settings-result warning';
}

$('#setCloseToTray').addEventListener('change', event => {
  desktopSettings?.update('closeToTray', event.currentTarget.checked).catch(() => {});
});
$('#setLaunchAtLogin').addEventListener('change', event => {
  desktopSettings?.update('launchAtLogin', event.currentTarget.checked).catch(() => {});
});

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1048576).toFixed(1)} MB`;
  return `${(value / 1073741824).toFixed(2)} GB`;
}

async function loadMaintenance() {
  try {
    const m = await api('/api/maintenance');
    $('#msArticles').textContent = m.articles.toLocaleString('zh-CN');
    $('#msSize').textContent = formatBytes(m.databaseBytes);
    $('#msExpiring').textContent = m.expiring.toLocaleString('zh-CN');
    if (m.lastPruneAt) {
      $('#lastPruneHint').innerHTML =
        `上次清理：${esc(timeAgo(m.lastPruneAt))} · 情报保留 ${m.retentionDays} 天、无关内容保留 ${m.irrelevantRetentionDays} 天。`
        + '过期情报连同全文检索索引会自动清除，WAL 随之截断。';
    }
  } catch {}
}

async function loadSettings() {
  try {
    await Promise.all([
      settingsForm.load(),
      desktopSettings?.load()
    ]);
  } catch {}
  loadMaintenance();
}

$('#btnSaveAi').addEventListener('click', async () => {
  try {
    await settingsForm.saveAi();
    toast('AI 配置已保存，下轮分析生效');
    refreshStats();
  } catch (error) {
    toast('AI 配置保存失败：' + error.message, true);
  }
});

$('#btnClearAiKey').addEventListener('click', async () => {
  if (!confirm('确定清除已由 Windows 安全保存的 AI API Key？清除后将使用关键词启发式降级模式。')) return;
  try {
    await settingsForm.clearApiKey();
    toast('AI API Key 已清除');
    refreshStats();
  } catch (error) {
    toast('清除密钥失败：' + error.message, true);
  }
});

$('#btnTestAi').addEventListener('click', async () => {
  const el = $('#aiTestResult');
  el.textContent = '测试中…'; el.className = 'test-result';
  $('#btnTestAi').disabled = true;
  try {
    const r = await api('/api/settings/test', { body: {} });
    el.textContent = r.ok ? '✓ 连接正常' : '✗ ' + r.error;
    el.classList.add(r.ok ? 'ok' : 'fail');
  } catch (e) {
    el.textContent = '✗ ' + e.message; el.classList.add('fail');
  } finally {
    $('#btnTestAi').disabled = false;
  }
});

$('#btnSaveCollect').addEventListener('click', async () => {
  try {
    await settingsForm.saveCollect();
    toast('采集设置已保存（间隔重启后生效，RSSHub 立即生效）');
  } catch (error) {
    toast('采集设置保存失败：' + error.message, true);
  }
});

$('#btnSaveRetention').addEventListener('click', async () => {
  try {
    await settingsForm.saveRetention();
    toast('数据保留设置已保存');
    loadMaintenance();
  } catch (error) {
    toast('数据保留设置保存失败：' + error.message, true);
  }
});

$('#btnPruneNow').addEventListener('click', async () => {
  const el = $('#pruneResult');
  el.textContent = '清理中…';
  el.className = 'test-result';
  $('#btnPruneNow').disabled = true;
  try {
    const r = await api('/api/maintenance/prune', { body: {} });
    el.textContent = r.skipped
      ? '清理已在进行中，请稍候'
      : r.removedArticles ? `✓ 已清理 ${r.removedArticles} 条` : '✓ 没有需要清理的内容';
    el.classList.add(r.skipped ? 'fail' : 'ok');
    loadMaintenance();
    refreshStats();
  } catch (error) {
    el.textContent = '✗ ' + error.message;
    el.classList.add('fail');
  } finally {
    $('#btnPruneNow').disabled = false;
  }
});

$('#btnFeedback').addEventListener('click', async () => {
  const t = $('#feedbackText').value.trim();
  if (!t) return toast('请先写点什么', true);
  try {
    await api('/api/feedback', { body: { kind: 'feedback', content: t } });
    $('#feedbackText').value = '';
    toast('反馈已记录');
  } catch (error) {
    toast('反馈保存失败：' + error.message, true);
  }
});

// ---------- 云幄 · 常用网址 ----------
function renderCommonLinks(focusKey, fallbackTarget) {
  const categories = CommonLinks.getCategories();
  $('#commonLinksCategories').innerHTML = categories.map(category => `
    <button class="common-links-category${category === state.linksCategory ? ' is-active' : ''}"
      data-links-category="${esc(category)}" data-focus-key="category:${esc(category)}" type="button"
      aria-pressed="${category === state.linksCategory}">${esc(category)}</button>
  `).join('');

  const items = CommonLinks.filterAndSortLinks({
    category: state.linksCategory,
    favoriteIds: state.commonLinksFavorites
  });
  $('#commonLinksCount').textContent = String(items.length);
  $('#commonLinksGrid').innerHTML = items.map((item, index) => `
    <article class="common-links-card glass" style="animation-delay:${Math.min(index * 28, 280)}ms">
      <div class="common-links-card-head">
        <div>
          <span class="common-links-label">${esc(item.category)}</span>
          <h3>${esc(item.name)}</h3>
        </div>
        <button class="common-links-favorite${item.isFavorite ? ' is-active' : ''}"
          data-link-favorite="${esc(item.id)}" data-focus-key="favorite:${esc(item.id)}" type="button"
          aria-pressed="${item.isFavorite}" title="${item.isFavorite ? '取消常用' : '设为常用'}">
          <span aria-hidden="true">${item.isFavorite ? '★' : '☆'}</span>
          ${item.isFavorite ? '已常用' : '设为常用'}
        </button>
      </div>
      <p>${esc(item.description)}</p>
      <div class="common-links-tags">${item.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
      <a class="common-links-open" href="${safeUrl(item.url)}" target="_blank" rel="noopener">打开 <span aria-hidden="true">↗</span></a>
    </article>
  `).join('');
  DomUtils.restoreFocusByKey(document, focusKey, fallbackTarget);
}

$('#commonLinksCategories').addEventListener('click', event => {
  const button = event.target.closest('button[data-links-category]');
  if (!button) return;
  const focusKey = button.dataset.focusKey;
  state.linksCategory = button.dataset.linksCategory;
  preferenceActions.remember('linksCategory', state.linksCategory);
  renderCommonLinks(focusKey, $('#commonLinksCategories'));
});

$('#commonLinksGrid').addEventListener('click', event => {
  const button = event.target.closest('button[data-link-favorite]');
  if (!button) return;
  const focusKey = button.dataset.focusKey;
  const id = button.dataset.linkFavorite;
  if (state.commonLinksFavorites.has(id)) state.commonLinksFavorites.delete(id);
  else state.commonLinksFavorites.add(id);
  preferenceActions.remember(
    'commonLinksFavorites',
    [...state.commonLinksFavorites]
  );
  renderCommonLinks(focusKey, $('#commonLinksGrid'));
});

// ---------- 视图切换 ----------
// 导航激活块跟随当前标签滑动，切换时是连续位移而不是跳变
function syncTabIndicator() {
  const active = $('.tab.active');
  const bar = $('.tab-indicator');
  if (!active || !bar) return;
  bar.style.setProperty('--ti-x', `${active.offsetLeft}px`);
  bar.style.setProperty('--ti-y', `${active.offsetTop}px`);
  bar.style.setProperty('--ti-w', `${active.offsetWidth}px`);
  bar.style.setProperty('--ti-h', `${active.offsetHeight}px`);
  bar.style.setProperty('--ti-o', '1');
}

// sticky 日期标题与热度栏的偏移量取决于导航条实际高度（换行时会变）
function syncNavHeight() {
  const nav = $('.nav');
  if (!nav) return;
  document.documentElement.style.setProperty(
    '--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`
  );
}

function switchView(view, { persist = true } = {}) {
  state.view = view;
  if (persist) preferenceActions.remember('view', view);
  $$('.tab').forEach(t => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  syncTabIndicator();
  const isFeed = ['featured', 'hot', 'all'].includes(view);
  // 重放入场动画
  for (const sec of $$('.view')) {
    sec.style.animation = 'none';
    void sec.offsetHeight;
    sec.style.animation = '';
  }
  $('#viewFeed').hidden = !isFeed;
  $('#viewDaily').hidden = view !== 'daily';
  $('#viewLinks').hidden = view !== 'links';
  $('#viewSources').hidden = view !== 'sources';
  $('#viewSettings').hidden = view !== 'settings';
  $('#feedFilters').style.display = isFeed ? '' : 'none';
  if (isFeed) { loadFeed(); loadHotRail(); }
  else if (view === 'daily') loadDaily(state.dailyDate);
  else if (view === 'links') renderCommonLinks();
  else if (view === 'sources') loadSources();
  else if (view === 'settings') loadSettings();
  refreshStats();
  scrollToTop();
}

$$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

function setDomain(domain, { persist = true, load = true } = {}) {
  state.domain = domain;
  $$('.pill').forEach(pill => {
    const on = pill.dataset.domain === domain;
    pill.classList.toggle('active', on);
    pill.setAttribute('aria-pressed', String(on));
  });
  if (persist) preferenceActions.remember('domain', domain);
  if (load) {
    loadFeed();
    loadHotRail();
  }
}

$$('.pill').forEach(p => p.addEventListener('click', () => setDomain(p.dataset.domain)));

// 分类 chips
async function initCategories() {
  try {
    const cats = await api('/api/categories');
    const resolved = Bootstrap.resolveDynamicCategory(state.category, cats);
    state.category = resolved.category;
    if (resolved.patch) persistUiPreferences(resolved.patch);
    $('#catChips').innerHTML = cats.map(c => {
      const on = c === state.category;
      return `<button class="chip${on ? ' active' : ''}" data-cat="${esc(c)}" aria-pressed="${on}">${esc(c)}</button>`;
    }).join('');
    $$('.chip').forEach(ch => ch.addEventListener('click', () => {
      const on = ch.classList.contains('active');
      $$('.chip').forEach(x => {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      if (!on) {
        ch.classList.add('active');
        ch.setAttribute('aria-pressed', 'true');
      }
      state.category = on ? '' : ch.dataset.cat;
      preferenceActions.remember('category', state.category);
      loadFeed();
    }));
    syncNavHeight();
  } catch {}
}

// ---------- 检索 ----------
const searchInput = $('#searchInput');

function syncSearchBox() {
  $('#searchBox').classList.toggle('has-value', Boolean(searchInput.value));
}

function clearSearch() {
  const hadQuery = Boolean(state.q);
  clearTimeout(searchTimer);   // 丢掉尚未触发的防抖，避免清空后又跑一次空检索
  searchInput.value = '';
  state.q = '';
  syncSearchBox();
  renderSearchContext();
  if (hadQuery) loadFeed();
}

let searchTimer;
searchInput.addEventListener('input', e => {
  syncSearchBox();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    if (!['featured', 'hot', 'all'].includes(state.view)) {
      switchView('all', { persist: false });
    }
    else loadFeed();
  }, 350);
});

$('#searchClear').addEventListener('click', () => {
  clearSearch();
  searchInput.focus();
});

$('#searchContext').addEventListener('click', event => {
  if (event.target.closest('button[data-act="clear-search"]')) clearSearch();
});

// 手动采集
$('#btnRefresh').addEventListener('click', async function () {
  this.classList.add('spinning');
  try {
    await api('/api/collect', { body: {} });
    toast('采集管线已启动，稍候自动刷新');
    const poll = setInterval(async () => {
      const s = await refreshStats();
      if (s && !s.pipeline?.running && !s.pending) {
        clearInterval(poll);
        this.classList.remove('spinning');
        if (['featured', 'hot', 'all'].includes(state.view)) { loadFeed(); loadHotRail(); }
        toast('采集分析完成');
      }
    }, 4000);
    setTimeout(() => { clearInterval(poll); this.classList.remove('spinning'); }, 300000);
  } catch (e) {
    this.classList.remove('spinning');
    toast('启动失败：' + e.message, true);
  }
});

// ---------- 键盘快捷键 ----------
function isTypingTarget(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (document.activeElement === searchInput) {
      clearSearch();
      searchInput.blur();
      event.preventDefault();
    }
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const tabIndex = '1234567'.indexOf(event.key);
    if (tabIndex >= 0) {
      const tab = $$('.tab')[tabIndex];
      if (tab) { switchView(tab.dataset.view); event.preventDefault(); }
      return;
    }
    const letter = String(event.key).toLowerCase();
    if (letter === 't') { toggleTheme(); event.preventDefault(); return; }
    if (letter === 'r') { $('#btnRefresh').click(); event.preventDefault(); return; }
    return;
  }
  if (isTypingTarget(document.activeElement)) return;
  const focusesSearch = event.key === '/'
    || ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k');
  if (focusesSearch) {
    searchInput.focus();
    searchInput.select();
    event.preventDefault();
    return;
  }
  if (event.key === 'Home') { scrollToTop(); event.preventDefault(); }
});

// ---------- 滚动态：导航加重、回到顶部 ----------
// 直接在事件里判定：滚动回调本就在布局之后，读 scrollY 不额外触发重排；
// 而 requestAnimationFrame 在窗口隐藏（托盘后台运行）时会被暂停，用它反而会漏更新。
let scrolledState = null;
let toTopState = null;
function syncScrollState() {
  const y = window.scrollY;
  const scrolled = y > 8;
  const showTop = y > 560;
  if (scrolled !== scrolledState) {
    scrolledState = scrolled;
    document.body.classList.toggle('is-scrolled', scrolled);
  }
  if (showTop !== toTopState) {
    toTopState = showTop;
    $('#toTop').classList.toggle('show', showTop);
  }
}
window.addEventListener('scroll', syncScrollState, { passive: true });
window.addEventListener('resize', () => { syncNavHeight(); syncTabIndicator(); });
$('#toTop').addEventListener('click', scrollToTop);

// ---------- 实时更新 ----------
function setRealtime(on, { persist = true } = {}) {
  state.realtime = on;
  const btn = $('#btnRealtime');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  if (persist) preferenceActions.remember('realtime', on);
}
$('#btnRealtime').addEventListener('click', () => {
  setRealtime(!state.realtime);
  toast(state.realtime ? '已开启实时更新' : '已暂停实时更新');
  if (state.realtime) pollRealtime();
});

function showNewFlash(n) {
  const f = $('#newFlash');
  f.textContent = `🛰 ${n} 条新情报 · 点击查看`;
  f.hidden = false;
}
$('#newFlash').addEventListener('click', () => {
  $('#newFlash').hidden = true;
  scrollToTop();
  loadFeed();           // freshIds 已在轮询中设置，渲染后会高亮
  loadHotRail();
});

const FEED_VIEWS = ['featured', 'hot', 'all'];
let pollTimer;
async function pollRealtime() {
  clearTimeout(pollTimer);
  const schedule = () => { pollTimer = setTimeout(pollRealtime, 18000); };
  if (document.hidden) return schedule();          // 后台标签页暂停
  await refreshStats();
  // 仅信息流视图、非检索、非加载中才做增量探测
  if (!FEED_VIEWS.includes(state.view) || state.q || state.loading) { loadHotRail(); return schedule(); }
  try {
    const params = new URLSearchParams({ view: state.view, page: 0 });
    if (state.domain) params.set('domain', state.domain);
    if (state.category) params.set('category', state.category);
    const data = await api('/api/feed?' + params);
    const newItems = data.items.filter(i => !state.knownIds.has(i.id));
    if (newItems.length) {
      const atTop = window.scrollY < 220;
      const reading = document.querySelector('.card.expanded, .cluster-items:not([hidden])');
      state.freshIds = new Set(newItems.map(i => i.id));
      if (state.realtime && atTop && !reading) {
        $('#newFlash').hidden = true;
        await loadFeed();                            // 在顶部且未展开阅读 → 直接刷新并高亮新条目
      } else {
        showNewFlash(newItems.length);               // 正在阅读 → 不打断，给可点横幅
      }
    }
    loadHotRail();
  } catch { /* 后端波动，忽略本轮 */ }
  schedule();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollRealtime(); });

// ---------- 自动更新提示（仅桌面壳内生效）----------
if (Desktop && Desktop.onUpdateStatus) {
  const pill = $('#updatePill');
  let updState = 'idle';
  Desktop.onUpdateStatus(({ status, version, percent, message }) => {
    updState = status;
    pill.classList.toggle('error', status === 'error');
    if (status === 'available') { pill.hidden = false; pill.classList.remove('ready'); pill.textContent = `发现新版本 ${version}…`; }
    else if (status === 'downloading') { pill.hidden = false; pill.classList.remove('ready'); pill.textContent = `下载更新 ${percent}%`; }
    else if (status === 'downloaded') { pill.hidden = false; pill.classList.add('ready'); pill.textContent = `▲ 重启安装 ${version}`; }
    else if (status === 'error') {
      pill.hidden = false;
      pill.classList.remove('ready');
      pill.textContent = '更新检查失败';
      pill.title = message || '稍后将自动重试';
    }
  });
  pill.addEventListener('click', () => { if (updState === 'downloaded') Desktop.installUpdate(); });
}

// ---------- 启动 ----------
async function start() {
  applyTheme(state.theme, { persist: false });
  setDomain(state.domain, { persist: false, load: false });
  setRealtime(state.realtime, { persist: false });
  syncSearchBox();
  syncNavHeight();
  syncScrollState();
  if (window.ResizeObserver) {
    new ResizeObserver(() => { syncNavHeight(); syncTabIndicator(); }).observe($('.nav'));
  }
  if (document.fonts?.ready) document.fonts.ready.then(syncTabIndicator).catch(() => {});
  if (initialPreferences.migrationPatch) persistUiPreferences(initialPreferences.migrationPatch);
  if (FEED_VIEWS.includes(state.view)) {
    await initCategories();
    switchView(state.view, { persist: false });
  } else {
    switchView(state.view, { persist: false });
    initCategories();
  }
  pollTimer = setTimeout(pollRealtime, 18000);   // 自调度实时增量循环
}

start().catch(() => toast('界面初始化失败，请刷新重试', true));
