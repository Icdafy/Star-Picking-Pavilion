'use strict';

/* 摘星阁 · v0.2.0 情报视图（单一脚本边界）
   三个模块合并在一个文件里，只占用一个 <script> 标签（见 test/perf-guard.test.js 的脚本预算）：
     IntelRender            —— 纯函数表示层：热点榜、一级市场、刊期新版块、精选标准
     HotViewController      —— 当前热点视图
     CapitalViewController  —— 一级市场视图（融资动态 / 公司热度 / 公司库 / 公司档案 / 活跃机构）
   浏览器里挂到 window 上，Node 单测里作为 CommonJS 导出。 */

(function exposeIntelViews(root) {
  /* 摘星阁 · 情报表示层（v0.2.0）
     热点榜、一级市场（融资动态 / 公司热度 / 公司库 / 公司档案 / 活跃机构）、
     日报·周报·月报的新版块。全部是纯函数：入参是接口数据，出参是 HTML 字符串；
     转义与安全链接经依赖注入，Node 单测可以逐字断言。所有可点击的元素只带
     data-* 属性，事件由各视图控制器委托处理。 */
  const IntelRender = (function createIntelRenderModule() {
    const DOMAIN_LABEL = Object.freeze({ lowaltitude: '低空经济', aerospace: '商业航天' });
    const DOMAIN_CLASS = Object.freeze({ lowaltitude: 'la', aerospace: 'ae' });
    const BADGES = Object.freeze({
      surge: ['爆', '近 6 小时新增独立信源占多数'],
      new: ['新', '6 小时内首次报道'],
      rising: ['升', '与 6 小时前同口径比较，热度上涨超过 15%'],
      breakthrough: ['突破', '成员报道通过了技术突破门槛']
    });
    const STATUS_LABEL = Object.freeze({ private: '未上市', listed: '已上市', state: '国有体系', unknown: '状态待核' });
    const DEAL_STATUS = Object.freeze({ completed: '已完成', announced: '已宣布', rumored: '传闻' });
    const WATCH_LABEL = Object.freeze({ 0: '未标记', 1: '关注', 2: '被投' });
    const STAGE_LABEL = Object.freeze({ early: '早期', growth: '成长期', late: '后期', ipo: '上市进程', strategic: '战略与并购', unknown: '轮次未披露' });
    const TIER_LABEL = Object.freeze({ b10: '十亿级+', b1: '亿元级', m10: '千万级', small: '千万以下' });
    const KIND_LABEL = Object.freeze({ equity: '股权融资', ipo: '上市进程', ma: '并购与转让', secondary: '上市公司再融资', debt: '债权与租赁', jv: '合资设立' });

    function createIntelRender({ esc, safeHttpUrl, timeAgo = null } = {}) {
      if (typeof esc !== 'function' || typeof safeHttpUrl !== 'function') {
        throw new TypeError('intel render requires esc and safeHttpUrl');
      }
      const url = value => esc(safeHttpUrl(value));
      const ago = value => {
        if (!value) return '';
        if (typeof timeAgo === 'function') return timeAgo(value);
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '';
      };
      const num = (value, digits = 1) => {
        const n = Number(value);
        return Number.isFinite(n) ? String(Math.round(n * 10 ** digits) / 10 ** digits) : '–';
      };
      const domainChip = domain => DOMAIN_LABEL[domain]
        ? `<span class="intel-domain ${DOMAIN_CLASS[domain]}">${DOMAIN_LABEL[domain]}</span>` : '';

      function empty(title, message) {
        return `<div class="empty-state glass"><div class="es-icon">${esc(title)}</div><p>${esc(message)}</p></div>`;
      }

      // 迷你走势：只有一个点时画一条短横线，没有点时不画
      function sparkline(points, { width = 104, height = 30 } = {}) {
        const values = (Array.isArray(points) ? points : []).map(p => Number(p?.heat)).filter(Number.isFinite);
        if (!values.length) return '';
        const max = Math.max(...values, 1);
        const step = values.length > 1 ? width / (values.length - 1) : width;
        const coords = (values.length > 1 ? values : [values[0], values[0]])
          .map((v, i) => `${Math.round(i * step * 10) / 10},${Math.round((height - 3 - (v / max) * (height - 6)) * 10) / 10}`);
        return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">`
          + `<polyline points="${coords.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
      }

      function companyChips(companies) {
        const list = (Array.isArray(companies) ? companies : []).filter(c => c?.id && c.name);
        if (!list.length) return '';
        return `<div class="intel-companies">${list.map(c => `<button type="button" class="intel-company${c.watch ? ` watch-${Number(c.watch)}` : ''}" data-company="${esc(c.id)}" title="打开「${esc(c.name)}」公司档案">${esc(c.name)}${c.watch === 2 ? '<i>被投</i>' : c.watch === 1 ? '<i>关注</i>' : ''}</button>`).join('')}</div>`;
      }

      function trendHtml(entry) {
        if (entry.trend === 'new') return '<span class="hot-trend new">新上榜</span>';
        if (!Number.isFinite(Number(entry.trendPct))) return '<span class="hot-trend flat">—</span>';
        const pct = Number(entry.trendPct);
        const cls = entry.trend === 'up' ? 'up' : entry.trend === 'down' ? 'down' : 'flat';
        const arrow = cls === 'up' ? '↑' : cls === 'down' ? '↓' : '→';
        return `<span class="hot-trend ${cls}" title="与 6 小时前同口径热度相比">${arrow} ${esc(num(Math.abs(pct)))}%</span>`;
      }

      function hotList(entries, { windowHours = 48, halfLifeHours = 24, minParticipants = 2 } = {}) {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) {
          return empty('风 平 浪 静', `近 ${windowHours} 小时还没有被 ${minParticipants} 个以上独立信源同时报道的事件。热度按事件计算：同一家出版方只算一次，${halfLifeHours} 小时减半。`);
        }
        return `<ol class="hot-list">${list.map(entry => {
          const rep = entry.representative || {};
          const badges = (entry.badges || []).filter(b => BADGES[b])
            .map(b => `<span class="hot-badge ${esc(b)}" title="${esc(BADGES[b][1])}">${BADGES[b][0]}</span>`).join('');
          const summary = entry.digest || rep.summary || '';
          const sources = (entry.sourceNames || []).slice(0, 6).map(esc).join('、');
          return `<li class="hot-item glass" data-story="${esc(entry.storyId)}">
    <div class="hot-rank${entry.rank <= 3 ? ' top' : ''}">${esc(entry.rank)}</div>
    <div class="hot-main">
      <div class="hot-meta">${domainChip(entry.domain)}${entry.category ? `<span class="hot-cat">${esc(entry.category)}</span>` : ''}${badges}<span class="hot-time">首报 ${esc(ago(entry.firstReportAt))}</span></div>
      <h3 class="hot-title"><a href="${url(rep.url)}" target="_blank" rel="noopener">${esc(entry.title)}</a></h3>
      ${summary ? `<p class="hot-digest">${entry.digest ? '<span class="hot-digest-label">事件综述</span>' : ''}${esc(summary)}</p>` : ''}
      <div class="hot-sources"><b>${esc(entry.participantCount)}</b> 个独立信源 · ${esc(entry.reportCount)} 篇报道${sources ? ` · ${sources}` : ''}</div>
      ${companyChips(entry.companies)}
      <div class="hot-actions">
        <button type="button" class="btn-ghost btn-compact" data-act="story" data-story="${esc(entry.storyId)}" aria-expanded="false">展开 ${esc(entry.reportCount)} 篇报道</button>
        ${rep.url ? `<a class="hot-rep" href="${url(rep.url)}" target="_blank" rel="noopener">代表稿 · ${esc(rep.source || '')}</a>` : ''}
      </div>
      <div class="hot-reports" hidden></div>
    </div>
    <div class="hot-side">
      <div class="hot-heat" title="热度指数：${esc(entry.participantCount)} 个独立信源各按最近一次报道的时间衰减后求和（10 倍刻度）"><b>${esc(num(entry.heat))}</b><span>热度</span></div>
      ${trendHtml(entry)}
      ${sparkline(entry.sparkline)}
    </div>
  </li>`;
        }).join('')}</ol>`;
      }

      // 事件展开后的成员报道（接口 /api/cluster/:id 的文章行）
      function storyReports(items) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '<p class="muted">暂无成员报道。</p>';
        return `<ul class="story-reports">${list.map(it => `<li>
    <a href="${url(it.url)}" target="_blank" rel="noopener">${esc(it.titleZh || it.title)}</a>
    <span class="muted">${esc(it.source || '')} · ${esc(it.tier || '')}${it.storyRelation === 'development' ? ' · 后续进展' : ''} · ${esc(ago(it.publishedAt || it.fetchedAt))}</span>
  </li>`).join('')}</ul>`;
      }

      function amountOf(deal) {
        return deal.amountText || (Number.isFinite(Number(deal.amountCny)) && deal.amountCny ? `${num(deal.amountCny / 1e8, 2)} 亿元` : '未披露');
      }

      function investorsOf(deal) {
        const leads = new Set(deal.leadInvestors || []);
        const names = deal.investors || [];
        if (!names.length) return '<span class="muted">未披露</span>';
        return names.slice(0, 6).map(name => leads.has(name) ? `<b title="领投">${esc(name)}</b>` : esc(name)).join('、') + (names.length > 6 ? ' 等' : '');
      }

      function dealList(deals, { showCompany = true, emptyText = '这个时间窗内还没有抽取到融资、上市或并购事件。' } = {}) {
        const list = Array.isArray(deals) ? deals : [];
        if (!list.length) return empty('静 候 佳 音', emptyText);
        return `<div class="deal-list${showCompany ? '' : ' compact'}" role="table" aria-label="融资与资本事件">
    <div class="deal-row deal-head" role="row"><span class="dc-date" role="columnheader">日期</span>${showCompany ? '<span class="dc-company" role="columnheader">公司</span>' : ''}<span class="dc-round" role="columnheader">轮次</span><span class="dc-amount" role="columnheader">金额</span><span class="dc-investors" role="columnheader">投资方</span><span class="dc-source" role="columnheader">报道</span></div>
    ${list.map(deal => {
      const company = deal.companyId
        ? `<button type="button" class="deal-company" data-company="${esc(deal.companyId)}">${esc(deal.companyName)}${deal.company?.watch === 2 ? '<i>被投</i>' : deal.company?.watch === 1 ? '<i>关注</i>' : ''}</button>`
        : `<span class="deal-company unregistered" title="不在公司库中，可在“新发现公司”一键收录">${esc(deal.companyName)}</span>`;
      return `<div class="deal-row" role="row">
      <span class="deal-date dc-date" role="cell" title="${deal.dateBasis === 'published' ? '报道日期，实际融资日期未披露' : deal.dateBasis === 'discovered' ? '采集日期，原文未披露日期' : '原文披露的事件日期'}">${esc(deal.date || String(deal.firstSeenAt || '').slice(0, 10))}${deal.dateBasis === 'published' ? '<small>报道</small>' : deal.dateBasis === 'discovered' ? '<small>发现</small>' : ''}</span>
      ${showCompany ? `<span class="dc-company" role="cell">${company}${domainChip(deal.domain)}</span>` : ''}
      <span class="dc-round" role="cell"><span class="deal-round">${esc(deal.round)}</span><small class="deal-status ${esc(deal.status)}">${DEAL_STATUS[deal.status] || ''}${['secondary', 'debt', 'jv'].includes(deal.kind) ? ` · ${KIND_LABEL[deal.kind]}` : ''}</small></span>
      <span class="deal-amount dc-amount" role="cell">${esc(amountOf(deal))}${TIER_LABEL[deal.tier] ? `<small class="deal-tier ${esc(deal.tier)}">${TIER_LABEL[deal.tier]}</small>` : ''}</span>
      <span class="deal-investors dc-investors" role="cell">${investorsOf(deal)}</span>
      <span class="dc-source" role="cell">${deal.article ? `<a href="${url(deal.article.url)}" target="_blank" rel="noopener" title="${esc(deal.article.title || '')}">${esc(deal.article.source || '原文')}</a>` : ''}${Number(deal.sourceCount) > 1 ? ` <small class="muted">共 ${esc(deal.sourceCount)} 篇</small>` : ''}</span>
    </div>`;
    }).join('')}
  </div>`;
      }

      function watchControl(company) {
        const level = Number(company.watch) || 0;
        return `<div class="watch-control" role="group" aria-label="关注级别">${[0, 1, 2].map(value =>
          `<button type="button" class="watch-btn${level === value ? ' active' : ''}" data-watch="${value}" data-company="${esc(company.id)}" aria-pressed="${level === value}">${WATCH_LABEL[value]}</button>`).join('')}</div>`;
      }

      function companyHeat(entries) {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) return empty('按 兵 不 动', '窗口内还没有以公司为主体的报道。公司库之外的公司，会在融资事件的“新发现公司”里出现。');
        const max = Math.max(...list.map(e => Number(e.heat) || 0), 1);
        return `<ol class="company-heat">${list.map((entry, index) => {
          const c = entry.company;
          const trend = { up: '↑ 升温', down: '↓ 降温', flat: '→ 持平', new: '新进' }[entry.trend] || '';
          return `<li class="company-heat-row glass">
    <span class="ch-rank">${index + 1}</span>
    <div class="ch-main">
      <div class="ch-name"><button type="button" class="link-btn" data-company="${esc(c.id)}">${esc(c.name)}</button>${domainChip(c.domain)}<span class="muted">${esc(c.segment || '')} · ${STATUS_LABEL[c.status] || ''}</span></div>
      ${entry.top ? `<a class="ch-top" href="${url(entry.top.url)}" target="_blank" rel="noopener">${esc(entry.top.title)}</a>` : ''}
      <div class="ch-meta">${esc(entry.participants)} 个独立信源 · ${esc(entry.reports)} 篇报道${entry.deals ? ` · 融资记录 ${esc(entry.deals)} 起` : ''}${entry.sources?.length ? ` · ${entry.sources.slice(0, 4).map(esc).join('、')}` : ''}</div>
    </div>
    <div class="ch-side">
      <div class="ch-heat"><b>${esc(num(entry.heat))}</b><i style="width:${Math.round((Number(entry.heat) || 0) / max * 100)}%"></i></div>
      <span class="ch-trend ${esc(entry.trend)}">${trend}</span>
      ${watchControl(c)}
    </div>
  </li>`;
        }).join('')}</ol>`;
      }

      function companyGrid(companies) {
        const list = Array.isArray(companies) ? companies : [];
        if (!list.length) return empty('空 空 如 也', '没有符合条件的公司。可以在右上角“收录公司”新增你的被投公司。');
        return `<div class="company-grid">${list.map(c => `<article class="company-card glass${c.watch ? ` watch-${c.watch}` : ''}${c.enabled === false ? ' is-disabled' : ''}">
    <header><button type="button" class="link-btn company-name" data-company="${esc(c.id)}">${esc(c.name)}</button>${c.custom ? '<span class="company-custom">自建</span>' : ''}</header>
    <div class="company-tags">${domainChip(c.domain)}<span>${esc(c.segment || '未分类')}</span><span class="status-${esc(c.status)}">${STATUS_LABEL[c.status] || ''}</span></div>
    ${(c.products || []).length ? `<p class="company-products">${c.products.slice(0, 4).map(esc).join('、')}</p>` : ''}
    <div class="company-stats"><span><b>${esc(c.mentions30d ?? 0)}</b> 篇 · 30 天</span><span><b>${esc(c.deals ?? 0)}</b> 起融资</span><span>${c.lastAt ? `最近 ${esc(ago(c.lastAt))}` : '暂无报道'}</span></div>
    ${watchControl(c)}
  </article>`).join('')}</div>`;
      }

      function articleList(items) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '<p class="muted">暂无相关报道。</p>';
        return `<ul class="intel-articles">${list.map(it => `<li class="${it.featured ? 'is-featured' : ''}">
    <div class="ia-head">${it.featured ? '<span class="ia-flag">精选</span>' : ''}${it.category ? `<span class="ia-cat">${esc(it.category)}</span>` : ''}<span class="muted">${esc(it.source || '')} · ${esc(ago(it.publishedAt || it.fetchedAt))}</span>${Number.isFinite(Number(it.quality)) && it.quality != null ? `<span class="ia-score">${esc(Math.round(it.quality))}</span>` : ''}</div>
    <a href="${url(it.url)}" target="_blank" rel="noopener">${esc(it.titleZh || it.title)}</a>
    ${it.summary ? `<p>${esc(it.summary)}</p>` : ''}
  </li>`).join('')}</ul>`;
      }

      function companyDetail({ company, feed, deals } = {}) {
        if (!company) return empty('查 无 此 司', '公司不存在或已被删除。');
        const aliases = (company.aliases || []).join('、');
        const products = (company.products || []).join('、');
        return `<div class="company-detail">
    <header class="company-detail-head glass">
      <button type="button" class="btn-ghost btn-compact" data-act="company-back">← 返回</button>
      <div class="cdh-title">
        <h2>${esc(company.name)}</h2>
        <div class="company-tags">${domainChip(company.domain)}<span>${esc(company.segment || '未分类')}</span><span class="status-${esc(company.status)}">${STATUS_LABEL[company.status] || ''}</span>${company.custom ? '<span class="company-custom">自建</span>' : ''}</div>
      </div>
      ${watchControl(company)}
    </header>
    <section class="glass card-pad company-alias-editor">
      <h3>识别名称 <span class="muted">报道里出现这些名字就会关联到这家公司</span></h3>
      <form data-form="company-aliases" data-company="${esc(company.id)}">
        <label class="field"><span>别名 / 简称 / 英文名（用顿号或逗号分隔）</span><input name="aliases" type="text" maxlength="400" value="${esc(aliases)}"></label>
        <label class="field"><span>代表型号 / 产品（同上）</span><input name="products" type="text" maxlength="400" value="${esc(products)}"></label>
        <div class="btn-row"><button class="btn-primary btn-compact" type="submit">保存并重新关联</button>${company.custom ? `<button class="btn-ghost btn-compact" type="button" data-act="company-remove" data-company="${esc(company.id)}">删除自建公司</button>` : ''}</div>
      </form>
    </section>
    <section class="glass card-pad">
      <h3>融资与资本事件</h3>
      ${dealList(deals, { showCompany: false })}
    </section>
    <section class="glass card-pad">
      <h3>全部相关报道</h3>
      ${articleList(feed?.items)}
    </section>
  </div>`;
      }

      function investorTable(list) {
        const rows = Array.isArray(list) ? list : [];
        if (!rows.length) return empty('虚 位 以 待', '这个时间窗内的融资报道还没有披露投资方。');
        return `<p class="intel-note">按出现的融资事件计数，同一笔融资的多篇报道只算一次；点击机构名查看它参与的全部融资。</p><div class="investor-list">${rows.map((inv, index) => `<div class="investor-row glass">
    <span class="ch-rank">${index + 1}</span>
    <div>
      <button type="button" class="link-btn" data-investor="${esc(inv.name)}" title="查看该机构参与的融资">${esc(inv.name)}</button>${(inv.domains || []).map(domainChip).join('')}
      <div class="muted">${(inv.companies || []).map(esc).join('、')}</div>
      ${(inv.stages || []).length ? `<div class="investor-stages">${inv.stages.map(s => `<span>${esc(s.label || STAGE_LABEL[s.id] || '')} ${esc(s.count)}</span>`).join('')}${inv.last ? `<span class="muted">最近 ${esc(inv.last)}</span>` : ''}</div>` : ''}
    </div>
    <span class="investor-count"><b>${esc(inv.deals)}</b> 起${inv.leads ? ` · 领投 ${esc(inv.leads)}` : ''}</span>
  </div>`).join('')}</div>`;
      }

      // ---------- 一级市场 · 概览 ----------
      function yi(value) {
        const n = Number(value) || 0;
        if (n >= 1e8) return `${num(n / 1e8, n >= 1e10 ? 0 : 1)} 亿元`;
        if (n >= 1e4) return `${num(n / 1e4, 0)} 万元`;
        return n ? `${num(n, 0)} 元` : '—';
      }

      function barList(items, { total = null, action = null, tone = 'flag' } = {}) {
        const list = (Array.isArray(items) ? items : []).filter(i => i && i.count != null);
        const max = Math.max(1, ...list.map(i => Number(i.count) || 0));
        const sum = total ?? list.reduce((s, i) => s + (Number(i.count) || 0), 0);
        return `<ul class="cap-bars ${tone}">${list.map(item => {
          const count = Number(item.count) || 0;
          const pct = sum ? Math.round(count / sum * 100) : 0;
          const label = `<span class="cb-label">${esc(item.label)}</span>`;
          const bar = `<span class="cb-track" aria-hidden="true"><i style="width:${Math.round(count / max * 100)}%"></i></span><span class="cb-num">${esc(count)}<small>${pct}%</small></span>`;
          return action && count && item.id
            ? `<li><button type="button" class="cb-row" data-${action}="${esc(item.id)}" aria-label="${esc(item.label)} ${esc(count)} 起，点击查看">${label}${bar}</button></li>`
            : `<li><div class="cb-row${count ? '' : ' is-zero'}">${label}${bar}</div></li>`;
        }).join('')}</ul>`;
      }

      function monthlyChart(monthly) {
        const list = Array.isArray(monthly) ? monthly : [];
        if (!list.length) return '';
        const max = Math.max(1, ...list.map(m => Number(m.total) || 0));
        return `<div class="cap-months" role="img" aria-label="${esc(list.map(m => `${m.month} ${m.total} 起`).join('，'))}">${list.map(m => {
          const la = Number(m.lowaltitude) || 0, ae = Number(m.aerospace) || 0, other = Math.max(0, (Number(m.total) || 0) - la - ae);
          const h = v => `${Math.round(v / max * 100)}%`;
          return `<div class="cm-col" title="${esc(m.month)}：低空 ${la} · 航天 ${ae}${other ? ` · 其他 ${other}` : ''}">
      <span class="cm-total">${esc(m.total || '')}</span>
      <div class="cm-stack"><i class="ae" style="height:${h(ae)}"></i><i class="la" style="height:${h(la)}"></i>${other ? `<i class="ot" style="height:${h(other)}"></i>` : ''}</div>
      <span class="cm-label">${esc(String(m.month).slice(5))}月</span>
    </div>`;
        }).join('')}</div>
    <div class="cap-legend"><span><i class="la"></i>低空经济</span><span><i class="ae"></i>商业航天</span></div>`;
      }

      function miniDeals(deals, emptyText) {
        const list = Array.isArray(deals) ? deals : [];
        if (!list.length) return `<p class="muted cap-empty">${esc(emptyText)}</p>`;
        return `<ul class="cap-mini">${list.map(d => `<li>
    ${d.companyId ? `<button type="button" class="link-btn" data-company="${esc(d.companyId)}">${esc(d.companyName)}</button>` : `<b>${esc(d.companyName)}</b>`}${domainChip(d.domain)}
    <span class="cap-mini-meta"><span class="deal-round">${esc(d.round)}</span> · ${esc(amountOf(d))} · ${esc(d.date || '')}</span>
    ${d.article?.url ? `<a class="cap-mini-src" href="${url(d.article.url)}" target="_blank" rel="noopener" title="${esc(d.article.title || '')}">原文</a>` : ''}
  </li>`).join('')}</ul>`;
      }

      function capitalOverview(o) {
        if (!o || !o.totals) return empty('静 候 佳 音', '暂无一级市场数据。');
        const t = o.totals;
        if (!t.deals) {
          return empty('静 候 佳 音', `近 ${o.days || 90} 天还没有抽取到一级市场融资事件。采集与分析完成后会自动出现；也可以放宽时间窗。`);
        }
        const share = t.deals ? Math.round((t.lowaltitude || 0) / t.deals * 100) : 0;
        const tiles = [
          ['融资事件', `${t.deals}`, `${t.completed} 起已完成${t.rumored ? ` · ${t.rumored} 起传闻` : ''}`],
          ['涉及公司', `${t.companies}`, `${t.withInvestors} 起披露投资方`],
          ['亿元级以上', `${t.largeRounds}`, '按原文金额量级估算'],
          ['明确披露金额', yi(t.disclosedCny), `${t.disclosedCount} 起写明人民币数字`],
          ['领域分布', `${t.lowaltitude} : ${t.aerospace}`, `低空 ${share}% · 航天 ${100 - share}%`]
        ];
        return `<div class="cap-overview">
    <div class="cap-kpis">${tiles.map(([label, value, hint]) => `<div class="cap-kpi glass"><span class="ck-label">${esc(label)}</span><b class="ck-value">${esc(value)}</b><span class="ck-hint">${esc(hint)}</span></div>`).join('')}</div>
    <div class="cap-grid">
      <section class="glass card-pad cap-card"><h3>融资阶段 <span class="muted">点击查看该阶段明细</span></h3>${barList(o.stages, { action: 'deal-stage' })}</section>
      <section class="glass card-pad cap-card"><h3>金额量级 <span class="muted">外币与约数仅用于分档</span></h3>${barList(o.tiers, { tone: 'accent' })}</section>
      <section class="glass card-pad cap-card"><h3>月度节奏 <span class="muted">按融资或报道日期</span></h3>${monthlyChart(o.monthly)}</section>
      <section class="glass card-pad cap-card"><h3>热门赛道 <span class="muted">仅统计公司库内公司</span></h3>${o.segments?.length ? barList(o.segments, { tone: 'second' }) : '<p class="muted cap-empty">融资主体尚未收录到公司库，收录后按赛道统计。</p>'}</section>
      <section class="glass card-pad cap-card"><h3>大额融资</h3>${miniDeals(o.large, '窗口内没有披露金额的融资。')}</section>
      <section class="glass card-pad cap-card"><h3>上市进程 <span class="muted">IPO · 辅导 · Pre-IPO</span></h3>${miniDeals(o.pipeline, '窗口内没有上市辅导、IPO 或 Pre-IPO 报道。')}</section>
      <section class="glass card-pad cap-card cap-wide"><h3>活跃机构</h3>${o.investors?.length ? `<ol class="cap-investors">${o.investors.map(inv => `<li><button type="button" class="link-btn" data-investor="${esc(inv.name)}">${esc(inv.name)}</button><span class="muted">${esc(inv.deals)} 起${inv.leads ? ` · 领投 ${esc(inv.leads)}` : ''} · ${(inv.companies || []).slice(0, 3).map(esc).join('、')}</span></li>`).join('')}</ol>` : '<p class="muted cap-empty">窗口内的融资报道尚未披露投资方。</p>'}</section>
    </div>
    ${t.excluded ? `<p class="intel-note cap-excluded">另有 ${esc(t.excluded)} 起${(o.excludedKinds || []).map(k => `${esc(k.label)} ${esc(k.count)}`).join('、') ? `（${(o.excludedKinds || []).map(k => `${esc(k.label)} ${esc(k.count)} 起`).join('、')}）` : ''}不属于一级市场股权交易，未计入统计；可在“融资动态”的事件性质里查看。</p>` : ''}
  </div>`;
      }

      // 融资动态的筛选工具条：阶段、事件性质、排序、导出
      function dealTools(view = {}) {
        const stages = [['', '全部阶段'], ...Object.entries(STAGE_LABEL)];
        const kinds = [['primary', '一级市场交易'], ['equity', '仅股权融资'], ['ipo', '仅上市进程'], ['ma', '仅并购与转让'], ['all', '全部（含再融资、债权、合资）']];
        const sorts = [['date', '按日期'], ['amount', '按金额量级'], ['sources', '按报道数']];
        const option = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
        return `<div class="deal-tools">
    <div class="deal-stages" role="group" aria-label="融资阶段">${stages.map(([id, label]) => `<button type="button" class="chip${(view.stage || '') === id ? ' active' : ''}" data-deal-stage="${esc(id)}" aria-pressed="${(view.stage || '') === id}">${esc(label)}</button>`).join('')}</div>
    <div class="deal-controls">
      <label class="intel-select"><span>性质</span><select data-deal-kind aria-label="事件性质">${kinds.map(([v, l]) => option(v, l, view.kind || 'primary')).join('')}</select></label>
      <label class="intel-select"><span>排序</span><select data-deal-sort aria-label="排序方式">${sorts.map(([v, l]) => option(v, l, view.sort || 'date')).join('')}</select></label>
      <button type="button" class="btn-ghost btn-compact" data-act="deals-export" data-format="csv" title="导出为 Excel 可直接打开的 CSV">导出 CSV</button>
      <button type="button" class="btn-ghost btn-compact" data-act="deals-export" data-format="markdown">导出 .md</button>
    </div>
  </div>`;
      }

      function discoveredList(list) {
        const rows = Array.isArray(list) ? list : [];
        if (!rows.length) return '';
        return `<section class="glass card-pad discovered">
    <h3>新发现公司 <span class="muted">融资主体不在公司库，一键收录后开始专门跟踪</span></h3>
    <ul>${rows.map(row => `<li><b>${esc(row.name)}</b>${domainChip(row.domain)}<span class="muted">${(row.rounds || []).map(esc).join('、')} · ${esc(row.last || '')}</span>
      <button type="button" class="btn-ghost btn-compact" data-act="company-adopt" data-name="${esc(row.name)}" data-domain="${esc(row.domain || '')}">收录并关注</button></li>`).join('')}</ul>
  </section>`;
      }

      // ---------- 日报 / 周报 / 月报 ----------
      function issueItem(it) {
        return `<div class="daily-item">
    <span class="di-score">${Number.isFinite(Number(it.score)) && it.score != null ? Math.round(it.score) : '—'}</span>
    <div>
      <a href="${url(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
      ${it.summary ? `<div class="di-meta">${esc(it.summary)}</div>` : ''}
      ${it.reason ? `<div class="di-meta di-reason">${esc(it.reason)}</div>` : ''}
      <div class="di-meta">${esc(it.source || '')} · ${esc(it.tier || '')} · ${DOMAIN_LABEL[it.domain] || ''}${Number(it.storySize) > 1 ? ` · ${esc(it.storySize)} 篇关联报道` : ''}</div>
    </div>
  </div>`;
      }

      // parts 决定版块与顺序：日报把导语与热点放在分类精选之前，一级市场等放在之后
      const ALL_PARTS = Object.freeze(['lead', 'hot', 'sections', 'deals', 'portfolio', 'companies', 'breakthroughs']);
      function issueBlocks(issue, { parts: wanted = ALL_PARTS } = {}) {
        if (!issue) return '';
        const blocks = {};
        if (issue.lead) {
          blocks.lead = (`<section class="issue-lead glass"><span class="issue-kicker">${issue.leadSource === 'model' ? '主编导语' : '本期概览'}</span><p>${esc(issue.lead)}</p>
    ${issue.totals ? `<div class="issue-totals"><span><b>${esc(issue.totals.relevant)}</b> 条相关</span><span><b>${esc(issue.totals.featured)}</b> 条精选</span><span><b>${esc(issue.totals.stories ?? 0)}</b> 个事件</span><span><b>${esc(issue.totals.deals ?? 0)}</b> 起资本事件</span></div>` : ''}</section>`);
        }
        if (issue.hot?.length) {
          blocks.hot = (`<section class="daily-section glass issue-hot"><div class="daily-section-title">热点事件</div>${issue.hot.map((h, i) => `<div class="daily-item">
    <span class="di-score">${i + 1}</span>
    <div><a href="${url(h.representative?.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>
    ${h.digest ? `<div class="di-meta">${esc(h.digest)}</div>` : ''}
    <div class="di-meta">${DOMAIN_LABEL[h.domain] || ''} · ${esc(h.participants)} 个独立信源 · ${esc(h.reports)} 篇报道${h.sources?.length ? ` · ${h.sources.slice(0, 4).map(esc).join('、')}` : ''}</div></div>
  </div>`).join('')}</section>`);
        }
        if (issue.sections?.length) {
          blocks.sections = issue.sections.map(section =>
            `<section class="daily-section glass"><div class="daily-section-title">${esc(section.category)}</div>${section.items.map(issueItem).join('')}</section>`).join('');
        }
        if (issue.deals?.length) {
          blocks.deals = (`<section class="daily-section glass issue-deals"><div class="daily-section-title">一级市场 · 融资与资本事件</div>${dealList(issue.deals)}${issue.investors?.length ? `<p class="di-meta issue-investors">活跃机构：${issue.investors.slice(0, 8).map(i => `${esc(i.name)}（${esc(i.deals)}）`).join('、')}</p>` : ''}</section>`);
        }
        if (issue.portfolio?.length) {
          blocks.portfolio = (`<section class="daily-section glass issue-portfolio"><div class="daily-section-title">我的关注 · 被投与关注公司动态</div>${issue.portfolio.map(p => `<div class="portfolio-block"><div class="portfolio-name"><button type="button" class="link-btn" data-company="${esc(p.id)}">${esc(p.name)}</button><span class="watch-tag watch-${esc(p.watch)}">${WATCH_LABEL[p.watch] || ''}</span></div>${p.items.map(issueItem).join('')}</div>`).join('')}</section>`);
        }
        if (issue.companies?.length) {
          blocks.companies = (`<section class="daily-section glass issue-companies"><div class="daily-section-title">公司声量榜</div><ol class="issue-company-board">${issue.companies.slice(0, 12).map(c => `<li><button type="button" class="link-btn" data-company="${esc(c.id)}">${esc(c.name)}</button>${domainChip(c.domain)}<span class="muted">${esc(c.participants)} 个信源 · ${esc(c.reports)} 篇${c.featured ? ` · 精选 ${esc(c.featured)}` : ''}</span></li>`).join('')}</ol></section>`);
        }
        if (issue.breakthroughs?.length) {
          blocks.breakthroughs = (`<section class="daily-section glass issue-breakthroughs"><div class="daily-section-title">技术突破</div>${issue.breakthroughs.map(issueItem).join('')}</section>`);
        }
        return wanted.map(name => blocks[name] || '').join('');
      }

      function industryInfo(info) {
        if (!info) return '';
        const axes = info.axes || {};
        const axisKeys = Object.keys(axes);
        const thresholds = Object.entries(info.thresholds || {})
          .map(([tier, value]) => `<span class="threshold-chip"><b>${esc(tier)}</b> ${esc(value)}</span>`).join('');
        const rows = (info.itemTypes || []).map(type => `<tr><th scope="row">${esc(type.label)}<small>${esc(type.category)}</small></th>${axisKeys.map(axis => `<td>${esc(type.weights?.[axis] ?? '')}</td>`).join('')}</tr>`).join('');
        const budget = info.budget || {};
        const prompts = (info.prompts || []).filter(p => !p.name.startsWith('rules-') && p.name !== 'safety')
          .map(p => `<code title="提示词内容哈希，改提示词后自动变化">${esc(p.name)}@${esc(p.version || '—')}</code>`).join(' ');
        return `<div class="industry-thresholds"><span class="muted">入选门槛（两次评分平均）</span>${thresholds}</div>
  <table class="weight-table"><thead><tr><th scope="col">内容类型</th>${axisKeys.map(axis => `<th scope="col">${esc(axes[axis])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
  <p class="industry-budget">模型调用：本小时 <b>${esc(budget.hourCalls ?? 0)}</b> / ${esc(budget.maxCallsPerHour ?? '–')}，今日 <b>${esc(budget.dayCalls ?? 0)}</b> / ${esc(budget.maxCallsPerDay ?? '–')}；已存回执 ${esc(budget.receipts ?? 0)} 份（重试与重跑直接复用，不重复付费）。</p>
  <p class="industry-prompts">${prompts}</p>`;
      }

      return Object.freeze({
        industryInfo, sparkline, hotList, storyReports, dealList, companyHeat, companyGrid, companyDetail,
        investorTable, discoveredList, articleList, issueBlocks, issueItem, empty, capitalOverview, dealTools
      });
    }

    return Object.freeze({ createIntelRender, DOMAIN_LABEL, STATUS_LABEL, WATCH_LABEL });
  })();

  /* 摘星阁 · 当前热点视图（v0.2.0）
     AIHOT 式热点榜：按事件而不是按文章排，48 小时内每个独立信源只算一次、24 小时减半。
     视图只读 /api/hot 已算好的榜单；展开一个事件时再取它的成员报道。
     依赖全部注入，工厂体不直读 window/document。 */
  const HotViewController = (function createHotViewControllerModule() {
    function createHotViewController({ api, esc, render, skeletons, requestGuard, onCompany, elements } = {}) {
      if (typeof api !== 'function' || typeof esc !== 'function' || !render
        || typeof skeletons !== 'function' || !requestGuard || !elements?.body) {
        throw new TypeError('hot view controller requires api, esc, render, skeletons, requestGuard and elements.body');
      }
      let domain = '';

      function describe(data) {
        if (!elements.meta) return;
        const at = data.computedAt ? new Date(data.computedAt) : null;
        const time = at && Number.isFinite(at.getTime()) ? at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '–';
        elements.meta.textContent = `${data.entries.length} 个热点事件 · 计算于 ${time} · 近 ${data.windowHours} 小时、每个独立信源只算一次、${data.halfLifeHours} 小时减半、至少 ${data.minParticipants} 个信源`;
      }

      async function loadHot() {
        const request = requestGuard.begin();
        elements.body.innerHTML = skeletons(3);
        try {
          const data = await api('/api/hot' + (domain ? `?domain=${domain}` : ''));
          if (!request.isCurrent()) return;
          describe(data);
          elements.body.innerHTML = render.hotList(data.entries, data);
        } catch (error) {
          if (!request.isCurrent()) return;
          elements.body.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>热点加载失败：${esc(error.message)}</p>
        <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-hot">重试</button></div>`;
        }
      }

      async function toggleStory(button) {
        const item = button.closest('.hot-item');
        const box = item?.querySelector('.hot-reports');
        if (!box) return;
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!open));
        if (open) { box.hidden = true; return; }
        box.hidden = false;
        if (box.dataset.loaded === '1') return;
        box.innerHTML = '<p class="muted">正在读取成员报道…</p>';
        try {
          const items = await api(`/api/cluster/${Number(button.dataset.story)}`);
          box.innerHTML = render.storyReports(items);
          box.dataset.loaded = '1';
        } catch (error) {
          box.innerHTML = `<p class="muted">读取失败：${esc(error.message)}</p>`;
        }
      }

      elements.body.addEventListener('click', event => {
        if (event.target.closest('[data-act="retry-hot"]')) { loadHot(); return; }
        const story = event.target.closest('[data-act="story"]');
        if (story) { toggleStory(story); return; }
        const company = event.target.closest('[data-company]');
        if (company && typeof onCompany === 'function') onCompany(company.dataset.company);
      });

      if (elements.domains) {
        elements.domains.addEventListener('click', event => {
          const chip = event.target.closest('[data-hot-domain]');
          if (!chip) return;
          domain = chip.dataset.hotDomain;
          for (const other of elements.domains.querySelectorAll('[data-hot-domain]')) {
            const on = other === chip;
            other.classList.toggle('active', on);
            other.setAttribute('aria-pressed', String(on));
          }
          loadHot();
        });
      }

      return Object.freeze({ loadHot });
    }

    return Object.freeze({ createHotViewController });
  })();

  /* 摘星阁 · 一级市场视图（v0.2.0）
     四个分区：融资动态（融资/上市/并购事件，含“新发现公司”）、公司热度、公司库、活跃机构；
     任意位置点公司名进入公司档案（别名编辑、融资记录、全部相关报道）。
     关注 / 被投标记写回本机库；标记关注时服务端会为该公司补一条检索线。
     依赖全部注入，工厂体不直读 window/document。 */
  const CapitalViewController = (function createCapitalViewControllerModule() {
    const TABS = Object.freeze(['overview', 'deals', 'activity', 'heat', 'companies', 'investors']);
    const WATCH_TEXT = Object.freeze({ 0: '已取消标记', 1: '已标记为关注', 2: '已标记为被投' });

    function splitNames(value) {
      return String(value || '').split(/[、,，;；\n]/).map(s => s.trim()).filter(Boolean).slice(0, 24);
    }

    function createCapitalViewController({
      api, esc, render, skeletons, toast, confirm, requestGuard, elements, saveText = null
    } = {}) {
      if (typeof api !== 'function' || typeof esc !== 'function' || !render
        || typeof skeletons !== 'function' || typeof toast !== 'function' || !requestGuard || !elements?.body) {
        throw new TypeError('capital view controller requires api, esc, render, skeletons, toast, requestGuard and elements.body');
      }
      const view = { tab: 'overview', domain: '', days: 90, watched: false, q: '', companyId: null, stage: '', kind: 'primary', sort: 'date' };
      let searchTimer = null;

      function query(params) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value !== '' && value != null && value !== false) search.set(key, String(value));
        const text = search.toString();
        return text ? `?${text}` : '';
      }

      function syncToolbar() {
        for (const tab of elements.tabs?.querySelectorAll('[data-capital-tab]') || []) {
          const on = !view.companyId && tab.dataset.capitalTab === view.tab;
          tab.classList.toggle('active', on);
          tab.setAttribute('aria-selected', String(on));
        }
        if (elements.search) elements.search.hidden = Boolean(view.companyId);
        if (elements.days) elements.days.disabled = !['overview', 'deals', 'activity', 'investors'].includes(view.tab);
      }

      async function show(loader) {
        const request = requestGuard.begin();
        elements.body.innerHTML = skeletons(3);
        try {
          const html = await loader();
          if (!request.isCurrent()) return;
          elements.body.innerHTML = html;
        } catch (error) {
          if (!request.isCurrent()) return;
          elements.body.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>加载失败：${esc(error.message)}</p>
        <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-capital">重试</button></div>`;
        }
      }

      function load() {
        syncToolbar();
        if (view.companyId) {
          const id = view.companyId;
          return show(async () => render.companyDetail(await api(`/api/companies/${encodeURIComponent(id)}`)));
        }
        if (view.tab === 'overview') {
          return show(async () => render.capitalOverview(await api('/api/capital/overview'
            + query({ days: view.days, domain: view.domain, watched: view.watched ? 1 : '', q: view.q }))));
        }
        if (view.tab === 'deals') {
          return show(async () => {
            const data = await api('/api/deals' + dealQuery());
            const filtered = view.stage || view.kind !== 'primary' || view.q;
            return render.dealTools(view) + render.dealList(data.deals, filtered
              ? { emptyText: '当前筛选条件下没有融资事件，可放宽阶段、性质或时间窗。' } : {}) + render.discoveredList(data.discovered);
          });
        }
        if (view.tab === 'activity') {
          return show(async () => {
            const data = await api('/api/capital/activity' + query({ days: view.days, domain: view.domain, watched: view.watched ? 1 : '', q: view.q }));
            return '<p class="intel-note">未上市及状态待核公司的融资、订单、取证与试验进展，同一事件仅展示最近报道。最多展示 120 条。</p>' + (data.items.length ? render.articleList(data.items) : render.empty('暂 无 动 态', '当前筛选条件下暂无企业动态，可调整时间窗或企业名称。'));
          });
        }
        if (view.tab === 'heat') {
          return show(async () => {
            const data = await api('/api/companies/heat' + query({ domain: view.domain, watched: view.watched ? 1 : '', q: view.q }));
            return `<p class="intel-note">近 ${esc(data.windowDays)} 天以公司为主体的报道，每个独立出版方只算一次，${esc(data.halfLifeHours)} 小时减半。</p>${render.companyHeat(data.entries)}`;
          });
        }
        if (view.tab === 'companies') {
          return show(async () => render.companyGrid(await api('/api/companies'
            + query({ domain: view.domain, watch: view.watched ? 'watched' : '', q: view.q }))));
        }
        return show(async () => {
          const data = await api('/api/deals' + query({ days: view.days, domain: view.domain, watched: view.watched ? 1 : '', q: view.q }));
          return render.investorTable(data.investors);
        });
      }

      function dealQuery(extra = {}) {
        return query({ days: view.days, domain: view.domain, watched: view.watched ? 1 : '', q: view.q,
          stage: view.stage, kind: view.kind === 'primary' ? '' : view.kind, sort: view.sort === 'date' ? '' : view.sort, ...extra });
      }

      function switchTab(tab) {
        view.tab = tab;
        view.companyId = null;
        return load();
      }

      // 本地另存为：blob + a[download]，不经过任何外部服务
      function save(filename, text) {
        if (typeof saveText === 'function') return saveText(filename, text);
        const doc = globalThis.document;
        if (!doc) return;
        const blob = new Blob([`\ufeff${text}`], { type: filename.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8' });
        const href = URL.createObjectURL(blob);
        const anchor = doc.createElement('a');
        anchor.href = href;
        anchor.download = filename;
        doc.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      }

      async function exportDeals(format) {
        try {
          const result = await api('/api/deals/export' + dealQuery({ format }));
          if (!result.count) { toast('当前筛选条件下没有可导出的融资事件', true); return; }
          save(result.filename, result.content);
          toast(`已导出 ${result.count} 起融资事件到 ${result.filename}`);
        } catch (error) { toast('导出失败：' + error.message, true); }
      }

      function openCompany(id) {
        if (!id) return;
        view.companyId = String(id);
        return load();
      }

      async function setWatch(id, level) {
        try {
          const result = await api(`/api/companies/${encodeURIComponent(id)}/watch`, { body: { watch: Number(level) } });
          toast(`${result.name}：${WATCH_TEXT[level] || '已更新'}${result.sourceCreated ? '，已自动新增检索线' : ''}`);
          load();
        } catch (error) {
          toast('标记失败：' + error.message, true);
        }
      }

      async function adopt(name, domain) {
        try {
          const result = await api('/api/companies', { body: { name, domain: domain || null, watch: 1 } });
          toast(`已收录「${result.company.name}」，关联历史报道 ${result.linked} 篇${result.sourceCreated ? '，并新增检索线' : ''}`);
          load();
        } catch (error) {
          toast('收录失败：' + error.message, true);
        }
      }

      elements.body.addEventListener('click', async event => {
        if (event.target.closest('[data-act="retry-capital"]')) { load(); return; }
        if (event.target.closest('[data-act="company-back"]')) { view.companyId = null; load(); return; }
        const exportButton = event.target.closest('[data-act="deals-export"]');
        if (exportButton) { exportDeals(exportButton.dataset.format); return; }
        const stageChip = event.target.closest('[data-deal-stage]');
        if (stageChip) { view.stage = stageChip.dataset.dealStage || ''; switchTab('deals'); return; }
        const investor = event.target.closest('[data-investor]');
        if (investor) {
          // 机构名 → 融资动态里检索它参与的全部融资（检索覆盖投资方字段）
          view.q = investor.dataset.investor.slice(0, 40);
          if (elements.search) elements.search.value = view.q;
          view.stage = '';
          switchTab('deals');
          return;
        }
        const watch = event.target.closest('[data-watch]');
        if (watch) { setWatch(watch.dataset.company, watch.dataset.watch); return; }
        const adoptButton = event.target.closest('[data-act="company-adopt"]');
        if (adoptButton) { adopt(adoptButton.dataset.name, adoptButton.dataset.domain); return; }
        const remove = event.target.closest('[data-act="company-remove"]');
        if (remove) {
          const ok = typeof confirm === 'function'
            ? await confirm('删除后这家自建公司的关联标记一并移除，报道本身不受影响。', { title: '删除自建公司', okText: '删除' })
            : true;
          if (!ok) return;
          try {
            await api(`/api/companies/${encodeURIComponent(remove.dataset.company)}`, { method: 'DELETE' });
            toast('已删除自建公司');
            view.companyId = null;
            load();
          } catch (error) { toast('删除失败：' + error.message, true); }
          return;
        }
        const company = event.target.closest('[data-company]');
        if (company) openCompany(company.dataset.company);
      });

      elements.body.addEventListener('change', event => {
        const kind = event.target.closest('[data-deal-kind]');
        if (kind) { view.kind = kind.value || 'primary'; load(); return; }
        const sort = event.target.closest('[data-deal-sort]');
        if (sort) { view.sort = sort.value || 'date'; load(); }
      });

      elements.body.addEventListener('submit', async event => {
        const form = event.target.closest('[data-form="company-aliases"]');
        if (!form) return;
        event.preventDefault();
        try {
          const result = await api(`/api/companies/${encodeURIComponent(form.dataset.company)}`, {
            method: 'PATCH',
            body: { aliases: splitNames(form.elements.aliases.value), products: splitNames(form.elements.products.value) }
          });
          toast(`已保存，重新关联报道 ${result.linked} 篇`);
          load();
        } catch (error) { toast('保存失败：' + error.message, true); }
      });

      elements.tabs?.addEventListener('click', event => {
        const tab = event.target.closest('[data-capital-tab]');
        if (!tab || !TABS.includes(tab.dataset.capitalTab)) return;
        switchTab(tab.dataset.capitalTab);
      });
      elements.domains?.addEventListener('click', event => {
        const chip = event.target.closest('[data-capital-domain]');
        if (!chip) return;
        view.domain = chip.dataset.capitalDomain;
        for (const other of elements.domains.querySelectorAll('[data-capital-domain]')) {
          other.classList.toggle('active', other === chip);
          other.setAttribute('aria-pressed', String(other === chip));
        }
        view.companyId = null;
        load();
      });
      elements.days?.addEventListener('change', () => {
        view.days = Number(elements.days.value) || 90;
        load();
      });
      elements.watched?.addEventListener('change', () => {
        view.watched = Boolean(elements.watched.checked);
        view.companyId = null;
        load();
      });
      elements.search?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { view.q = elements.search.value.trim().slice(0, 40); load(); }, 260);
      });

      // 收录公司表单
      elements.addButton?.addEventListener('click', () => {
        if (!elements.addForm) return;
        elements.addForm.hidden = !elements.addForm.hidden;
        if (!elements.addForm.hidden) elements.addForm.elements.name?.focus();
      });
      elements.addForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = elements.addForm;
        try {
          const result = await api('/api/companies', {
            body: {
              name: form.elements.name.value.trim(),
              aliases: splitNames(form.elements.aliases.value),
              products: splitNames(form.elements.products.value),
              domain: form.elements.domain.value || null,
              segment: form.elements.segment.value.trim(),
              watch: Number(form.elements.watch.value)
            }
          });
          toast(`已收录「${result.company.name}」，关联历史报道 ${result.linked} 篇${result.sourceCreated ? '，并新增检索线' : ''}`);
          form.reset();
          form.hidden = true;
          openCompany(result.company.id);
        } catch (error) { toast('收录失败：' + error.message, true); }
      });
      elements.addForm?.addEventListener('reset', () => { elements.addForm.hidden = true; });

      return Object.freeze({ load, openCompany, switchTab, state: () => ({ ...view }) });
    }

    return Object.freeze({ createCapitalViewController, splitNames });
  })();

  // The release view shares this view-module boundary and uses no Markdown runtime.
  const ReleaseLog = (function createReleaseLogModule() {
    function renderMarkdown(source, { esc, safeUrl }) {
      function inline(value) {
        const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
        let output = '', cursor = 0, match;
        while ((match = pattern.exec(value))) {
          output += esc(value.slice(cursor, match.index));
          if (match[1]) output += `<a href="${esc(safeUrl(match[2]))}" target="_blank" rel="noopener noreferrer">${esc(match[1])}</a>`;
          else if (match[3]) output += `<code>${esc(match[3])}</code>`;
          else output += `<strong>${esc(match[4])}</strong>`;
          cursor = pattern.lastIndex;
        }
        return output + esc(value.slice(cursor));
      }
      const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
      let output = '', paragraph = [], list = [], code = null;
      function flush() {
        if (paragraph.length) output += `<p>${inline(paragraph.join('\n'))}</p>`;
        if (list.length) output += `<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`;
        paragraph = []; list = [];
      }
      for (const line of lines) {
        if (/^\s*```/.test(line)) {
          flush();
          if (code !== null) { output += `<pre><code>${esc(code.join('\n'))}</code></pre>`; code = null; }
          else code = [];
        } else if (code !== null) code.push(line);
        else if (!line.trim()) flush();
        else if (/^#{1,6}\s/.test(line)) { flush(); output += `<h4>${inline(line.replace(/^#{1,6}\s+/, ''))}</h4>`; }
        else if (/^\s*[-*]\s/.test(line)) {
          if (paragraph.length) flush();
          list.push(line.replace(/^\s*[-*]\s+/, ''));
        } else { if (list.length) flush(); paragraph.push(line); }
      }
      flush();
      if (code !== null) output += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
      return output;
    }

    function createReleaseLogController({ api, esc, safeUrl, elements } = {}) {
      let history = null, query = '', rendered = '', loading = null;
      const expanded = new Set();
      function render() {
        if (!history) return;
        const versionQuery = /^v?\d+\.\d+\.\d+(?:\.\d+)?$/.test(query) ? `v${query.replace(/^v/, '')}` : null;
        const items = history.items.filter(item => versionQuery ? item.tag === versionQuery
          : `${item.tag}\n${item.name}\n${item.body}`.toLowerCase().includes(query));
        const stamp = JSON.stringify([history.items, query, history.currentVersion]);
        if (stamp !== rendered) {
          const focus = elements.list.ownerDocument?.activeElement?.closest('[data-release-tag]')?.dataset.releaseTag;
          elements.list.innerHTML = items.length ? items.map(item => {
            const current = item.tag === `v${history.currentVersion}`;
            const date = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' }) : '本次更新';
            const intro = item.body.split(/\r?\n/).find(line => line.trim() && !/^[#`]/.test(line)) || item.name;
            return `<details class="release-entry glass" data-release-tag="${esc(item.tag)}"${expanded.has(item.tag) || (query && items.length < 6) ? ' open' : ''}>
              <summary><span class="release-version">${esc(item.tag)}</span><span class="release-summary"><strong>${esc(item.name)}${current ? '<span class="release-current">当前版本</span>' : ''}</strong><span>${esc(intro.replace(/\*\*/g, '').slice(0, 160))}</span></span><time datetime="${esc(item.publishedAt || '')}">${esc(date)}</time><span class="release-chevron" aria-hidden="true">⌄</span></summary>
              <div class="release-body">${renderMarkdown(item.body, { esc, safeUrl })}<a class="release-original" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">查看 GitHub 原文 ↗</a></div>
            </details>`;
          }).join('') : '<div class="empty-state glass"><p>没有找到匹配的版本或更新内容。</p></div>';
          if (focus) [...elements.list.querySelectorAll('[data-release-tag]')].find(node => node.dataset.releaseTag === focus)?.querySelector('summary')?.focus({ preventScroll: true });
          rendered = stamp;
        }
        const last = history.lastSyncedAt ? ` · 最近同步 ${new Date(history.lastSyncedAt).toLocaleString('zh-CN')}` : '';
        elements.meta.textContent = `${query ? `${items.length} / ` : ''}${history.items.length} 个版本 · 当前 v${history.currentVersion}${last}${history.syncError ? ` · ${history.syncError}` : ''}`;
      }
      async function sync() {
        if (loading) return loading;
        elements.sync.disabled = true;
        elements.sync.textContent = '同步中…';
        loading = (async () => {
          try { history = await api('/api/releases?sync=1'); render(); }
          catch { elements.meta.textContent = '暂时无法同步，已保留当前更新日志。'; }
          finally { elements.sync.disabled = false; elements.sync.textContent = '同步日志'; loading = null; }
        })();
        return loading;
      }
      async function load() {
        try {
          const initial = !history;
          history = await api('/api/releases');
          if (initial) expanded.add(`v${history.currentVersion}`);
          render();
          return sync();
        } catch { elements.meta.textContent = '读取更新日志失败，请点击同步日志重试。'; }
      }
      elements.search.addEventListener('input', () => { query = elements.search.value.trim().toLowerCase(); render(); });
      elements.sync.addEventListener('click', sync);
      elements.list.addEventListener('toggle', event => {
        const tag = event.target.dataset?.releaseTag;
        if (tag) event.target.open ? expanded.add(tag) : expanded.delete(tag);
      }, true);
      return Object.freeze({ load, sync });
    }
    return Object.freeze({ renderMarkdown, createReleaseLogController });
  })();

  const api = Object.freeze({ IntelRender, HotViewController, CapitalViewController, ReleaseLog });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
