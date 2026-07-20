'use strict';
/* 摘星阁 · 前端逻辑（零依赖原生 JS）
   v0.2：双主题切换 / 时间轴日期分组信息流 / 右侧热度栏 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const API = '';
const DomUtils = window.DomUtils;
const CommonLinks = window.CommonLinks;

function loadCommonLinkFavorites() {
  try {
    return CommonLinks.parseFavoriteIds(localStorage.getItem(CommonLinks.STORAGE_KEY));
  } catch {
    return CommonLinks.getDefaultFavoriteIds();
  }
}

// ---------- 状态 ----------
const state = {
  view: 'featured',     // featured | hot | all | daily | links | sources | settings
  domain: '',
  category: '',
  linksCategory: CommonLinks.ALL_CATEGORY,
  commonLinksFavorites: loadCommonLinkFavorites(),
  q: '',
  page: 0,
  loading: false,
  dailyDate: null,
  dailyDates: [],
  realtime: localStorage.getItem('wc-realtime') !== 'off',  // 实时开关，默认开
  knownIds: new Set(),  // 当前 feed 已显示的文章 id
  freshIds: new Set()   // 下次渲染要高亮的新 id
};

// ---------- 主题 ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#04060e' : '#f6f4ee');
  localStorage.setItem('wc-theme', theme);
}
$('#btnTheme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === 'light' ? 'dark' : 'light');
});

// ---------- 工具 ----------
async function api(path, opts) {
  const res = await fetch(API + path, opts && opts.body ? {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body)
  } : opts);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function esc(s) {
  return DomUtils.escapeHTML(s);
}

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
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

const DOMAIN_NAME = { lowaltitude: '低空经济', aerospace: '商业航天' };
const DIM_NAMES = {
  importance: '重要性', novelty: '新颖度', credibility: '可信度',
  impact: '行业影响', timeliness: '时效性'
};

// ---------- 塔台状态 ----------
async function refreshStats() {
  try {
    const s = await api('/api/stats');
    $('#statSources').textContent = s.sources;
    $('#statToday').textContent = s.today;
    $('#statFeatured').textContent = s.featuredToday;
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
    <button class="cluster-toggle" data-cluster="${item.clusterId}" data-self="${item.id}">
      <svg viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${item.clusterSize} 个信源 · 关联报道
    </button><div class="cluster-items" hidden></div>` : '';
  const reason = item.reason ? `
    <div class="card-reason">
      <span class="cr-label"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>情报研判</span>
      <span class="cr-text">${esc(item.reason)}</span>
    </div>` : '';
  const thumb = item.image ? `<img class="card-thumb" src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';

  return `
    ${scorePill(item)}
    <div class="card-meta">
      <span class="meta-source">${esc(item.source)}</span>
      <span class="tier-chip tier-${esc(item.tier)}">${esc(item.tier)}</span>
      ${d ? `<span class="domain-dot ${d === 'lowaltitude' ? 'la' : 'ae'}"><i></i>${DOMAIN_NAME[d] || ''}</span>` : ''}
      ${item.category ? `<span class="cat-tag">${esc(item.category)}</span>` : ''}
      <span>${timeAgo(item.publishedAt || item.fetchedAt)}</span>
    </div>
    <a class="card-title" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
    <div class="card-content${item.image ? ' has-thumb' : ''}">
      <div class="card-text">
        ${item.summary ? `<p class="card-summary">${esc(item.summary)}</p>` : ''}
        ${item.tags?.length ? `<div class="card-tags">${item.tags.map(t => `<span class="card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      ${thumb}
    </div>
    ${reason}
    ${cluster}
    ${dims ? `<div class="dims">${dims}</div>` : ''}`;
}

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

async function loadFeed(reset = true) {
  if (state.loading) return;
  state.loading = true;
  const list = $('#feedList');
  if (reset) { state.page = 0; list.innerHTML = skeletons(); $('#newFlash').hidden = true; }
  try {
    const params = new URLSearchParams({ view: state.view, page: state.page });
    if (state.domain) params.set('domain', state.domain);
    if (state.category) params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    const data = await api('/api/feed?' + params);
    const startIdx = state.page * 30;
    const html = state.view === 'hot'
      ? renderRanked(data.items, startIdx)
      : renderTimeline(data.items, 0);
    if (reset) list.innerHTML = html;
    else list.insertAdjacentHTML('beforeend', html);
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
    if (reset) list.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>后端连接失败：${esc(e.message)}</p></div>`;
  } finally {
    state.loading = false;
  }
}

// ---------- 右侧热度栏 ----------
async function loadHotRail() {
  const box = $('#hotRailList');
  try {
    const params = new URLSearchParams({ view: 'hot', page: 0 });
    if (state.domain) params.set('domain', state.domain);
    const data = await api('/api/feed?' + params);
    const top = data.items.slice(0, 10);
    if (!top.length) { box.innerHTML = '<div class="hot-rail-sub">暂无热点</div>'; return; }
    box.innerHTML = top.map((it, i) => `
      <a class="hot-item" href="${esc(it.url)}" target="_blank" rel="noopener" title="${esc(it.title)}">
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
  } catch { box.innerHTML = ''; }
}

// 卡片交互：展开五维 / 事件簇
$('#feedList').addEventListener('click', async e => {
  const tgl = e.target.closest('.cluster-toggle');
  if (tgl) {
    const box = tgl.nextElementSibling;
    tgl.classList.toggle('open');
    if (box.hidden && !box.dataset.loaded) {
      box.hidden = false;
      box.innerHTML = '<div class="sk-line" style="width:60%"></div>';
      try {
        const items = await api('/api/cluster/' + tgl.dataset.cluster);
        const selfId = Number(tgl.dataset.self);
        box.innerHTML = items.filter(i => i.id !== selfId).map(i => `
          <div class="cluster-item">
            <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
            <span class="ci-meta">${esc(i.source)} · <b class="ci-tier tier-${esc(i.tier)}">${esc(i.tier)}</b> · ${timeAgo(i.publishedAt || i.fetchedAt)}</span>
          </div>`).join('') || '<div class="cluster-item">（无其他报道）</div>';
        box.dataset.loaded = '1';
      } catch { box.innerHTML = '<div class="cluster-item">加载失败</div>'; }
    } else {
      box.hidden = !box.hidden;
    }
    return;
  }
  const card = e.target.closest('.card');
  if (card && !e.target.closest('a, button')) card.classList.toggle('expanded');
});

$('#btnMore').addEventListener('click', () => { state.page++; loadFeed(false); });

// ---------- 日报 ----------
async function loadDaily(date) {
  const body = $('#dailyBody');
  body.innerHTML = skeletons(3);
  try {
    const data = await api('/api/daily' + (date ? `?date=${date}` : ''));
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
              <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
              ${it.ai_summary ? `<div class="di-meta">${esc(it.ai_summary)}</div>` : ''}
              <div class="di-meta">${esc(it.source_name)} · ${esc(it.tier)} · ${DOMAIN_NAME[it.domain] || ''}</div>
            </div>
          </div>`).join('')}
      </div>`).join('');
  } catch (e) {
    body.innerHTML = `<div class="empty-state glass"><p>日报加载失败：${esc(e.message)}</p></div>`;
  }
}

function shiftDaily(days) {
  const cur = new Date(state.dailyDate || new Date().toISOString().slice(0, 10));
  cur.setDate(cur.getDate() + days);
  const d = cur.toISOString().slice(0, 10);
  if (new Date(d) > new Date()) return;
  loadDaily(d);
}
$('#dailyPrev').addEventListener('click', () => shiftDaily(-1));
$('#dailyNext').addEventListener('click', () => shiftDaily(1));
$('#dailyRegen').addEventListener('click', async () => {
  await api('/api/daily/regenerate', { body: { date: state.dailyDate } });
  toast('日报已重新生成');
  loadDaily(state.dailyDate);
});

// ---------- 信源 ----------
async function loadSources() {
  const list = $('#sourcesList');
  list.innerHTML = skeletons(4);
  try {
    const sources = await api('/api/sources');
    list.innerHTML = sources.map(s => {
      const st = !s.enabled ? 'idle' : s.last_status?.startsWith('error') ? 'err' : s.last_status === 'ok' ? 'ok' : 'idle';
      return `
      <div class="src-card glass" data-id="${s.id}">
        <div class="src-row1">
          <span class="src-status ${st}" title="${esc(s.last_status || '未采集')}"></span>
          <span class="src-name" title="${esc(s.url)}">${esc(s.name)}</span>
          <span class="tier-chip tier-${esc(s.tier)}">${esc(s.tier)}</span>
        </div>
        <div class="src-meta">
          <span>${esc(s.type.toUpperCase())}</span>
          <span>${DOMAIN_NAME[s.domain] || '双领域'}</span>
          <span>累计 ${s.item_count} 条</span>
          ${s.error_count ? `<span style="color:var(--c-red)">失败 ${s.error_count} 次</span>` : ''}
          <span>${s.last_fetch_at ? timeAgo(s.last_fetch_at) : '未采集'}</span>
        </div>
        ${s.note ? `<div class="src-meta" style="margin-top:4px">${esc(s.note)}</div>` : ''}
        <div class="src-actions">
          <button data-act="toggle">${s.enabled ? '停用' : '启用'}</button>
          <button data-act="delete" class="danger">删除</button>
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
  if (btn.dataset.act === 'toggle') {
    const enabled = btn.textContent === '启用';
    await api(`/api/sources/${id}`, { method: 'PATCH', body: { enabled } });
    toast(enabled ? '信源已启用' : '信源已停用');
    loadSources();
  } else if (btn.dataset.act === 'delete') {
    if (!confirm('确定删除该信源？已采集的文章会保留。')) return;
    await api(`/api/sources/${id}`, { method: 'DELETE' });
    toast('信源已删除');
    loadSources();
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
async function loadSettings() {
  try {
    const s = await api('/api/settings');
    $('#setApiKey').value = s.ai._hasKey ? s.ai.apiKey : '';
    $('#setBaseUrl').value = s.ai.baseUrl;
    $('#setPrefilterModel').value = s.ai.prefilterModel;
    $('#setScoringModel').value = s.ai.scoringModel;
    $('#setInterval').value = s.collect.intervalMinutes;
    $('#setRsshub').value = s.collect.rsshubBase || '';
  } catch {}
}

$('#btnSaveAi').addEventListener('click', async () => {
  await api('/api/settings', { body: { ai: {
    apiKey: $('#setApiKey').value,
    baseUrl: $('#setBaseUrl').value || 'https://api.deepseek.com',
    prefilterModel: $('#setPrefilterModel').value || 'deepseek-v4-flash',
    scoringModel: $('#setScoringModel').value || 'deepseek-v4-pro'
  } } });
  toast('AI 配置已保存，下轮分析生效');
  refreshStats();
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
  await api('/api/settings', { body: { collect: {
    intervalMinutes: Number($('#setInterval').value) || 30,
    rsshubBase: $('#setRsshub').value.trim()
  } } });
  toast('采集设置已保存（间隔重启后生效，RSSHub 立即生效）');
});

$('#btnFeedback').addEventListener('click', async () => {
  const t = $('#feedbackText').value.trim();
  if (!t) return toast('请先写点什么', true);
  await api('/api/feedback', { body: { kind: 'feedback', content: t } });
  $('#feedbackText').value = '';
  toast('反馈已记录');
});

// ---------- 云幄 · 常用网址 ----------
function persistCommonLinkFavorites() {
  try {
    localStorage.setItem(
      CommonLinks.STORAGE_KEY,
      JSON.stringify([...state.commonLinksFavorites])
    );
  } catch { /* 存储不可用时保留当前会话内状态 */ }
}

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
      <a class="common-links-open" href="${esc(DomUtils.safeHttpUrl(item.url))}" target="_blank" rel="noopener">打开 <span aria-hidden="true">↗</span></a>
    </article>
  `).join('');
  DomUtils.restoreFocusByKey(document, focusKey, fallbackTarget);
}

$('#commonLinksCategories').addEventListener('click', event => {
  const button = event.target.closest('button[data-links-category]');
  if (!button) return;
  const focusKey = button.dataset.focusKey;
  state.linksCategory = button.dataset.linksCategory;
  renderCommonLinks(focusKey, $('#commonLinksCategories'));
});

$('#commonLinksGrid').addEventListener('click', event => {
  const button = event.target.closest('button[data-link-favorite]');
  if (!button) return;
  const focusKey = button.dataset.focusKey;
  const id = button.dataset.linkFavorite;
  if (state.commonLinksFavorites.has(id)) state.commonLinksFavorites.delete(id);
  else state.commonLinksFavorites.add(id);
  persistCommonLinkFavorites();
  renderCommonLinks(focusKey, $('#commonLinksGrid'));
});

// ---------- 视图切换 ----------
function switchView(view) {
  state.view = view;
  $$('.tab').forEach(t => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

$$('.pill').forEach(p => p.addEventListener('click', () => {
  $$('.pill').forEach(x => x.classList.remove('active'));
  p.classList.add('active');
  state.domain = p.dataset.domain;
  loadFeed();
  loadHotRail();
}));

// 分类 chips
async function initCategories() {
  try {
    const cats = await api('/api/categories');
    $('#catChips').innerHTML = cats.map(c => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    $$('.chip').forEach(ch => ch.addEventListener('click', () => {
      const on = ch.classList.contains('active');
      $$('.chip').forEach(x => x.classList.remove('active'));
      if (!on) ch.classList.add('active');
      state.category = on ? '' : ch.dataset.cat;
      loadFeed();
    }));
  } catch {}
}

// 检索（防抖）
let searchTimer;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    if (!['featured', 'hot', 'all'].includes(state.view)) switchView('all');
    else loadFeed();
  }, 350);
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

// ---------- 实时更新 ----------
function setRealtime(on) {
  state.realtime = on;
  localStorage.setItem('wc-realtime', on ? 'on' : 'off');
  const btn = $('#btnRealtime');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
if (window.windcatcher && window.windcatcher.onUpdateStatus) {
  const pill = $('#updatePill');
  let updState = 'idle';
  window.windcatcher.onUpdateStatus(({ status, version, percent }) => {
    updState = status;
    if (status === 'available') { pill.hidden = false; pill.classList.remove('ready'); pill.textContent = `发现新版本 ${version}…`; }
    else if (status === 'downloading') { pill.hidden = false; pill.classList.remove('ready'); pill.textContent = `下载更新 ${percent}%`; }
    else if (status === 'downloaded') { pill.hidden = false; pill.classList.add('ready'); pill.textContent = `▲ 重启安装 ${version}`; }
    // error 静默，不打扰用户
  });
  pill.addEventListener('click', () => { if (updState === 'downloaded') window.windcatcher.installUpdate(); });
}

// ---------- 启动 ----------
setRealtime(state.realtime);
initCategories();
refreshStats();
loadFeed();
loadHotRail();
pollTimer = setTimeout(pollRealtime, 18000);   // 自调度实时增量循环
