'use strict';

/* 摘星阁 · 信息流卡片表示层（纯函数 + 模板渲染 + 增量 diff）
   阶段 3 批 1 自 app.js 抽离：评分胶囊、技术突破呈现、实体标签、
   原子事件与骨架屏等不依赖页面状态的表示层纯函数。esc/safeHttpUrl
   与时间格式化一律走依赖注入，工厂体内不出现 window/document 直读。
   阶段 4 接管卡片整卡模板：cardInner 迁为 index.html 中的
   <template id="cardTemplate">，createCardRenderer 提供 cloneNode(true)
   + 字段级填充；renderTimeline（日期分组头 sticky、分组逻辑）
   同批迁入；createFeedDiffList 提供按 data-id 调和的增量渲染器。 */

(function exposeFeedCard(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.FeedCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFeedCardModule() {
  // 实体类型 → 中文短标签。只用于 title 提示，不占卡片版面。
  const ENTITY_TYPE_NAMES = Object.freeze({
    org: '机构', product: '型号', facility: '场站', place: '地域', person: '人物', policy: '政策'
  });
  // 动作类 → 中文。原子事件里模型写的动作原文各式各样，
  // 归类之后才好在卡片上给出一致的措辞。
  const EVENT_CLASS_NAMES = Object.freeze({
    launch: '发射入轨', recovery: '回收复用', 'flight-test': '试飞验证',
    certification: '适航取证', funding: '融资', listing: '上市',
    order: '订单中标', delivery: '交付量产', partnership: '合作签约',
    policy: '政策发布', facility: '场站基建', research: '研制试验',
    personnel: '人事组织', incident: '异常与延期'
  });

  function createFeedCard({ esc, safeHttpUrl, format } = {}) {
    if (typeof esc !== 'function' || typeof safeHttpUrl !== 'function' || !format) {
      throw new TypeError('feed card requires esc, safeHttpUrl and format dependencies');
    }

    function skeletons(n = 5) {
      // 尺寸一律 rem：跟着界面缩放档位一起走，否则放大版面后骨架与真实卡片的
      // 高度差会被进一步拉大，加载完成瞬间的跳变更明显
      return Array.from({ length: n }, () => `
    <div class="card skeleton" style="margin-bottom:.875rem">
      <div class="sk-line" style="width:70%"></div>
      <div class="sk-line" style="width:38%;height:.625rem"></div>
      <div class="sk-line" style="width:95%;height:.6875rem"></div>
    </div>`).join('');
    }

    function scorePill(item) {
      const v = Math.round(item.quality ?? 0);
      // title 属性里的数值一律 Number() 收敛，杜绝 undefined/对象裸插值
      const qualityText = Number(item.quality ?? 0);
      const heatText = Number(item.heat ?? 0);
      if (item.featured) {
        return `<span class="score-pill featured" title="质量分 ${qualityText} · 当前热度 ${heatText}（随时间消退）">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1C8 1 3 5.5 3 9.5a5 5 0 0 0 10 0c0-1.8-1-3.5-2-4.7C10.6 6.6 10 7.5 9 7.5 9.6 5.5 8 1 8 1z"/></svg>
      精选 <b>${v}</b></span>`;
      }
      if (item.quality != null) {
        return `<span class="score-pill" title="质量分 ${qualityText} · 当前热度 ${heatText}">质量 <b>${v}</b></span>`;
      }
      return `<span class="score-pill">待评</span>`;
    }

    function breakthroughPresentation(item) {
      const rawBonus = Number(item.breakthroughBonus);
      if (!Number.isFinite(rawBonus) || rawBonus <= 0) return null;
      const bonusValue = Math.min(100, Math.max(0, rawBonus));
      const bonus = Number.isInteger(bonusValue)
        ? String(bonusValue)
        : bonusValue.toFixed(1).replace(/\.0$/, '');
      const score = Math.round(
        Math.min(1, Math.max(0, Number(item.breakthroughScore) || 0)) * 100
      );
      const signals = item.breakthroughSignals && typeof item.breakthroughSignals === 'object'
        ? item.breakthroughSignals
        : {};
      const safeTerms = value => Array.isArray(value)
        ? value
            .filter(term => typeof term === 'string' && term.trim())
            .map(term => term.trim().slice(0, 40))
            .slice(0, 4)
        : [];
      const objects = safeTerms(signals.objects);
      const actions = safeTerms(signals.actions);
      const evidenceNames = {
        'tier-t1': '官方一手信源',
        'tier-t1.5-model': '官方信源与模型可信度',
        'corroborated-model': '多信源交叉验证',
        'corroborated-no-model': '多信源一致报道'
      };
      const evidence = evidenceNames[signals.credibilityEvidence] || '可信信源验证';
      const details = [
        objects.length ? `技术对象：${objects.join('、')}` : '',
        actions.length ? `完成证据：${actions.join('、')}` : '',
        `可信依据：${evidence}`,
        `突破强度：${score}%`
      ].filter(Boolean);
      return {
        bonus,
        score,
        explanation: `该条情报通过技术突破门槛，热度加成 ${bonus} 分，并按突破强度延长热度半衰期。${details.join('；')}。`
      };
    }

    function entityChipsHtml(item) {
      const list = Array.isArray(item.entities) ? item.entities.filter(e => e?.name).slice(0, 6) : [];
      if (!list.length) return '';
      return `<div class="card-entities" role="group" aria-label="相关实体">${list.map(entity => {
        const type = ENTITY_TYPE_NAMES[entity.type] || '实体';
        return `<button class="card-entity" type="button" data-entity="${esc(entity.name)}"
      title="按${type}检索「${esc(entity.name)}」">${esc(entity.name)}</button>`;
      }).join('')}</div>`;
    }

    // 原子事件只在真的拆出多件事时才展示。单事件的卡片摘要已经说清楚了，
    // 再列一遍只是噪声；而「这条其实讲了两件事」本身就是读者需要知道的信息。
    function atomicEventsHtml(item) {
      const list = Array.isArray(item.events) ? item.events.filter(e => e?.actor) : [];
      if (list.length < 2) return '';
      const rows = list.map(event => {
        const action = EVENT_CLASS_NAMES[event.actionClass] || event.action || '相关动作';
        const object = event.object ? ` · ${esc(event.object)}` : '';
        return `<li><b>${esc(event.actor)}</b><span>${esc(action)}</span>${object}</li>`;
      }).join('');
      return `<div class="card-events" role="note">
      <span class="ce-label">原子事件 ${list.length}</span>
      <ol class="ce-list">${rows}</ol>
    </div>`;
    }

    return Object.freeze({
      skeletons,
      scorePill,
      breakthroughPresentation,
      entityChipsHtml,
      atomicEventsHtml
    });
  }

  // ---------- 阶段 4：卡片模板化与增量 diff 渲染 ----------
  // 时间轴的时间基准：星标视图按收藏时间排序，分组标题就必须同样用收藏时间，
  // 否则日期分组会随发布时间来回跳，出现「今天 / 3月2日 / 今天」这样的乱序标题。
  //（自 app.js 迁入）
  const publishedTime = item => item.publishedAt || item.fetchedAt;
  const starredTime = item => item.starredAt || item.fetchedAt;

  // 五维研判维度名（自 app.js 迁入，仅卡片五维分解使用）
  const DIM_NAMES = Object.freeze({
    importance: '重要性', novelty: '新颖度', credibility: '可信度',
    impact: '行业影响', timeliness: '时效性'
  });

  function createCardRenderer({ esc, safeHttpUrl, format, template, doc } = {}) {
    if (typeof esc !== 'function' || typeof safeHttpUrl !== 'function' || !format
      || !template?.content || !doc) {
      throw new TypeError('card renderer requires esc, safeHttpUrl, format, template and doc dependencies');
    }
    const { timeAgo, dateLabel, hhmm } = format;
    const { scorePill, breakthroughPresentation, entityChipsHtml, atomicEventsHtml } =
      createFeedCard({ esc, safeHttpUrl, format });

    // 以下三段构建器仍产出 HTML 字符串：五维分解、突破徽标与突破依据属于
    // 「整块塞进克隆模板插槽」的内容，不为它们单独开模板节点
    function dimsHtml(item) {
      if (!item.scores) return '';
      return Object.entries(DIM_NAMES).map(([k, name]) => `
    <div class="dim">
      <div class="dim-label"><span>${name}</span><b>${Math.round(item.scores[k] ?? 0)}</b></div>
      <div class="dim-bar"><i style="width:${Math.min(100, item.scores[k] ?? 0)}%"></i></div>
    </div>`).join('');
    }
    function breakthroughBadgeHtml(breakthrough) {
      return `
    <span class="breakthrough-pill" role="note"
      aria-label="技术突破热度加成 ${breakthrough.bonus} 分，突破强度 ${breakthrough.score}%"
      title="已通过技术对象、完成动作与可信度门槛">
      技术突破 <b>+${breakthrough.bonus}</b>
    </span>`;
    }
    function breakthroughDetailHtml(breakthrough) {
      return `
    <div class="breakthrough-explanation" role="note">
      <strong>技术突破加分依据</strong>
      <p>${esc(breakthrough.explanation)}</p>
    </div>`;
    }

    // 整卡渲染：cloneNode(true) 模板 + 字段级填充。DOM 输出契约（class /
    // data-* / aria-* / 文案 / 链接结构）与阶段 3 的字符串模板等价，
    // 行为级测试以渲染产物断言
    function renderCard(item) {
      const card = template.content.cloneNode(true).firstElementChild;
      const q = sel => card.querySelector(sel);
      card.setAttribute('data-id', String(item.id));
      if (item.featured) card.classList.add('is-featured');
      if (item.domain) card.setAttribute('data-domain', String(item.domain));
      q('.meta-source').textContent = item.source ?? '';
      const tier = q('.tier-chip');
      tier.classList.add(`tier-${item.tier}`);
      tier.textContent = item.tier ?? '';
      const catTag = q('.cat-tag');
      if (item.category) catTag.textContent = item.category;
      else catTag.remove();
      q('.meta-time').textContent = timeAgo(publishedTime(item));
      const breakthrough = breakthroughPresentation(item);
      q('.card-score-group').innerHTML =
        (breakthrough ? breakthroughBadgeHtml(breakthrough) : '') + scorePill(item);
      const title = q('.card-title');
      title.setAttribute('href', safeHttpUrl(item.url));
      title.textContent = item.title ?? '';
      const thumbSrc = safeHttpUrl(item.image);
      const thumb = q('.card-thumb');
      if (thumbSrc !== '#') {
        thumb.setAttribute('src', thumbSrc);
        q('.card-content').classList.add('has-thumb');
      } else thumb.remove();
      const summary = q('.card-summary');
      if (item.summary) summary.textContent = item.summary;
      else summary.remove();
      const tags = q('.card-tags');
      if (item.tags?.length) {
        tags.innerHTML = item.tags.map(t => `<span class="card-tag">${esc(t)}</span>`).join('');
      } else tags.remove();
      const entities = entityChipsHtml(item);
      if (entities) q('.card-text').insertAdjacentHTML('beforeend', entities);
      const events = atomicEventsHtml(item);
      if (events) q('.card-content').insertAdjacentHTML('afterend', events);
      const reason = q('.card-reason');
      if (item.reason) q('.cr-text').textContent = item.reason;
      else reason.remove();
      // 底栏：事件簇入口只在有簇时存在，五维入口只在有研判内容时存在；
      // 星标与复制固定在每张卡片上——留存与分发的入口不缺席
      const clusterToggle = q('.cluster-toggle');
      const hasCluster = item.clusterSize > 1;
      if (hasCluster) {
        clusterToggle.setAttribute('data-cluster', String(item.clusterId));
        clusterToggle.setAttribute('data-self', String(item.id));
        clusterToggle.appendChild(doc.createTextNode(` ${item.clusterSize} 篇关联报道`));
      } else clusterToggle.remove();
      const dims = dimsHtml(item);
      const analysisDetails = `${dims}${breakthrough ? breakthroughDetailHtml(breakthrough) : ''}`;
      const dimsToggle = q('.dims-toggle');
      if (analysisDetails) {
        // 模板默认文案「五维研判」；没有五维分只有突破依据时改叫「研判详情」
        if (!dims && dimsToggle.firstChild?.nodeType === 3) dimsToggle.firstChild.nodeValue = '研判详情';
      } else dimsToggle.remove();
      q('[data-act="copy"]').setAttribute('data-focus-key', `copy:${item.id}`);
      const starToggle = q('.star-toggle');
      starToggle.setAttribute('data-focus-key', `star:${item.id}`);
      if (item.starred) {
        starToggle.classList.add('is-on');
        starToggle.setAttribute('aria-pressed', 'true');
        starToggle.setAttribute('title', '取消星标');
        starToggle.querySelector('.card-act-label').textContent = '已星标';
        starToggle.querySelector('path')?.setAttribute('fill', 'currentColor');
      } else {
        starToggle.setAttribute('title', '星标留存（不受保留天数清理）');
      }
      if (!hasCluster) q('.cluster-items').remove();
      const dimsBox = q('.dims');
      if (analysisDetails) dimsBox.innerHTML = analysisDetails;
      else dimsBox.remove();
      return card;
    }

    // 时间轴行：左侧时刻 + 领域色点 + 卡片（自 app.js renderTimeline 迁入，
    // 行结构不变，卡片改走模板克隆）
    function timelineRow(item, timeOf, delayMs) {
      const row = doc.createElement('div');
      row.setAttribute('class', 'tl-row');
      const left = doc.createElement('div');
      left.setAttribute('class', 'tl-left');
      const time = doc.createElement('span');
      time.setAttribute('class', 'tl-time');
      time.textContent = hhmm(timeOf(item));
      const dot = doc.createElement('i');
      const dotDomain = item.domain === 'lowaltitude' ? ' la' : item.domain === 'aerospace' ? ' ae' : '';
      dot.setAttribute('class', `tl-dot${dotDomain}`);
      left.appendChild(time);
      left.appendChild(dot);
      row.appendChild(left);
      const card = renderCard(item);
      card.style.animationDelay = `${delayMs}ms`;
      row.appendChild(card);
      return row;
    }

    // 按日期分组（保持原分组逻辑不变）；time 记录该组首条目的原始时间值，
    // 供 prependFresh 在标签不一致时比较新旧关系
    function groupItems(items, timeOf) {
      const groups = [];
      let cur = null;
      for (const item of items) {
        const label = dateLabel(timeOf(item));
        if (!cur || cur.label !== label) {
          cur = { label, time: timeOf(item), items: [] };
          groups.push(cur);
        }
        cur.items.push(item);
      }
      return groups;
    }

    // 日期分组外壳：sticky 标题 + 条数角标（.date-head 在 .card 之外，
    // 不受卡片 content-visibility 包含影响）；data-group-time 记录首条目
    // 原始时间值，prependFresh 用它判断新分组是否更旧
    function dateGroupShell(label, count, time) {
      const group = doc.createElement('div');
      group.setAttribute('class', 'date-group');
      if (time != null) group.setAttribute('data-group-time', String(time));
      const head = doc.createElement('div');
      head.setAttribute('class', 'date-head');
      head.appendChild(doc.createTextNode(label));
      const counter = doc.createElement('span');
      counter.setAttribute('class', 'dh-count');
      counter.textContent = `${count} 条`;
      head.appendChild(counter);
      group.appendChild(head);
      return group;
    }

    // 时间轴整页片段（精选 / 全部动态 / 星标）
    function renderTimeline(items, startIdx, timeOf = publishedTime) {
      const frag = doc.createDocumentFragment();
      for (const group of groupItems(items, timeOf)) {
        const groupEl = dateGroupShell(group.label, group.items.length, group.time);
        group.items.forEach((item, i) => {
          groupEl.appendChild(timelineRow(item, timeOf, Math.min(startIdx + i, 10) * 35));
        });
        frag.appendChild(groupEl);
      }
      return frag;
    }

    // 复用行时同步可能漂移的字段：左侧时刻随时间基准走
    function syncTimelineRow(row, item, timeOf) {
      const time = row.querySelector('.tl-time');
      if (time) time.textContent = hhmm(timeOf(item));
    }

    return Object.freeze({
      renderCard,
      timelineRow,
      groupItems,
      dateGroupShell,
      renderTimeline,
      syncTimelineRow
    });
  }

  // keyed diff 列表渲染器：按 data-id 调和整表重载、分页追加与实时前置插入，
  // 已有节点复用、缺失项才新建、多余项移除，避免整页卡片全量解析。
  // 液态玻璃阶段 3：motion 为可选依赖——新建节点错峰入场（staggerIn，
  // 上限截断在引擎内部）；注入缺失或异常时静默跳过，动画不保证也能渲染，
  // 列表数据正确性不受影响
  function createFeedDiffList({ list, renderer, motion = null } = {}) {
    if (!list || !renderer || typeof renderer.timelineRow !== 'function'
      || typeof renderer.groupItems !== 'function'
      || typeof renderer.dateGroupShell !== 'function' || typeof renderer.renderCard !== 'function') {
      throw new TypeError('feed diff list requires list and renderer dependencies');
    }

    // 错峰入场只对本次实际新建的行节点生效（content-visibility 区域外的
    // 既有节点不重复动画）；动画是增强层，失败不影响渲染结果。
    // 评审修复：motion 接管新建行入场——命中 stagger 的行挂 .stagger-in
    //（styles.css 据此关掉行内卡片的 CSS 入场，避免行级 transform 与卡片
    // 入场动画祖孙两层叠加、步长不同步），并清掉行构建器写入的 inline
    // animationDelay。复用行与首屏整表渲染路径不经过这里，CSS 入场不变
    function staggerCreated(rows) {
      if (!rows.length || !motion || typeof motion.staggerIn !== 'function') return;
      const limit = Number(motion.STAGGER_LIMIT) > 0 ? Number(motion.STAGGER_LIMIT) : 8;
      const targets = rows.slice(0, limit);
      try {
        motion.staggerIn(targets);
        // 上限之外的行不挂标记，继续走卡片 CSS 入场，不出现入场空档
        targets.forEach(row => {
          row.classList?.add('stagger-in');
          const card = row.querySelector?.('.card');
          if (card?.style) card.style.animationDelay = '';
        });
      } catch { /* 静默降级：未挂标记的行仍走卡片 CSS 入场 */ }
    }

    // 按 data-id 收集并摘下现有行，得到可复用池（diff 的键）。
    // 只收时间轴行壳（.tl-row），无对应行壳的卡片随列表清空后重建
    function collectRowsById() {
      const rowsById = new Map();
      const rowSelector = '.tl-row';
      for (const card of Array.from(list.querySelectorAll('.card[data-id]'))) {
        const key = String(card.getAttribute('data-id'));
        if (rowsById.has(key)) continue;
        const row = card.closest(rowSelector);
        if (!row) continue;   // 无行壳的卡片不入池：随列表清空后重建
        row.parentNode?.removeChild(row);
        rowsById.set(key, row);
      }
      return rowsById;
    }

    // 复用行的卡片正文随新数据刷新：行壳（左侧时刻与节点身份）保留，
    // 卡片整张换新。选「换卡不整行重建」而非整行重建，是因为行壳上挂着
    // tl-left 的同步逻辑与行节点复用契约，整行重建会丢掉节点身份、
    // 代价也更高；换卡与新建行共用 renderer.renderCard，字段填充行为必然
    // 一致。代价是复用行上已展开的五维/事件簇交互态会随刷新复位——整表
    // 调和本就是「以服务端最新数据为准」的时刻，复位可接受
    function refreshRowCard(row, item, delayMs) {
      const newCard = renderer.renderCard(item);
      newCard.style.animationDelay = `${delayMs}ms`;
      // 复用行的新卡片走卡片 CSS 入场：摘掉上一轮可能挂着的错峰标记，
      // 避免残留类名把新卡片的入场一并关掉（复用行入场行为不变）
      row.classList?.remove('stagger-in');
      const oldCard = row.querySelector('.card');
      if (oldCard) {
        row.insertBefore(newCard, oldCard);
        row.removeChild(oldCard);
      } else row.appendChild(newCard);
    }

    function reconcile(items, { startIdx = 0, timeOf = publishedTime } = {}) {
      const rowsById = collectRowsById();
      list.replaceChildren();
      let reused = 0;
      let created = 0;
      const createdRows = [];
      for (const group of renderer.groupItems(items, timeOf)) {
        const groupEl = renderer.dateGroupShell(group.label, group.items.length, group.time);
        list.appendChild(groupEl);
        group.items.forEach((item, i) => {
          const key = String(item.id);
          let row = rowsById.get(key);
          if (row) { reused += 1; renderer.syncTimelineRow?.(row, item, timeOf); refreshRowCard(row, item, Math.min(startIdx + i, 10) * 35); }
          else { row = renderer.timelineRow(item, timeOf, Math.min(startIdx + i, 10) * 35); created += 1; createdRows.push(row); }
          groupEl.appendChild(row);
        });
      }
      staggerCreated(createdRows);
      const removed = rowsById.size - reused;
      return { reused, created, removed };
    }

    // 分页追加：与上一页同一天的条目并进既有末组，避免「今天」标题拆成两截
    function appendPage(items, { startIdx = 0, timeOf = publishedTime } = {}) {
      if (!Array.isArray(items) || !items.length) return { created: 0 };
      const groups = renderer.groupItems(items, timeOf);
      const createdRows = [];
      let created = 0;
      let delayBase = startIdx;
      const lastGroup = list.querySelector('.date-group:last-child');
      let start = 0;
      if (lastGroup && groups[0] && labelOfGroup(lastGroup) === groups[0].label) {
        for (const item of groups[0].items) {
          const row = renderer.timelineRow(item, timeOf, Math.min(delayBase, 10) * 35);
          lastGroup.appendChild(row);
          createdRows.push(row);
          created += 1;
          delayBase += 1;
        }
        syncGroupCount(lastGroup);
        start = 1;
      }
      for (let gi = start; gi < groups.length; gi += 1) {
        const group = groups[gi];
        const groupEl = renderer.dateGroupShell(group.label, group.items.length, group.time);
        for (const item of group.items) {
          const row = renderer.timelineRow(item, timeOf, Math.min(delayBase, 10) * 35);
          groupEl.appendChild(row);
          createdRows.push(row);
          created += 1;
          delayBase += 1;
        }
        list.appendChild(groupEl);
      }
      staggerCreated(createdRows);
      return { created };
    }

    function labelOfGroup(groupEl) {
      const head = groupEl.querySelector('.date-head');
      if (!head) return null;
      let label = '';
      for (const node of Array.from(head.childNodes)) {
        if (node.nodeType === 3) label += node.nodeValue;
      }
      return label.trim();
    }

    function syncGroupCount(groupEl) {
      const counter = groupEl.querySelector('.dh-count');
      if (counter) counter.textContent = `${groupEl.querySelectorAll('.tl-row').length} 条`;
    }

    // 实时新条目：仅前置插入 + .card-new 高亮（阶段 1 样式承接），替代整表
    // 重载。返回实际插入条数；列表里没有日期分组（空态/骨架/失败态）
    // 等不适用前置的场景返回 0，由调用方退回整表重载
    function prependFresh(items, { timeOf = publishedTime } = {}) {
      if (!Array.isArray(items) || !items.length) return 0;
      if (!list.querySelector('.date-group')) return 0;
      const groups = renderer.groupItems(items, timeOf);
      let applied = 0;
      const insertedRows = [];
      // 从最旧的一组开始插：每轮都插到当前首组之前，插完后最新的一组仍在顶部
      for (let gi = groups.length - 1; gi >= 0; gi -= 1) {
        const group = groups[gi];
        const head = list.querySelector('.date-group');
        if (labelOfGroup(head) === group.label) {
          // 同日期标签合并进既有首组：组内新行排在旧行之前
          const anchor = head.querySelector('.tl-row');
          for (const item of group.items) {
            const row = renderer.timelineRow(item, timeOf, 0);
            row.querySelector('.card')?.classList.add('card-new');
            head.insertBefore(row, anchor);
            insertedRows.push(row);
            applied += 1;
          }
          syncGroupCount(head);
        } else {
          // 标签不一致时先判新旧：新分组不晚于既有首组（轮询中源站翻出的
          // 旧文）就不能前置——返回 0，由调用方回退整表重载，避免「昨天」
          // 分组插到「今天」之上导致时间轴倒序。时间值统一经 Date 归一，
          // ISO 字符串与时间戳都好比；无法解析时宁可回退整表重载
          const headTime = new Date(head.getAttribute('data-group-time')).getTime();
          if (!(new Date(group.time).getTime() > headTime)) return 0;
          const groupEl = renderer.dateGroupShell(group.label, group.items.length, group.time);
          for (const item of group.items) {
            const row = renderer.timelineRow(item, timeOf, 0);
            row.querySelector('.card')?.classList.add('card-new');
            groupEl.appendChild(row);
            insertedRows.push(row);
            applied += 1;
          }
          list.insertBefore(groupEl, head);
        }
      }
      staggerCreated(insertedRows);
      return applied;
    }

    return Object.freeze({ reconcile, appendPage, prependFresh });
  }

  return Object.freeze({
    ENTITY_TYPE_NAMES,
    EVENT_CLASS_NAMES,
    DIM_NAMES,
    publishedTime,
    starredTime,
    createFeedCard,
    createCardRenderer,
    createFeedDiffList
  });
});
