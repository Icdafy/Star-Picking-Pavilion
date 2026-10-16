'use strict';

/* 摘星阁 · 设置表单
   createSettingsFormController —— 采集与数据保留两张表单（字段级脏标记，迟到的加载不覆盖用户正在改的值）。
   createModelsSettings —— v0.2.3「模型」一节，交互照搬 DeepSeek Harness 的 Models 设置页：
     提供商行（名称 · 自定义标记 · 密钥状态点 · 编辑 / 删除）→ 行内编辑卡（API 密钥 + 折叠的
     「自定义设置」：显示名称、API 地址、API 协议、模型目录）→ 模型目录编辑器（ID / 显示名称 /
     上下文窗口 / 最大输出 / 输入类型，「获取可用模型」询问表单当前显示的端点与密钥，勾选后采纳）→
     整行宽的「添加模型提供商」入口（分段切换：第三方目录 / 自定义模型 API，两个草稿互不丢失）。
     摘星阁自己的补充只有一处：顶部「分析模型」选择，决定整条精选链用哪个模型。
   createPushSettings —— 「新闻推送」一节：飞书 / 钉钉 / QQ（OneBot v11）机器人验证码绑定（v0.2.35）；
     v0.2.36 起推送时间与内容全部改为点选、改动即自动保存，顶部状态区实时显示下一次推送与今天的时刻表。 */

(function exposeSettingsFormController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.SettingsFormController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsFormModule() {
  const FIELD_NAMES = Object.freeze([
    'automatic',
    'intervalMinutes',
    'rsshubBase',
    'retentionDays',
    'irrelevantRetentionDays'
  ]);
  const COLLECT_FIELD_NAMES = Object.freeze(['automatic', 'intervalMinutes', 'rsshubBase']);
  const RETENTION_FIELD_NAMES = Object.freeze(['retentionDays', 'irrelevantRetentionDays']);
  const RETENTION_DEFAULTS = Object.freeze({ retentionDays: 180, irrelevantRetentionDays: 21 });
  const COLLECT_INTERVAL_PRESETS = Object.freeze([
    [15, '15 分钟'], [30, '30 分钟'], [60, '1 小时'], [120, '2 小时'], [180, '3 小时'], [360, '6 小时'], [720, '12 小时']
  ]);
  const RETENTION_PRESETS = Object.freeze([[30, '30 天'], [90, '90 天'], [180, '半年'], [365, '1 年'], [1095, '3 年']]);
  const IRRELEVANT_RETENTION_PRESETS = Object.freeze([[7, '7 天'], [14, '14 天'], [21, '21 天'], [30, '30 天'], [60, '60 天']]);

  function describeInterval(minutes) {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1) return '';
    return value % 60 === 0 ? `${value / 60} 小时` : `${value} 分钟`;
  }

  // 设置页通用的点选组：与“新闻推送”同一套 .period-switch 胶囊；每个都是可 Tab 到的切换按钮
  function presetChips(group, presets, current, esc = String) {
    return presets.map(([value, label]) => {
      const on = Number(current) === value;
      return `<button class="chip${on ? ' active' : ''}" type="button" aria-pressed="${on}" data-preset="${esc(group)}" data-value="${value}">${esc(label)}</button>`;
    }).join('');
  }

  function createSettingsFormController({ elements, request } = {}) {
    if (!elements || typeof request !== 'function') {
      throw new TypeError('settings form elements and request are required');
    }
    for (const name of FIELD_NAMES) {
      if (!elements[name] || typeof elements[name].addEventListener !== 'function') {
        throw new TypeError(`settings form field is required: ${name}`);
      }
    }

    const fieldStates = Object.fromEntries(FIELD_NAMES.map(name => [
      name,
      { revision: 0, dirty: false }
    ]));
    let latestLoadSequence = 0;
    for (const name of FIELD_NAMES) {
      elements[name].addEventListener('input', () => {
        fieldStates[name].revision += 1;
        fieldStates[name].dirty = true;
      });
    }

    const snapshot = () => Object.fromEntries(
      FIELD_NAMES.map(name => [name, fieldStates[name].revision])
    );
    const canApplyLoad = (name, prior) => (
      !fieldStates[name].dirty
      && fieldStates[name].revision === prior[name]
    );
    const markSynchronizedIfUnchanged = (name, prior) => {
      if (fieldStates[name].revision !== prior[name]) return false;
      fieldStates[name].revision += 1;
      fieldStates[name].dirty = false;
      return true;
    };

    async function load() {
      const sequence = ++latestLoadSequence;
      const prior = snapshot();
      const settings = await request('/api/settings');
      if (sequence !== latestLoadSequence) return settings;

      if (canApplyLoad('automatic', prior)) elements.automatic.checked = settings.collect.automatic === true;

      if (canApplyLoad('intervalMinutes', prior)) {
        elements.intervalMinutes.value = settings.collect.intervalMinutes;
      }
      if (canApplyLoad('rsshubBase', prior)) {
        elements.rsshubBase.value = settings.collect.rsshubBase || '';
      }
      for (const name of RETENTION_FIELD_NAMES) {
        if (canApplyLoad(name, prior)) {
          elements[name].value = settings.collect[name] ?? RETENTION_DEFAULTS[name];
        }
      }
      return settings;
    }

    // v0.2.37 起设置页改为“改动即保存”：开关、点选与回车各自只提交自己的字段，
    // 不再把别处尚未确认的输入一并带走；不带参数时仍提交整组（兼容旧调用）。
    function pick(names, allowed) {
      const list = names === undefined ? allowed : [].concat(names);
      if (!list.length || list.some(name => !allowed.includes(name))) {
        throw new TypeError(`unknown settings fields: ${list.join(', ')}`);
      }
      return list;
    }

    function wholeDays(name, min, label) {
      const text = String(elements[name].value).trim();
      const days = Number(text);
      if (!text || !Number.isInteger(days) || days < min || days > 3650) {
        throw new Error(`${label}请输入 ${min} 至 3650 的整数天`);
      }
      return days;
    }

    async function submit(fields, values) {
      const submitted = snapshot();
      const result = await request('/api/settings', { body: { collect: values } });
      for (const name of fields) markSynchronizedIfUnchanged(name, submitted);
      return result;
    }

    async function saveCollect(names) {
      const fields = pick(names, COLLECT_FIELD_NAMES);
      const values = {};
      if (fields.includes('automatic')) values.automatic = elements.automatic.checked === true;
      if (fields.includes('intervalMinutes')) {
        const intervalMinutes = Number(elements.intervalMinutes.value);
        if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 720) {
          throw new Error('采集间隔请输入 1 至 720 的整数分钟');
        }
        values.intervalMinutes = intervalMinutes;
      }
      if (fields.includes('rsshubBase')) values.rsshubBase = elements.rsshubBase.value.trim();
      return submit(fields, values);
    }

    // 空值、小数与越界一律拒绝：此前清空输入框会被静默替换成默认天数
    async function saveRetention(names) {
      const fields = pick(names, RETENTION_FIELD_NAMES);
      const values = {};
      if (fields.includes('retentionDays')) values.retentionDays = wholeDays('retentionDays', 7, '情报保留天数');
      if (fields.includes('irrelevantRetentionDays')) {
        values.irrelevantRetentionDays = wholeDays('irrelevantRetentionDays', 1, '无关内容保留天数');
      }
      return submit(fields, values);
    }

    // 保存被拒后放弃这些字段上的本地改动，重新读回服务器上的值（否则脏标记会挡住回滚）
    function discard(names) {
      for (const name of pick(names, FIELD_NAMES)) {
        fieldStates[name].dirty = false;
        fieldStates[name].revision += 1;
      }
      return load();
    }

    return Object.freeze({ load, saveCollect, saveRetention, discard });
  }

  // ======================================================================
  // 模型设置 · 纯函数（与 DSH DeepSeekModelsEditor / apiKey.ts 同口径，单测直接引用）
  // ======================================================================
  const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
  // 十进制倍数：1M = 1000K，与模型容量的通行写法一致
  const CAPACITY_SCALE = Object.freeze({ k: 1_000, m: 1_000_000 });
  const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
  const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;
  const PROVIDER_ID = /^[a-z][a-z0-9-]{0,39}$/;

  function parseCapacity(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return undefined;
    const match = CAPACITY_PATTERN.exec(trimmed);
    if (!match) return Number.NaN;
    const suffix = match[2]?.toLowerCase();
    const scaled = Number(match[1]) * (suffix ? CAPACITY_SCALE[suffix] : 1);
    // 2.3 × 1e6 在二进制浮点里会高出几个 ULP，整数意图吸附回整数
    const rounded = Math.round(scaled);
    return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
  }

  function formatCapacity(value) {
    if (!Number.isInteger(value) || value <= 0) return value === undefined || value === null ? '' : String(value);
    if (value % CAPACITY_SCALE.m === 0) return `${value / CAPACITY_SCALE.m}M`;
    if (value % CAPACITY_SCALE.k === 0) return `${value / CAPACITY_SCALE.k}K`;
    return String(value);
  }

  // 返回失败文案；空串表示「不改密钥」，不是错误
  function apiKeyFailure(draft) {
    const text = String(draft ?? '');
    if (!text) return '';
    const value = text.trim();
    if (!value) return '请输入 API 密钥；留空则保持已存储的密钥。';
    const first = value[0];
    const quoted = (first === '"' || first === '\'' || first === '`') && value.length > 1 && value.endsWith(first);
    if (ENV_LINE.test(value) || quoted || !LEGAL_API_KEY.test(value)) return '该 API 密钥格式错误，请检查。';
    return '';
  }

  // 模型行校验：返回 { index, message } 或 null
  function modelRowsFailure(rows) {
    const seen = new Set();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const id = String(row.id ?? '').trim();
      if (!id) return { index, message: '模型 ID 不能为空。' };
      if (seen.has(id)) return { index, message: '模型 ID 不能重复。' };
      seen.add(id);
      const context = parseCapacity(row.contextText);
      if (context !== undefined && !(Number.isInteger(context) && context > 0)) {
        return { index, message: '上下文窗口必须是正数，例如 131072、256K 或 1M。' };
      }
      const maxTokens = parseCapacity(row.maxTokensText);
      if (maxTokens !== undefined && !(Number.isInteger(maxTokens) && maxTokens > 0)) {
        return { index, message: '最大输出 token 数必须是正数，例如 8192、64K 或 1M。' };
      }
    }
    return null;
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  let uidSeed = 0;
  const nextUid = () => `m${(uidSeed += 1)}`;

  function draftRow(model = {}) {
    return {
      uid: nextUid(),
      id: model.id || '',
      name: model.name || '',
      contextText: formatCapacity(model.contextWindow),
      maxTokensText: formatCapacity(model.maxTokens),
      input: Array.isArray(model.input) ? [...model.input] : null
    };
  }

  function rowPayload(row) {
    const model = { id: row.id.trim() };
    if (row.name.trim()) model.name = row.name.trim();
    const contextWindow = parseCapacity(row.contextText);
    if (contextWindow !== undefined) model.contextWindow = contextWindow;
    const maxTokens = parseCapacity(row.maxTokensText);
    if (maxTokens !== undefined) model.maxTokens = maxTokens;
    if (Array.isArray(row.input)) model.input = row.input.includes('image') ? ['text', 'image'] : ['text'];
    return model;
  }

  function adoptCandidate(candidate) {
    return draftRow(candidate);
  }

  // 提供商编辑草稿。models 为 null 表示「沿用内置目录」，与 DSH 的「空覆盖 = 用默认」同义
  function providerDraft(row, { adopting = false } = {}) {
    return {
      provider: row.provider,
      declared: row.declared,
      keyOptional: row.keyOptional,
      keyConfigured: Boolean(row.keyConfigured),
      adopting,
      apiKey: '',
      displayName: row.declared ? row.displayName : '',
      api: row.api,
      baseUrl: row.declared || row.baseUrlCustomized ? row.baseUrl : '',
      initialBaseUrl: row.declared || row.baseUrlCustomized ? row.baseUrl : '',
      defaultBaseUrl: row.defaultBaseUrl || '',
      overridden: Boolean(row.declared || row.modelsCustomized),
      defaults: row.declared || row.modelsCustomized ? [] : (row.models || []).map(model => ({ ...model })),
      rows: (row.models || []).map(draftRow),
      modelsTouched: false,
      detailsOpen: adopting || !(row.models || []).length,
      expanded: new Set(),
      busy: false,
      fetching: false,
      failure: '',
      fetchFailure: ''
    };
  }

  function customDraft(protocols) {
    return {
      provider: '',
      declared: true,
      custom: true,
      keyOptional: false,
      keyConfigured: false,
      apiKey: '',
      displayName: '',
      api: protocols[0]?.value || 'openai-completions',
      baseUrl: '',
      overridden: true,
      defaults: [],
      rows: [],
      modelsTouched: false,
      detailsOpen: true,
      expanded: new Set(),
      busy: false,
      fetching: false,
      failure: '',
      fetchFailure: ''
    };
  }

  function formatLatency(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.round(ms)} 毫秒`;
  }

  // ======================================================================
  // 模型设置 · 界面
  // ======================================================================
  function createModelsSettings({
    root, picker, request, toast = () => {}, confirm = async () => true,
    escapeHTML, findFocusKey = () => null, restoreFocusByKey = () => false, motion = null, badge = null
  } = {}) {
    if (!root || typeof request !== 'function' || typeof escapeHTML !== 'function') {
      throw new TypeError('models settings requires root, request and escapeHTML');
    }
    const esc = escapeHTML;
    const state = {
      status: 'idle',
      error: '',
      view: null,
      editing: null,
      drafts: new Map(),
      addOpen: false,
      addMode: 'catalog',
      addCatalog: '',
      visited: new Set(),
      saved: '',
      activeBusy: false,
      testBusy: false,
      testResult: null,
      picker: null
    };
    const pendingEntrances = new Set();

    const providerRow = id => state.view?.providers.find(row => row.provider === id);
    const catalogRow = id => state.view?.catalog.find(row => row.provider === id);
    const label = row => (row.provider === row.displayName ? row.provider : `${row.displayName}（${row.provider}）`);

    function draftFor(key) {
      return state.drafts.get(key);
    }

    function addableCatalog() {
      return (state.view?.catalog || []).filter(entry => !entry.added);
    }

    // —— 渲染 ——
    function dotHtml(row) {
      if (row.keyConfigured) {
        return '<span class="model-dot is-ok" role="img" aria-label="API 密钥已配置" title="API 密钥已配置"></span>';
      }
      if (row.keyOptional) {
        return '<span class="model-dot is-local" role="img" aria-label="本机端点，无需密钥" title="本机端点，无需密钥"></span>';
      }
      return '<span class="model-dot is-missing" role="img" aria-label="API 密钥缺失" title="API 密钥缺失"></span>';
    }

    function activeHtml() {
      const view = state.view;
      const groups = view.providers.filter(row => row.models.length).map(row => `
        <optgroup label="${esc(row.displayName)}${row.keyConfigured || row.keyOptional ? '' : '（缺少密钥）'}">
          ${row.models.map(model => `<option value="${esc(`${row.provider}|${model.id}`)}"${row.provider === view.activeProvider && model.id === view.activeModel ? ' selected' : ''}>${esc(model.name ? `${model.name} · ${model.id}` : model.id)}</option>`).join('')}
        </optgroup>`).join('');
      const active = providerRow(view.activeProvider);
      const activeModel = active?.models.find(model => model.id === view.activeModel);
      const noKey = active && !active.keyConfigured && !active.keyOptional;
      const vision = Array.isArray(activeModel?.input) && activeModel.input.includes('image');
      const result = state.testResult;
      return `
        <div class="models-active">
          <div class="models-active-copy">
            <span class="models-kicker">分析模型</span>
            <strong>${esc(activeModel?.name || view.activeModel)}</strong>
            <small>${esc(active?.displayName || view.activeProvider)} · ${esc(view.activeModel)}${vision ? ' · 支持图片理解' : ' · 仅文本（跳过图片理解）'}</small>
          </div>
          <div class="models-active-controls">
            <label class="models-select-wrap">
              <span class="sr-only">选择分析模型</span>
              <select id="modelsActiveSelect" data-models-act="select-active" data-focus-key="models-active"${state.activeBusy ? ' disabled' : ''}>${groups}</select>
            </label>
            <button class="btn-ghost" type="button" id="btnTestModel" data-models-act="test-active" data-focus-key="models-test"${state.testBusy || noKey ? ' disabled' : ''}${noKey ? ' title="先填入 API 密钥才能测试"' : ''}>${state.testBusy ? '测试中…' : '测试连接'}</button>
          </div>
          <p class="models-active-status${result ? (result.ok ? ' ok' : ' fail') : ''}${noKey && !result ? ' warn' : ''}" id="modelTestResult" role="status" aria-live="polite">${result
            ? esc(result.ok ? `✓ 连接正常 · ${result.model} · ${formatLatency(result.latencyMs)}` : `✗ ${result.error}`)
            : noKey ? `还没有 ${esc(active.displayName)} 的 API 密钥，精选暂用关键词规则。 <button class="btn-primary btn-compact" type="button" data-models-act="fill-key" data-provider="${esc(active.provider)}" data-focus-key="models-fill-key">填入密钥</button>` : ''}</p>
        </div>`;
    }

    function renderBadge() {
      if (!badge || !state.view) return;
      const active = providerRow(state.view.activeProvider);
      const ready = Boolean(active && (active.keyConfigured || active.keyOptional));
      badge.textContent = ready ? '已就绪' : '缺少密钥';
      badge.className = `set-badge ${ready ? 'ok' : 'warn'}`;
    }

    function capacityInput(draftKey, row, field, placeholder, labelText, position) {
      const value = field === 'contextWindow' ? row.contextText : row.maxTokensText;
      return `<label class="model-field">
        <span>${labelText}</span>
        <input type="text" inputmode="numeric" value="${esc(value)}" placeholder="${placeholder}"
          aria-label="${labelText} ${position}" data-models-field="${field}" data-draft="${esc(draftKey)}" data-uid="${row.uid}"
          data-focus-key="${esc(`${draftKey}:${row.uid}:${field}`)}">
      </label>`;
    }

    function modelListHtml(draftKey, draft) {
      const rows = draft.rows;
      const failure = modelRowsFailure(rows);
      const askable = Boolean(draft.baseUrl.trim() || (!draft.custom && !draft.declared));
      const keyProblem = apiKeyFailure(draft.apiKey);
      const meta = draft.custom || draft.declared
        ? ''
        : draft.overridden ? '已自定义模型目录' : (draft.defaults.length ? '正在使用内置默认模型' : '尚未添加模型：点「获取可用模型」让端点报告它的模型');
      return `
        <section class="model-catalog" aria-label="模型目录">
          <div class="model-catalog-head">
            <div class="model-catalog-heading">
              <span class="model-catalog-title">模型目录</span>
              ${meta ? `<span class="model-catalog-meta">${esc(meta)}</span>` : ''}
            </div>
            <div class="model-catalog-actions">
              ${draft.overridden && draft.defaults.length && !draft.custom && !draft.declared
                ? `<button type="button" class="link-btn" data-models-act="reset-models" data-draft="${esc(draftKey)}"${draft.busy ? ' disabled' : ''}>恢复默认模型</button>` : ''}
              <button type="button" class="link-btn" data-models-act="fetch-models" data-draft="${esc(draftKey)}"
                data-focus-key="${esc(`${draftKey}:fetch`)}"
                ${draft.busy || draft.fetching || !askable || keyProblem ? ' disabled' : ''}
                title="${esc(keyProblem || (askable ? '用表单当前的 API 地址与密钥询问端点' : '请先填写 API 地址，再获取'))}">${draft.fetching ? '<span class="btn-spinner" aria-hidden="true"></span>正在询问提供商…' : '获取可用模型'}</button>
            </div>
          </div>
          ${rows.length ? '' : `<p class="model-empty">${draft.custom || draft.declared ? '自定义模型 API 至少需要一个模型：手动添加，或先获取可用模型。' : '模型选择器中将不显示该提供商的任何模型。'}</p>`}
          <div class="model-list">
            ${rows.map((row, index) => {
              const position = index + 1;
              const expanded = draft.expanded.has(row.uid);
              const image = Array.isArray(row.input) ? row.input.includes('image') : null;
              return `
              <div class="model-entry${expanded ? ' is-expanded' : ''}" data-uid="${row.uid}">
                <div class="model-entry-row">
                  <input type="text" value="${esc(row.id)}" placeholder="模型 ID" aria-label="模型 ID ${position}"
                    data-models-field="id" data-draft="${esc(draftKey)}" data-uid="${row.uid}" data-focus-key="${esc(`${draftKey}:${row.uid}:id`)}"${draft.busy ? ' disabled' : ''}>
                  <input type="text" value="${esc(row.name)}" placeholder="显示名称（留空用 ID）" aria-label="显示名称 ${position}"
                    data-models-field="name" data-draft="${esc(draftKey)}" data-uid="${row.uid}" data-focus-key="${esc(`${draftKey}:${row.uid}:name`)}"${draft.busy ? ' disabled' : ''}>
                  <button type="button" class="icon-btn" data-models-act="toggle-row" data-draft="${esc(draftKey)}" data-uid="${row.uid}"
                    aria-expanded="${expanded}" aria-label="模型选项 ${position}" title="模型选项" data-focus-key="${esc(`${draftKey}:${row.uid}:toggle`)}">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button type="button" class="icon-btn is-danger" data-models-act="remove-row" data-draft="${esc(draftKey)}" data-uid="${row.uid}"
                    aria-label="删除模型 ${position}" title="删除模型"${draft.busy ? ' disabled' : ''}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
                ${expanded ? `
                <div class="model-advanced">
                  ${capacityInput(draftKey, row, 'contextWindow', '256K', '上下文窗口', position)}
                  ${capacityInput(draftKey, row, 'maxTokens', '32K', '最大输出 token 数', position)}
                  <fieldset class="model-inputs">
                    <legend>输入类型</legend>
                    <label><input type="checkbox" checked disabled> 文本</label>
                    <label><input type="checkbox" data-models-field="image" data-draft="${esc(draftKey)}" data-uid="${row.uid}"${image === true ? ' checked' : ''}${draft.busy ? ' disabled' : ''}> 图片</label>
                    ${image === null ? '<small>未声明：仅发送文本；确认支持图片后可勾选</small>' : ''}
                  </fieldset>
                </div>` : ''}
              </div>`;
            }).join('')}
          </div>
          <button type="button" class="add-model-btn" data-models-act="add-row" data-draft="${esc(draftKey)}"${draft.busy ? ' disabled' : ''}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>添加模型
          </button>
          ${failure ? `<p class="models-hint">模型 ${failure.index + 1}：${esc(failure.message)}</p>` : ''}
          ${draft.fetchFailure ? `<p class="models-error" role="alert">${esc(draft.fetchFailure)}</p>` : ''}
        </section>`;
    }

    function editorHtml(draftKey, draft, { title = '', submitLabel = '保存', busyLabel = '保存中…' } = {}) {
      const keyProblem = apiKeyFailure(draft.apiKey);
      const rowsProblem = modelRowsFailure(draft.rows);
      const baseChanged = !draft.custom && draft.keyConfigured && draft.baseUrl.trim() !== draft.initialBaseUrl;
      const keyPlaceholder = draft.keyConfigured
        ? '已配置——输入新值可替换'
        : draft.keyOptional ? '本机端点可留空' : '输入 API 密钥';
      const customBlocked = draft.custom && (!PROVIDER_ID.test(draft.provider) || !isHttpUrl(draft.baseUrl.trim()) || !draft.rows.length);
      const declaredBlocked = (draft.declared && !draft.custom) && (!isHttpUrl(draft.baseUrl.trim()) || !draft.rows.length);
      const submitDisabled = draft.busy || Boolean(keyProblem) || Boolean(rowsProblem) || customBlocked || declaredBlocked;
      const routeProblem = draft.custom && draft.provider
        ? (!PROVIDER_ID.test(draft.provider) ? '需以小写字母开头，之后可用小写字母、数字和短横线。'
          : (state.view.providers.some(row => row.provider === draft.provider) || state.view.catalog.some(row => row.provider === draft.provider)) ? '已有提供商使用了这个 ID。' : '')
        : '';
      const f = (field, extra = '') => `data-models-field="${field}" data-draft="${esc(draftKey)}" data-focus-key="${esc(`${draftKey}:${field}`)}"${draft.busy ? ' disabled' : ''}${extra}`;
      const protocolOptions = state.view.protocols
        .map(option => `<option value="${esc(option.value)}"${option.value === draft.api ? ' selected' : ''}>${esc(option.label)}</option>`).join('');
      const identityFields = draft.custom ? `
          <label class="field"><span>Provider ID</span>
            <input type="text" value="${esc(draft.provider)}" placeholder="例如 my-gateway" spellcheck="false" ${f('provider')}>
            <small class="models-hint">${esc(routeProblem || '以小写字母开头的标识，在请求中唯一标识该提供商。')}</small>
          </label>` : '';
      const nameField = draft.declared ? `
          <label class="field"><span>显示名称</span>
            <input type="text" value="${esc(draft.displayName)}" placeholder="${esc(draft.provider || '留空时使用 Provider ID')}" ${f('displayName')}>
          </label>` : '';
      const baseField = `
          <label class="field"><span>API 地址</span>
            <input type="text" value="${esc(draft.baseUrl)}" spellcheck="false"
              placeholder="${esc(draft.declared ? (draft.api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1') : (draft.defaultBaseUrl || '提供商默认'))}" ${f('baseUrl')}>
            ${baseChanged ? '<small class="models-hint is-warn">更换 API 地址需要重新输入密钥：已保存的密钥只会发往原地址。</small>' : ''}
          </label>`;
      const protocolField = draft.declared ? `
          <label class="field"><span>API 协议</span>
            <select ${f('api')}>${protocolOptions}</select>
          </label>` : '';
      const keyField = `
          <label class="field"><span>API 密钥</span>
            <input type="password" autocomplete="new-password" value="${esc(draft.apiKey)}" placeholder="${esc(keyPlaceholder)}"
              aria-invalid="${Boolean(keyProblem)}" ${f('apiKey')}>
            ${keyProblem ? `<small class="models-error">${esc(keyProblem)}</small>` : ''}
          </label>
          ${draft.keyConfigured && !draft.custom ? `<button type="button" class="link-btn models-clear-key" data-models-act="clear-key" data-draft="${esc(draftKey)}"${draft.busy ? ' disabled' : ''}>清除已保存的密钥</button>` : ''}`;
      const customized = draft.custom
        ? `<div class="models-customized-body">${nameField}${baseField}${protocolField}${modelListHtml(draftKey, draft)}</div>`
        : `<details class="models-customized" data-draft="${esc(draftKey)}"${draft.detailsOpen ? ' open' : ''}>
            <summary data-focus-key="${esc(`${draftKey}:details`)}">自定义设置</summary>
            <div class="models-customized-body">${nameField}${baseField}${protocolField}${modelListHtml(draftKey, draft)}</div>
          </details>`;
      return `
        <div class="model-editor" data-editor="${esc(draftKey)}">
          ${title}
          ${identityFields}
          ${keyField}
          ${customized}
          ${draft.failure ? `<p class="models-error" role="alert">${esc(draft.failure)}</p>` : ''}
          <div class="model-editor-actions">
            <button type="button" class="btn-ghost" data-models-act="cancel" data-draft="${esc(draftKey)}"${draft.busy ? ' disabled' : ''}>取消</button>
            <button type="button" class="btn-primary" data-models-act="submit" data-draft="${esc(draftKey)}" data-focus-key="${esc(`${draftKey}:submit`)}"${submitDisabled ? ' disabled' : ''}>${draft.busy ? busyLabel : submitLabel}</button>
          </div>
        </div>`;
    }

    function rowsHtml() {
      return state.view.providers.map(row => {
        const key = `row:${row.provider}`;
        const open = state.editing === row.provider && draftFor(key);
        const modelCount = row.models.length;
        return `
          <li class="model-row${open ? ' is-open' : ''}${row.active ? ' is-active' : ''}" data-provider="${esc(row.provider)}">
            <div class="model-row-head">
              <span class="model-row-identity">
                <span class="model-row-name">${esc(row.displayName)}</span>
                ${row.declared ? '<span class="model-row-tag">自定义</span>' : ''}
                ${row.active ? '<span class="model-row-tag is-active" title="分析模型来自这个提供商">当前使用</span>' : ''}
                ${dotHtml(row)}
              </span>
              <span class="model-row-actions">
                <button type="button" class="btn-ghost btn-compact" data-models-act="edit" data-provider="${esc(row.provider)}"
                  aria-label="编辑 ${esc(label(row))}" aria-expanded="${Boolean(open)}" data-focus-key="${esc(`edit:${row.provider}`)}">${open ? '收起' : '编辑'}</button>
                ${row.removable ? `<button type="button" class="btn-danger-ghost btn-compact" data-models-act="remove" data-provider="${esc(row.provider)}" aria-label="删除 ${esc(label(row))}">删除</button>` : ''}
              </span>
            </div>
            <div class="model-row-sub">
              <code>${esc(row.baseUrl)}</code>
              <span>${modelCount ? `${modelCount} 个模型` : '尚无模型'}</span>
              <span>${esc(row.api === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI 兼容')}</span>
            </div>
            ${open ? editorHtml(key, open) : ''}
          </li>`;
      }).join('');
    }

    function addHtml() {
      const addable = addableCatalog();
      if (!state.addOpen) {
        return `
          <div class="models-add-actions">
            <button type="button" class="models-add-btn" data-models-act="open-add" data-focus-key="models-open-add">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>添加模型提供商
            </button>
          </div>`;
      }
      const mode = state.addMode;
      const catalogKey = `add:${state.addCatalog}`;
      const catalogDraft = draftFor(catalogKey);
      const customDraftState = draftFor('custom');
      const locked = Boolean(catalogDraft?.busy || catalogDraft?.fetching || customDraftState?.busy || customDraftState?.fetching);
      const mounted = candidate => mode === candidate || state.visited.has(candidate);
      return `
        <div class="models-add-card">
          <div class="models-add-modes">
            <div class="models-segmented" role="tablist" aria-label="添加方式">
              <button type="button" role="tab" id="modelsAddTabCatalog" aria-selected="${mode === 'catalog'}" aria-controls="modelsAddPanelCatalog"
                data-models-act="add-mode" data-mode="catalog" data-focus-key="add-mode:catalog"${locked || !addable.length ? ' disabled' : ''}
                ${addable.length ? '' : ' title="目录中的提供商都已添加。"'}>第三方模型提供商</button>
              <button type="button" role="tab" id="modelsAddTabCustom" aria-selected="${mode === 'custom'}" aria-controls="modelsAddPanelCustom"
                data-models-act="add-mode" data-mode="custom" data-focus-key="add-mode:custom"${locked ? ' disabled' : ''}>自定义模型 API</button>
              <span class="models-segmented-thumb" data-mode="${mode}" aria-hidden="true"></span>
            </div>
            <p class="models-hint">${mode === 'catalog'
              ? '从内置目录中选择 OpenAI、Anthropic、Kimi、智谱、通义等提供商，填入其 API 密钥即可使用。'
              : '连接中转站、自部署服务或其他兼容 OpenAI / Anthropic 协议的接口，需填写 API 地址、协议和模型。'}</p>
          </div>
          ${mounted('catalog') && catalogDraft ? `
          <div class="models-add-panel" role="tabpanel" id="modelsAddPanelCatalog" aria-labelledby="modelsAddTabCatalog"${mode === 'catalog' ? '' : ' hidden'}>
            <label class="field"><span>提供商</span>
              <select data-models-act="pick-catalog" data-focus-key="add-catalog-select"${catalogDraft.busy ? ' disabled' : ''}>
                ${addable.map(entry => `<option value="${esc(entry.provider)}"${entry.provider === state.addCatalog ? ' selected' : ''}>${esc(entry.displayName)}</option>`).join('')}
              </select>
            </label>
            ${editorHtml(catalogKey, catalogDraft, { submitLabel: '添加', busyLabel: '添加中…' })}
          </div>` : ''}
          ${mounted('custom') && customDraftState ? `
          <div class="models-add-panel" role="tabpanel" id="modelsAddPanelCustom" aria-labelledby="modelsAddTabCustom"${mode === 'custom' ? '' : ' hidden'}>
            ${editorHtml('custom', customDraftState, { submitLabel: '创建提供商', busyLabel: '创建中…' })}
          </div>` : ''}
        </div>`;
    }

    function render() {
      const focusKey = findFocusKey(root);
      if (state.status === 'error' && !state.view) {
        root.innerHTML = `<p class="models-error" role="alert">加载提供商目录失败：${esc(state.error)}</p>
          <button type="button" class="btn-ghost" data-models-act="retry">重试</button>`;
        return;
      }
      if (!state.view) {
        root.innerHTML = '<div class="models-skeleton" aria-hidden="true"><span></span><span></span><span></span></div><p class="sr-only" role="status">正在读取模型配置…</p>';
        return;
      }
      root.innerHTML = `
        ${activeHtml()}
        ${state.saved ? `<p class="models-saved" role="status" aria-live="polite">${esc(state.saved)}</p>` : ''}
        <ul class="model-rows">${rowsHtml()}</ul>
        <div class="models-add">${addHtml()}</div>`;
      renderBadge();
      restoreFocusByKey(root, focusKey);
      rememberSignatures();
      if (motion && pendingEntrances.size) {
        for (const selector of pendingEntrances) {
          const nodes = [...root.querySelectorAll(selector)];
          if (nodes.length > 1) motion.staggerIn(nodes, { distance: 8, step: 30, stiffness: 'light' });
          else if (nodes[0]) motion.fadeSlideIn(nodes[0], { distance: 8, stiffness: 'light' });
        }
      }
      pendingEntrances.clear();
    }

    function enter(selector) {
      pendingEntrances.add(selector);
    }

    // —— 数据 ——
    async function load() {
      if (!state.view) {
        state.status = 'loading';
        render();
      }
      try {
        const firstLoad = !state.view;
        state.view = await request('/api/models');
        state.status = 'ready';
        state.error = '';
        if (firstLoad) enter('.model-row');
        // 行被别处删掉：关闭它的编辑卡，草稿随之作废
        if (state.editing && !providerRow(state.editing)) {
          state.drafts.delete(`row:${state.editing}`);
          state.editing = null;
        }
      } catch (error) {
        state.status = 'error';
        state.error = error.message;
      }
      render();
      return state.view;
    }

    function openEditor(provider) {
      const row = providerRow(provider);
      if (!row) return;
      state.saved = '';
      state.addOpen = false;
      if (state.editing === provider) {
        state.editing = null;
        state.drafts.delete(`row:${provider}`);
      } else {
        if (state.editing) state.drafts.delete(`row:${state.editing}`);
        state.editing = provider;
        state.drafts.set(`row:${provider}`, providerDraft(row));
        enter(`.model-row[data-provider="${CSS.escape(provider)}"] .model-editor`);
      }
      render();
    }

    function ensureCatalogDraft(provider) {
      const entry = catalogRow(provider);
      if (!entry) return;
      const key = `add:${provider}`;
      if (!state.drafts.has(key)) {
        state.drafts.set(key, providerDraft({
          ...entry,
          declared: false,
          baseUrlCustomized: false,
          defaultBaseUrl: entry.baseUrl,
          models: provider === 'deepseek' ? [] : [],
          modelsCustomized: false,
          keyConfigured: false
        }, { adopting: true }));
      }
    }

    function openAdd() {
      const addable = addableCatalog();
      state.saved = '';
      if (state.editing) state.drafts.delete(`row:${state.editing}`);
      state.editing = null;
      state.addOpen = true;
      state.addMode = addable.length ? 'catalog' : 'custom';
      state.visited = new Set([state.addMode]);
      state.addCatalog = addable[0]?.provider || '';
      for (const key of [...state.drafts.keys()]) if (key.startsWith('add:') || key === 'custom') state.drafts.delete(key);
      if (state.addCatalog) ensureCatalogDraft(state.addCatalog);
      state.drafts.set('custom', customDraft(state.view.protocols));
      enter('.models-add-card');
      render();
    }

    function closeAdd() {
      state.addOpen = false;
      for (const key of [...state.drafts.keys()]) if (key.startsWith('add:') || key === 'custom') state.drafts.delete(key);
      render();
      restoreFocusByKey(root, 'models-open-add');
    }

    function closeDraft(key) {
      if (key.startsWith('row:')) {
        state.drafts.delete(key);
        state.editing = null;
        render();
        restoreFocusByKey(root, `edit:${key.slice(4)}`);
      } else {
        closeAdd();
      }
    }

    function findRow(draft, uid) {
      return draft.rows.find(row => row.uid === uid);
    }

    function touchModels(draft) {
      draft.modelsTouched = true;
      draft.overridden = true;
    }

    // 保存请求体：只点名这张卡片看得见、且确实改过的字段
    function submitBody(draft) {
      const body = {};
      const key = draft.apiKey.trim();
      if (key) body.apiKey = key;
      if (draft.custom || draft.adopting) {
        if (draft.baseUrl.trim()) body.baseUrl = draft.baseUrl.trim();
      } else if (draft.baseUrl.trim() !== draft.initialBaseUrl) {
        body.baseUrl = draft.baseUrl.trim();
      }
      if (draft.custom || draft.adopting || draft.modelsTouched) {
        body.models = draft.overridden ? draft.rows.map(rowPayload) : null;
      }
      if (draft.declared) {
        body.displayName = draft.displayName.trim();
        body.api = draft.api;
      }
      if (draft.custom) body.provider = draft.provider.trim();
      return body;
    }

    async function submit(draftKey) {
      const draft = draftFor(draftKey);
      if (!draft || draft.busy) return;
      draft.busy = true;
      draft.failure = '';
      render();
      const body = submitBody(draft);
      try {
        let path;
        if (draft.custom) path = '/api/models/providers';
        else path = `/api/models/providers/${encodeURIComponent(draft.provider)}`;
        state.view = await request(path, { body });
        const row = providerRow(draft.custom ? body.provider : draft.provider);
        state.drafts.delete(draftKey);
        if (draftKey.startsWith('row:')) state.editing = null;
        else closeAddSilently();
        state.saved = `已保存 ${row ? label(row) : body.provider}。`;
        if (row) enter(`.model-row[data-provider="${CSS.escape(row.provider)}"]`);
        render();
        toast(`已保存 ${row?.displayName || body.provider}`);
      } catch (error) {
        draft.busy = false;
        draft.failure = error.message;
        render();
      }
    }

    function closeAddSilently() {
      state.addOpen = false;
      for (const key of [...state.drafts.keys()]) if (key.startsWith('add:') || key === 'custom') state.drafts.delete(key);
    }

    async function clearKey(draftKey) {
      const draft = draftFor(draftKey);
      if (!draft) return;
      const row = providerRow(draft.provider);
      if (!await confirm(`确定清除 ${row ? label(row) : draft.provider} 已由 Windows 安全保存的 API 密钥？清除后该提供商的模型无法再调用。`, { title: '清除密钥', okText: '清除' })) return;
      draft.busy = true;
      render();
      try {
        state.view = await request(`/api/models/providers/${encodeURIComponent(draft.provider)}`, { body: { clearKey: true } });
        const fresh = providerRow(draft.provider);
        draft.keyConfigured = Boolean(fresh?.keyConfigured);
        draft.apiKey = '';
        toast('API 密钥已清除');
      } catch (error) {
        draft.failure = error.message;
      } finally {
        draft.busy = false;
        render();
      }
    }

    async function removeProvider(provider) {
      const row = providerRow(provider);
      if (!row) return;
      const message = row.keyConfigured
        ? `删除 ${label(row)} 会移除其配置和存储的 API 密钥。`
        : `删除 ${label(row)} 会移除其配置。`;
      if (!await confirm(message, { title: `删除 ${label(row)}？`, okText: '删除' })) return;
      try {
        state.view = await request(`/api/models/providers/${encodeURIComponent(provider)}`, { method: 'DELETE' });
        if (state.editing === provider) {
          state.drafts.delete(`row:${provider}`);
          state.editing = null;
        }
        state.saved = '';
        render();
        toast(row.active ? `已删除 ${row.displayName}，分析模型回落到 ${providerRow(state.view.activeProvider)?.displayName || 'DeepSeek'}` : `已删除 ${row.displayName}`);
      } catch (error) {
        toast(`删除失败：${error.message}`, true);
      }
    }

    async function fetchModels(draftKey) {
      const draft = draftFor(draftKey);
      if (!draft || draft.fetching) return;
      draft.fetching = true;
      draft.fetchFailure = '';
      render();
      const body = { provider: draft.custom ? (draft.provider.trim() || 'custom-draft') : draft.provider };
      if (draft.baseUrl.trim()) body.baseUrl = draft.baseUrl.trim();
      if (draft.declared) body.api = draft.api;
      if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
      try {
        const answer = await request('/api/models/discover', { body });
        if (!answer.ok) {
          draft.fetchFailure = answer.error || '获取失败';
        } else if (!answer.models.length) {
          draft.fetchFailure = '该提供商没有列出任何模型，请手动添加。';
        } else {
          const known = new Set(draft.rows.map(row => row.id.trim()));
          state.picker = {
            draftKey,
            candidates: answer.models,
            picked: new Set(answer.models.filter(model => !known.has(model.id)).map(model => model.id)),
            query: ''
          };
          openPicker();
        }
      } catch (error) {
        draft.fetchFailure = error.message;
      } finally {
        draft.fetching = false;
        render();
      }
    }

    // —— 获取可用模型：勾选弹窗 ——
    function visibleCandidates() {
      const query = state.picker.query.trim().toLowerCase();
      return query
        ? state.picker.candidates.filter(model => model.id.toLowerCase().includes(query) || (model.name || '').toLowerCase().includes(query))
        : state.picker.candidates;
    }

    function renderPicker() {
      if (!picker || !state.picker) return;
      const list = picker.querySelector('[data-picker-list]');
      const visible = visibleCandidates();
      const allPicked = visible.length > 0 && visible.every(model => state.picker.picked.has(model.id));
      const toggle = picker.querySelector('[data-picker-act="toggle-all"]');
      toggle.textContent = allPicked ? '取消全选' : '全选';
      toggle.disabled = !visible.length;
      picker.querySelector('[data-picker-count]').textContent = `已选 ${state.picker.picked.size} / ${state.picker.candidates.length}`;
      list.innerHTML = visible.length
        ? visible.map(model => {
          const meta = [model.name && model.name !== model.id ? model.name : '', model.contextWindow ? `${formatCapacity(model.contextWindow)} 上下文` : '',
            Array.isArray(model.input) && model.input.includes('image') ? '图片' : ''].filter(Boolean).join(' · ');
          return `<li><label class="picker-item">
            <input type="checkbox" data-picker-id="${esc(model.id)}"${state.picker.picked.has(model.id) ? ' checked' : ''}>
            <span class="picker-id" title="${esc(model.name || model.id)}">${esc(model.id)}</span>
            ${meta ? `<small>${esc(meta)}</small>` : ''}
          </label></li>`;
        }).join('')
        : '<li class="picker-empty" role="status">没有匹配的模型。</li>';
    }

    function openPicker() {
      if (!picker) return;
      picker.querySelector('[data-picker-search]').value = '';
      renderPicker();
      if (!picker.open) picker.showModal();
      picker.querySelector('[data-picker-search]').focus();
    }

    function closePicker() {
      state.picker = null;
      if (picker?.open) picker.close();
    }

    function adoptPicked() {
      const pick = state.picker;
      if (!pick) return;
      const draft = draftFor(pick.draftKey);
      if (draft) {
        const byId = new Map(draft.rows.map(row => [row.id.trim(), row]));
        const added = [];
        for (const candidate of pick.candidates) {
          if (!pick.picked.has(candidate.id) || byId.has(candidate.id)) continue;
          const row = adoptCandidate(candidate);
          byId.set(candidate.id, row);
          added.push(row.uid);
        }
        draft.rows = [...byId.values()];
        touchModels(draft);
        draft.detailsOpen = true;
        for (const uid of added) enter(`.model-entry[data-uid="${uid}"]`);
      }
      const draftKey = pick.draftKey;
      closePicker();
      render();
      restoreFocusByKey(root, `${draftKey}:fetch`);
    }

    if (picker) {
      picker.addEventListener('input', event => {
        if (event.target.matches('[data-picker-search]') && state.picker) {
          state.picker.query = event.target.value;
          renderPicker();
        }
      });
      picker.addEventListener('change', event => {
        const id = event.target.getAttribute?.('data-picker-id');
        if (!id || !state.picker) return;
        if (event.target.checked) state.picker.picked.add(id);
        else state.picker.picked.delete(id);
        renderPicker();
      });
      picker.addEventListener('click', event => {
        const act = event.target.closest('[data-picker-act]')?.getAttribute('data-picker-act');
        if (!act || !state.picker) return;
        if (act === 'cancel') closePicker();
        if (act === 'adopt') adoptPicked();
        if (act === 'toggle-all') {
          const visible = visibleCandidates();
          if (visible.every(model => state.picker.picked.has(model.id))) state.picker.picked = new Set();
          else for (const model of visible) state.picker.picked.add(model.id);
          renderPicker();
        }
      });
      picker.addEventListener('close', () => { state.picker = null; });
    }

    async function selectActive(value) {
      // 提供商 ID 只含小写字母、数字与短横线，按第一个 | 切开；模型 ID 可以含 : / 等任意字符
      const text = String(value);
      const cut = text.indexOf('|');
      const provider = cut > 0 ? text.slice(0, cut) : '';
      const model = cut > 0 ? text.slice(cut + 1) : '';
      if (!provider || !model) return;
      state.activeBusy = true;
      state.testResult = null;
      render();
      try {
        state.view = await request('/api/models/active', { body: { provider, model } });
        const row = providerRow(provider);
        toast(`分析模型已切换为 ${model}（${row?.displayName || provider}），下轮分析生效`);
      } catch (error) {
        toast(`切换失败：${error.message}`, true);
      } finally {
        state.activeBusy = false;
        render();
      }
    }

    async function testActive() {
      state.testBusy = true;
      state.testResult = null;
      render();
      try {
        state.testResult = await request('/api/models/test', { body: { provider: state.view.activeProvider, model: state.view.activeModel } });
      } catch (error) {
        state.testResult = { ok: false, error: error.message };
      } finally {
        state.testBusy = false;
        render();
      }
    }

    // —— 事件 ——
    root.addEventListener('click', event => {
      const target = event.target.closest('[data-models-act]');
      if (!target || !root.contains(target) || target.tagName === 'SELECT') return;
      const act = target.getAttribute('data-models-act');
      const draftKey = target.getAttribute('data-draft');
      const draft = draftKey ? draftFor(draftKey) : null;
      const uid = target.getAttribute('data-uid');
      switch (act) {
        case 'retry': load(); break;
        case 'edit': openEditor(target.getAttribute('data-provider')); break;
        case 'fill-key': {
          // 警告里的“填入密钥”：直接展开当前提供商的编辑卡并把光标放进密钥框（已展开时不收起）
          const provider = target.getAttribute('data-provider');
          if (state.editing !== provider) openEditor(provider);
          const input = root.querySelector(`.model-row[data-provider="${CSS.escape(provider)}"] input[data-models-field="apiKey"]`);
          input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
          input?.focus({ preventScroll: true });
          break;
        }
        case 'remove': removeProvider(target.getAttribute('data-provider')); break;
        case 'open-add': openAdd(); break;
        case 'add-mode': {
          const mode = target.getAttribute('data-mode');
          if (mode === state.addMode) break;
          state.addMode = mode;
          state.visited.add(mode);
          render();
          break;
        }
        case 'cancel': closeDraft(draftKey); break;
        case 'submit': submit(draftKey); break;
        case 'clear-key': clearKey(draftKey); break;
        case 'fetch-models': fetchModels(draftKey); break;
        case 'test-active': testActive(); break;
        case 'reset-models':
          if (!draft) break;
          draft.rows = draft.defaults.map(draftRow);
          draft.overridden = false;
          draft.modelsTouched = true;
          draft.expanded = new Set();
          render();
          break;
        case 'add-row':
          if (!draft) break;
          {
            const row = draftRow();
            draft.rows.push(row);
            touchModels(draft);
            enter(`.model-entry[data-uid="${row.uid}"]`);
            render();
            restoreFocusByKey(root, `${draftKey}:${row.uid}:id`);
          }
          break;
        case 'remove-row':
          if (!draft) break;
          draft.rows = draft.rows.filter(row => row.uid !== uid);
          draft.expanded.delete(uid);
          touchModels(draft);
          render();
          break;
        case 'toggle-row':
          if (!draft) break;
          if (!draft.expanded.delete(uid)) {
            draft.expanded.add(uid);
            enter(`.model-entry[data-uid="${uid}"] .model-advanced`);
          }
          render();
          break;
        default: break;
      }
    });

    root.addEventListener('toggle', event => {
      const details = event.target;
      if (!details.matches?.('details.models-customized')) return;
      const draft = draftFor(details.getAttribute('data-draft'));
      if (draft) draft.detailsOpen = details.open;
    }, true);

    // 字段输入只改草稿；只有会改变校验结论或可用按钮的字段才重绘（焦点按 data-focus-key 复原）
    root.addEventListener('input', event => {
      const field = event.target.getAttribute?.('data-models-field');
      const draft = draftFor(event.target.getAttribute?.('data-draft'));
      if (!field || !draft) return;
      const value = event.target.value;
      const uid = event.target.getAttribute('data-uid');
      if (uid) {
        const row = findRow(draft, uid);
        if (!row) return;
        if (field === 'id') row.id = value;
        else if (field === 'name') row.name = value;
        else if (field === 'contextWindow') row.contextText = value;
        else if (field === 'maxTokens') row.maxTokensText = value;
        else if (field === 'image') return;
        touchModels(draft);
      } else if (field === 'apiKey') draft.apiKey = value;
      else if (field === 'baseUrl') draft.baseUrl = value;
      else if (field === 'displayName') draft.displayName = value;
      else if (field === 'provider') draft.provider = value.trim();
      else return;
      if (event.isComposing) return;
      refreshIfDerivedChanged(event.target.getAttribute('data-draft'));
    });

    root.addEventListener('compositionend', event => {
      const draftKey = event.target.getAttribute?.('data-draft');
      if (draftKey) refreshIfDerivedChanged(draftKey);
    });

    root.addEventListener('change', event => {
      const target = event.target;
      if (target.matches?.('[data-models-act="select-active"]')) { selectActive(target.value); return; }
      if (target.matches?.('[data-models-act="pick-catalog"]')) {
        state.addCatalog = target.value;
        ensureCatalogDraft(target.value);
        render();
        return;
      }
      const field = target.getAttribute?.('data-models-field');
      const draft = draftFor(target.getAttribute?.('data-draft'));
      if (!field || !draft) return;
      if (field === 'api') { draft.api = target.value; render(); return; }
      if (field === 'image') {
        const row = findRow(draft, target.getAttribute('data-uid'));
        if (!row) return;
        row.input = target.checked ? ['text', 'image'] : ['text'];
        touchModels(draft);
        render();
      }
    });

    // 击键不整段重绘：只有当编辑卡的派生状态（校验文案、按钮可用性、提示）变了才重绘，
    // 输入框本身的值由浏览器持有，中文输入法的组字过程不会被打断。
    const editorSignatures = new Map();
    function editorSignature(draftKey) {
      const draft = draftFor(draftKey);
      if (!draft || !state.view) return '';
      return editorHtml(draftKey, draft).replace(/\svalue="[^"]*"/g, '');
    }
    function rememberSignatures() {
      editorSignatures.clear();
      for (const key of state.drafts.keys()) editorSignatures.set(key, editorSignature(key));
    }
    function refreshIfDerivedChanged(draftKey) {
      if (editorSignature(draftKey) !== editorSignatures.get(draftKey)) renderPreservingCaret();
    }

    function renderPreservingCaret() {
      const active = root.ownerDocument?.activeElement;
      const caret = active && root.contains(active) && typeof active.selectionStart === 'number'
        ? [active.selectionStart, active.selectionEnd] : null;
      render();
      const now = root.ownerDocument?.activeElement;
      if (caret && now && typeof now.setSelectionRange === 'function') {
        try { now.setSelectionRange(caret[0], caret[1]); } catch {}
      }
    }

    return Object.freeze({ load, render, state });
  }


  // ======================================================================
  // 新闻推送 —— 绑定飞书 / 钉钉 / QQ 机器人，按自定时间把新情报推到手机。
  // 绑定是两步：填写连接信息 → 手机上收到 6 位验证码 → 回填验证码后才保存。
  // 推送时间与内容只用点选：改动先进本地草稿并立即重绘，短暂停顿后自动保存；保存在途时迟到的视图不覆盖草稿。
  // ======================================================================
  const PUSH_GUIDES = Object.freeze({
    feishu: Object.freeze({
      steps: Object.freeze([
        '在飞书新建或选择一个接收推送的群，打开 群设置 → 群机器人 → 添加机器人 → 自定义机器人，名称可填“摘星阁”（建议在电脑端添加，手机端同步收到消息）。',
        '安全设置勾选“签名校验”并复制密钥；也可以改用“自定义关键词”，关键词填“摘星阁”。',
        '复制 Webhook 地址，连同密钥粘贴到下方，点击“发送验证码”。'
      ]),
      fields: Object.freeze([
        Object.freeze({ name: 'webhook', label: 'Webhook 地址', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', secret: true }),
        Object.freeze({ name: 'secret', label: '签名校验密钥', placeholder: '选填，强烈建议填写', secret: true, optional: true })
      ])
    }),
    dingtalk: Object.freeze({
      steps: Object.freeze([
        '在钉钉新建或选择一个接收推送的群，打开 群设置 → 机器人 → 添加机器人 → 自定义（通过 Webhook 接入），自定义机器人需在电脑端钉钉添加。',
        '安全设置选择“加签”并复制以 SEC 开头的密钥；也可以选“自定义关键词”，关键词填“摘星阁”。',
        '完成后复制 Webhook 地址，连同密钥粘贴到下方，点击“发送验证码”。'
      ]),
      fields: Object.freeze([
        Object.freeze({ name: 'webhook', label: 'Webhook 地址', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…', secret: true }),
        Object.freeze({ name: 'secret', label: '加签密钥', placeholder: 'SEC 开头，选填，强烈建议填写', secret: true, optional: true })
      ])
    }),
    qq: Object.freeze({
      steps: Object.freeze([
        'QQ 官方机器人自 2025 年 4 月起不再支持主动推送，摘星阁改用通行的 OneBot v11 协议：在本机或局域网部署 NapCat（推荐）、Lagrange 或 LLOneBot，登录一个用来发消息的 QQ 小号。',
        '在其网络配置中新建“HTTP 服务器”（默认端口 3000）并设置 Token；用你的 QQ 与小号互加好友，或把小号拉进接收推送的群。',
        '填写 HTTP 地址、Token 与接收消息的 QQ 号（或群号），点击“发送验证码”。'
      ]),
      fields: Object.freeze([
        Object.freeze({ name: 'baseUrl', label: 'OneBot HTTP 地址', placeholder: 'http://127.0.0.1:3000' }),
        Object.freeze({ name: 'accessToken', label: 'Access Token', placeholder: '与 NapCat 中设置的 Token 一致', secret: true, optional: true }),
        Object.freeze({ name: 'targetType', label: '发送到', options: Object.freeze([['private', 'QQ 私聊'], ['group', 'QQ 群']]) }),
        Object.freeze({ name: 'targetId', label: '接收的 QQ 号 / 群号', placeholder: '例如 12345678', numeric: true })
      ])
    })
  });
  const PUSH_TRIGGERS = Object.freeze({ schedule: '定时', 'catch-up': '补推', manual: '手动', test: '测试' });
  const PUSH_CHANNEL_MARKS = Object.freeze({ feishu: '飞', dingtalk: '钉', qq: 'Q' });
  const PUSH_CHANNEL_HINTS = Object.freeze({
    feishu: '飞书群机器人 · Webhook，支持签名校验',
    dingtalk: '钉钉群机器人 · Webhook，支持加签',
    qq: 'QQ 私聊或群 · 经 NapCat 等 OneBot v11 服务'
  });
  const PUSH_MAX_TIMES = 12;
  const PUSH_INTERVALS = Object.freeze([[15, '15 分钟'], [30, '30 分钟'], [60, '1 小时'], [120, '2 小时'], [180, '3 小时'],
    [240, '4 小时'], [360, '6 小时'], [480, '8 小时'], [720, '12 小时']]);
  const PUSH_TIME_PRESETS = Object.freeze([
    Object.freeze(['早间一次', Object.freeze(['08:30'])]),
    Object.freeze(['早晚两次', Object.freeze(['08:30', '18:30'])]),
    Object.freeze(['早中晚三次', Object.freeze(['08:30', '12:30', '18:30'])])
  ]);
  const PUSH_DAY_PRESETS = Object.freeze([['每天', '1,2,3,4,5,6,7'], ['工作日', '1,2,3,4,5'], ['周末', '6,7']]);
  const PUSH_DAY_NAMES = Object.freeze(['一', '二', '三', '四', '五', '六', '日']);
  const PUSH_CHOICES = Object.freeze({
    scope: Object.freeze([['featured', '精选情报', '双评分入选的高价值情报'], ['relevant', '全部相关动态', '与低空 / 航天相关的全部动态']]),
    domain: Object.freeze([['all', '两个领域'], ['lowaltitude', '只看低空经济'], ['aerospace', '只看商业航天']]),
    maxItems: Object.freeze([[3, '3 条'], [5, '5 条'], [8, '8 条'], [10, '10 条'], [15, '15 条'], [20, '20 条']]),
    minHeat: Object.freeze([[0, '不限'], [40, '40 分以上'], [60, '60 分以上'], [80, '80 分以上']]),
    skipEmpty: Object.freeze([[true, '不发送', '没有新情报就不打扰'], [false, '发一条提示', '到点也发“本时段暂无新情报”']])
  });
  const PUSH_DRAFT_KEYS = Object.freeze(['mode', 'times', 'intervalMinutes', 'windowStart', 'windowEnd', 'weekdays',
    'scope', 'domain', 'maxItems', 'minHeat', 'skipEmpty']);

  function pad2(number) {
    return String(number).padStart(2, '0');
  }

  function clockMinutes(text) {
    if (text === '24:00') return 1440;
    const match = /^(\d{2}):(\d{2})$/.exec(String(text || ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function formatPushMoment(value, now = new Date()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    const dayDiff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate())
      - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const day = dayDiff === 0 ? '今天' : dayDiff === 1 ? '明天' : dayDiff === -1 ? '昨天' : `${date.getMonth() + 1}月${date.getDate()}日`;
    return `${day} ${clock}`;
  }

  function describeCountdown(value, now = new Date()) {
    const minutes = Math.round((new Date(value).getTime() - now.getTime()) / 60000);
    if (!Number.isFinite(minutes)) return '';
    if (minutes <= 1) return '即将推送';
    if (minutes < 60) return `约 ${minutes} 分钟后`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `约 ${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}后` : `约 ${Math.round(hours / 24)} 天后`;
  }

  // 设置页草稿 → 提交给后端的补丁。所有字段都来自选项，这里只拦“删光了”这类结构性问题。
  function pushDraftPatch(draft) {
    const patch = {};
    for (const key of PUSH_DRAFT_KEYS) patch[key] = Array.isArray(draft[key]) ? [...draft[key]] : draft[key];
    if (!patch.weekdays?.length) return { error: '请至少保留一个推送日。' };
    if (!patch.times?.length) return { error: '请至少保留一个推送时刻。' };
    if (clockMinutes(patch.windowEnd) <= clockMinutes(patch.windowStart)) return { error: '推送时段的结束时间必须晚于开始时间。' };
    return { patch };
  }

  // 今天的时刻表：已过 / 下一次 / 稍后。时刻很多（例如每 15 分钟）时只列出接下来的几个，其余折叠成计数。
  function planTimeline(slots, { now = new Date(), nextRunAt = null, limit = 10 } = {}) {
    const current = now.getHours() * 60 + now.getMinutes();
    const next = nextRunAt ? new Date(nextRunAt) : null;
    const nextToday = next && next.toDateString() === now.toDateString() ? `${pad2(next.getHours())}:${pad2(next.getMinutes())}` : null;
    const entries = (slots || []).map(time => ({
      time,
      state: time === nextToday ? 'next' : clockMinutes(time) <= current ? 'past' : 'later'
    }));
    if (entries.length <= limit + 2) return { entries, pastHidden: 0, laterHidden: 0 };
    const upcoming = entries.filter(entry => entry.state !== 'past');
    const shown = upcoming.slice(0, limit);
    return { entries: shown, pastHidden: entries.length - upcoming.length, laterHidden: upcoming.length - shown.length };
  }

  function createPushSettings({ elements, request, toast = () => {}, confirm = async () => true, escapeHTML, now = () => new Date(),
    saveDelayMs = 320 } = {}) {
    const required = ['enabled', 'hero', 'nextRun', 'heroDetail', 'timeline', 'badge', 'channels', 'bindPanel', 'schedule', 'content',
      'preview', 'pushNow', 'status', 'previewList', 'logSummary', 'history'];
    if (!elements || typeof request !== 'function' || typeof escapeHTML !== 'function') {
      throw new TypeError('push settings elements, request and escapeHTML are required');
    }
    for (const name of required) {
      if (!elements[name]) throw new TypeError(`push settings element is required: ${name}`);
    }
    const esc = escapeHTML;
    const state = { view: null, draft: null, revision: 0, saved: 0, saveTimer: null, saving: null,
      pick: null, bind: null, busy: new Set(), channelStatus: {} };

    function setStatus(text, tone = '') {
      elements.status.textContent = text || '';
      elements.status.className = `test-result desktop-settings-result${tone ? ` ${tone}` : ''}`;
    }

    function draftFrom(settings) {
      const draft = {};
      for (const key of PUSH_DRAFT_KEYS) draft[key] = Array.isArray(settings[key]) ? [...settings[key]] : settings[key];
      return draft;
    }

    // ---------- 选项渲染（全部是点选，没有需要手填的数字） ----------
    function choice(group, value, label, { on, title = '', extra = '' } = {}) {
      return `<button class="chip${on ? ' active' : ''}" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}"
        data-push-set="${group}" data-value="${esc(String(value))}"${title ? ` title="${esc(title)}"` : ''}${extra}>${esc(label)}</button>`;
    }

    function radioGroup(group, label, options, current) {
      const known = options.some(([value]) => value === current);
      const list = known ? options : [...options, [current, group === 'minHeat' ? `${current} 分以上` : `${current} 条`]];
      return `<div class="cat-chips period-switch" role="radiogroup" aria-label="${esc(label)}">${list
        .map(([value, text, title]) => choice(group, value, text, { on: value === current, title })).join('')}</div>`;
    }

    function option(label, body, hint = '') {
      return `<div class="set-row"><span>${esc(label)}</span><div class="set-row-body">${body}${hint ? `<small>${esc(hint)}</small>` : ''}</div></div>`;
    }

    function timeOptions(from, to, step, selected) {
      const list = [];
      for (let minute = from; minute <= to; minute += step) {
        const text = minute === 1440 ? '24:00' : `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
        list.push(text);
      }
      if (selected && !list.includes(selected)) list.push(selected);
      return list.sort((a, b) => clockMinutes(a) - clockMinutes(b))
        .map(text => `<option value="${text}"${text === selected ? ' selected' : ''}>${text}</option>`).join('');
    }

    function defaultPick() {
      const current = now();
      return { hour: (current.getHours() + 1) % 24, minute: 0 };
    }

    function renderSchedule() {
      const draft = state.draft;
      const pick = state.pick || (state.pick = defaultPick());
      const mode = `<div class="cat-chips period-switch" role="radiogroup" aria-label="推送方式">
        ${choice('mode', 'times', '每天固定时刻', { on: draft.mode === 'times' })}${choice('mode', 'interval', '按间隔推送', { on: draft.mode === 'interval' })}</div>`;
      let rows = option('推送方式', mode, draft.mode === 'times' ? '到了你选的时刻就推送，适合每天看几次简报。' : '在推送时段内按固定间隔推送，适合盯紧动态。');
      if (draft.mode === 'times') {
        const chips = draft.times.map(time => `<button class="chip active push-time" type="button" data-push-remove="${time}"
          aria-label="移除 ${time}" title="点击移除">${time}<span aria-hidden="true">×</span></button>`).join('');
        const hours = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}"${hour === pick.hour ? ' selected' : ''}>${pad2(hour)} 时</option>`).join('');
        const minutes = Array.from({ length: 12 }, (_, index) => index * 5)
          .map(minute => `<option value="${minute}"${minute === pick.minute ? ' selected' : ''}>${pad2(minute)} 分</option>`).join('');
        const full = draft.times.length >= PUSH_MAX_TIMES;
        const presets = PUSH_TIME_PRESETS.map(([label, times]) => {
          const on = times.join(',') === draft.times.join(',');
          return `<button class="chip${on ? ' active' : ''}" type="button" aria-pressed="${on}" data-push-preset="${times.join(',')}">${esc(label)}</button>`;
        }).join('');
        rows += option('推送时刻', `<div class="cat-chips" role="list" aria-label="已选推送时刻">${chips}</div>
          <div class="push-pick"><select data-push-pick="hour" aria-label="添加时刻：小时">${hours}</select>
            <select data-push-pick="minute" aria-label="添加时刻：分钟">${minutes}</select>
            <button class="btn-ghost btn-compact" type="button" data-push-add ${full ? 'disabled' : ''}>＋ 添加</button></div>
          <div class="cat-chips" aria-label="常用组合">${presets}</div>`, full ? `已达上限 ${PUSH_MAX_TIMES} 个时刻。` : '点已选时刻可移除；也可以直接套用常用组合。');
      } else {
        const allDay = draft.windowStart === '00:00' && draft.windowEnd === '24:00';
        const start = clockMinutes(draft.windowStart);
        const end = clockMinutes(draft.windowEnd);
        rows += option('间隔', radioGroup('intervalMinutes', '推送间隔', PUSH_INTERVALS, draft.intervalMinutes));
        rows += option('推送时段', `<div class="push-pick">
            <select data-push-window="windowStart" aria-label="推送时段开始">${timeOptions(0, Math.min(end - 30, 1410), 30, draft.windowStart)}</select>
            <span class="muted">至</span>
            <select data-push-window="windowEnd" aria-label="推送时段结束">${timeOptions(Math.max(start + 30, 30), 1440, 30, draft.windowEnd)}</select>
            <button class="chip${allDay ? ' active' : ''}" type="button" aria-pressed="${allDay}" data-push-allday>全天</button></div>`,
        `从 ${draft.windowStart} 起每 ${PUSH_INTERVALS.find(([value]) => value === draft.intervalMinutes)?.[1] || `${draft.intervalMinutes} 分钟`}推送一次，时段之外不打扰。`);
      }
      const days = draft.weekdays.join(',');
      const presets = PUSH_DAY_PRESETS.map(([label, value]) => `<button class="chip${days === value ? ' active' : ''}" type="button"
        aria-pressed="${days === value}" data-push-days="${value}">${label}</button>`).join('');
      const single = PUSH_DAY_NAMES.map((name, index) => {
        const on = draft.weekdays.includes(index + 1);
        return `<button class="chip${on ? ' active' : ''}" type="button" aria-pressed="${on}" data-push-day="${index + 1}" aria-label="周${name}">${name}</button>`;
      }).join('');
      rows += option('推送日', `<div class="cat-chips">${presets}<span class="push-divider" aria-hidden="true"></span>${single}</div>`);
      return rows;
    }

    function renderContent() {
      const draft = state.draft;
      return option('推送范围', radioGroup('scope', '推送范围', PUSH_CHOICES.scope, draft.scope),
        PUSH_CHOICES.scope.find(([value]) => value === draft.scope)?.[2])
        + option('关注领域', radioGroup('domain', '关注领域', PUSH_CHOICES.domain, draft.domain))
        + option('每次最多', radioGroup('maxItems', '每次最多条数', PUSH_CHOICES.maxItems, draft.maxItems), '按热度从高到低截取。')
        + option('热度门槛', radioGroup('minHeat', '最低热度', PUSH_CHOICES.minHeat, draft.minHeat))
        + option('没有新情报时', radioGroup('skipEmpty', '没有新情报时', PUSH_CHOICES.skipEmpty, draft.skipEmpty),
          PUSH_CHOICES.skipEmpty.find(([value]) => value === draft.skipEmpty)?.[2]);
    }

    // 重绘选项时保住键盘焦点：按同一个 data-* 选择器找回对应按钮
    function focusKey(node) {
      if (!node?.dataset) return null;
      for (const name of ['pushSet', 'pushRemove', 'pushPreset', 'pushDays', 'pushDay', 'pushPick', 'pushWindow']) {
        if (node.dataset[name] !== undefined) {
          const attr = `data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
          return name === 'pushSet' ? `[${attr}="${node.dataset.pushSet}"][data-value="${node.dataset.value}"]` : `[${attr}="${node.dataset[name]}"]`;
        }
      }
      if (node.matches?.('[data-push-add]')) return '[data-push-add]';
      if (node.matches?.('[data-push-allday]')) return '[data-push-allday]';
      return null;
    }

    function renderOptions() {
      if (!state.draft) return;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const host = [elements.schedule, elements.content].find(node => node.contains?.(active));
      const key = host ? focusKey(active) : null;
      elements.schedule.innerHTML = renderSchedule();
      elements.content.innerHTML = renderContent();
      if (host && key) (host.querySelector(key) || host.querySelector('[data-push-set][aria-checked="true"]'))?.focus();
    }

    // ---------- 状态区 ----------
    function channelCard(channel) {
      const busy = state.busy.has(channel.id);
      const status = state.channelStatus[channel.id];
      const binding = state.bind?.channel === channel.id;
      const badge = channel.bound
        ? `<span class="push-badge ${channel.enabled ? 'on' : 'off'}">${channel.enabled ? '推送中' : '已暂停'}</span>`
        : channel.pending ? '<span class="push-badge">待验证</span>' : '';
      const detail = channel.bound ? [channel.target, channel.security].filter(Boolean).join(' · ') : PUSH_CHANNEL_HINTS[channel.id];
      const disabled = busy ? ' disabled' : '';
      const actions = channel.bound
        ? `<button class="btn-ghost btn-compact" type="button" data-push-act="test"${disabled}>发送测试</button>
           <button class="btn-ghost btn-compact" type="button" data-push-act="toggle"${disabled}>${channel.enabled ? '暂停' : '恢复'}</button>
           <button class="btn-ghost btn-compact" type="button" data-push-act="rebind"${disabled}>重新绑定</button>
           <button class="btn-ghost btn-compact" type="button" data-push-act="unbind"${disabled}>解绑</button>`
        : `<button class="${binding ? 'btn-ghost' : 'btn-primary'} btn-compact" type="button" data-push-act="bind"${disabled}>${binding ? '绑定中…' : '绑定'}</button>`;
      return `<section class="push-channel${channel.bound && channel.enabled ? ' is-on' : ''}" data-push-channel="${esc(channel.id)}" aria-label="${esc(channel.name)}">
        <i aria-hidden="true">${PUSH_CHANNEL_MARKS[channel.id] || ''}</i>
        <div><h4>${esc(channel.name)}${badge}</h4><p>${esc(detail || '')}</p></div>
        <div class="btn-row">${actions}</div>
        <span class="test-result maintenance-action-status${status?.tone ? ` ${status.tone}` : ''}" role="status" aria-live="polite">${esc(status?.text || '')}</span>
      </section>`;
    }

    function renderChannels() {
      const channels = state.view?.channels || [];
      elements.channels.innerHTML = channels.map(channelCard).join('');
      const bound = channels.filter(channel => channel.bound);
      elements.badge.textContent = bound.length ? `已绑定 ${bound.map(channel => channel.shortName).join(' · ')}` : '尚未绑定';
    }

    function bindField(field, values) {
      const id = `pushBind-${field.name}`;
      if (field.options) {
        return `<label class="field"><span>${esc(field.label)}</span><select id="${id}" data-bind-field="${field.name}">${field.options
          .map(([value, label]) => `<option value="${esc(value)}"${values[field.name] === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
      }
      return `<label class="field"><span>${esc(field.label)}${field.optional ? ' <span class="muted">选填</span>' : ''}</span>
        <input id="${id}" data-bind-field="${field.name}" type="${field.secret ? 'password' : 'text'}" ${field.numeric ? 'inputmode="numeric"' : ''}
          autocomplete="off" spellcheck="false" placeholder="${esc(field.placeholder || '')}" value="${esc(values[field.name] || '')}"></label>`;
    }

    function renderBindPanel() {
      const bind = state.bind;
      const panel = elements.bindPanel;
      if (!bind) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
      }
      const channel = state.view?.channels.find(entry => entry.id === bind.channel);
      const guide = PUSH_GUIDES[bind.channel];
      const name = channel?.name || bind.channel;
      const form = `<div class="field-row">${guide.fields.map(field => bindField(field, bind.values)).join('')}</div>`;
      const codeStep = bind.step === 'code'
        ? `<div class="field-row"><label class="field"><span>手机上收到的 6 位验证码 <span class="muted">10 分钟内有效</span></span>
             <input id="pushBindCode" data-bind-code type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="例如 428193"></label></div>`
        : '';
      const buttons = bind.step === 'code'
        ? `<button class="btn-primary" type="button" data-bind-act="verify" ${bind.busy ? 'disabled' : ''}>完成绑定</button>
           <button class="btn-ghost" type="button" data-bind-act="send" ${bind.busy ? 'disabled' : ''}>重新发送验证码</button>`
        : `<button class="btn-primary" type="button" data-bind-act="send" ${bind.busy ? 'disabled' : ''}>${bind.busy ? '发送中…' : '发送验证码'}</button>`;
      panel.innerHTML = `<div><h4>绑定${/^[A-Za-z]/.test(name) ? ' ' : ''}${esc(name)}</h4>
          <ol class="hint" style="margin:0 0 var(--sp-3);padding-left:1.25rem">${guide.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
          ${form}${codeStep}</div>
        <div class="btn-row">${buttons}<button class="btn-ghost" type="button" data-bind-act="cancel">取消</button></div>
        <span class="test-result maintenance-action-status${bind.tone ? ` ${bind.tone}` : ''}" role="status" aria-live="polite">${esc(bind.message || '')}</span>`;
      panel.hidden = false;
    }

    function renderTimeline(view, current) {
      const slots = view.today || [];
      if (!slots.length) {
        elements.timeline.innerHTML = '<li class="push-slots-label">今天不是推送日</li>';
        return;
      }
      const plan = planTimeline(slots, { now: current, nextRunAt: view.settings.enabled ? view.nextRunAt : null });
      const pills = plan.entries.map(entry => `<li class="${entry.state === 'next' ? 'is-next' : entry.state === 'past' ? 'is-past' : ''}"
        ${entry.state === 'next' ? 'aria-current="time"' : ''}>${entry.time}</li>`).join('');
      elements.timeline.innerHTML = `<li class="push-slots-label">今天</li>${plan.pastHidden ? `<li class="is-past">已过 ${plan.pastHidden} 次</li>` : ''}${pills}${plan.laterHidden ? `<li class="push-slots-label">另有 ${plan.laterHidden} 次</li>` : ''}`;
    }

    function renderSummary() {
      const view = state.view;
      if (!view) return;
      const current = now();
      const anyBound = view.channels.some(channel => channel.bound);
      const active = view.channels.filter(channel => channel.enabled).map(channel => channel.shortName);
      const on = view.settings.enabled === true;
      elements.enabled.checked = on;
      elements.enabled.disabled = !anyBound && !on;
      let title;
      let detail;
      if (!anyBound) {
        title = '先绑定一个机器人';
        detail = '在下方“推送到”里绑定飞书、钉钉或 QQ，验证成功后即可开启定时推送。';
      } else if (!on) {
        title = '定时推送已关闭';
        detail = `打开右侧开关后，按“${view.schedule}”推送到${active.join('、') || '已绑定的机器人'}。`;
      } else if (!active.length) {
        title = '机器人都已暂停';
        detail = '在下方“推送到”里恢复至少一个机器人。';
      } else if (view.nextRunAt) {
        title = `下一次 ${formatPushMoment(view.nextRunAt, current)}`;
        detail = `${describeCountdown(view.nextRunAt, current)} · ${view.schedule} · 推送到${active.join('、')}`;
      } else {
        title = '没有可用的推送时刻';
        detail = '请检查下方的推送时间。';
      }
      elements.nextRun.textContent = title;
      elements.heroDetail.textContent = detail;
      elements.hero.classList.toggle('is-on', on && active.length > 0);
      elements.pushNow.hidden = !active.length;
      renderTimeline(view, current);
      const last = view.history.find(entry => entry.trigger !== 'test' && entry.ok && !entry.skipped);
      elements.logSummary.textContent = `${last ? `最近 ${formatPushMoment(last.at, current)} · ${last.channelName} ${last.count} 条` : '尚无推送'} · 累计 ${view.totals.pushes} 次 ${view.totals.items} 条`;
      elements.history.innerHTML = view.history.length ? view.history.slice(0, 8).map(entry => {
        const outcome = !entry.ok ? `失败：${entry.error || '未知原因'}`
          : entry.skipped ? '没有新情报，未打扰' : `已送达 ${entry.count} 条`;
        return `<li class="note-item"><div class="note-body"><p>${esc(entry.channelName)} · ${esc(PUSH_TRIGGERS[entry.trigger] || entry.trigger)} · ${esc(outcome)}</p>
          <span class="note-time">${esc(formatPushMoment(entry.at, current))}</span></div></li>`;
      }).join('') : '<li class="note-item"><div class="note-body"><p class="muted">还没有推送记录。</p></div></li>';
      if (!elements.status.textContent && on && !view.collectAutomatic) {
        setStatus('提示：“自动采集”尚未开启，推送只会包含手动“立即采集分析”得到的新情报。', 'warning');
      }
    }

    function render() {
      if (!state.view) return;
      // 保存回来的设置与草稿一致时不重绘选项，避免关掉用户刚展开的下拉框
      const next = state.revision === state.saved ? draftFrom(state.view.settings) : state.draft;
      const changed = !elements.schedule.firstChild || JSON.stringify(next) !== JSON.stringify(state.draft);
      state.draft = next;
      if (changed) renderOptions();
      renderChannels();
      renderBindPanel();
      renderSummary();
    }

    async function load() {
      const revision = state.revision;
      try {
        const view = await request('/api/push');
        state.view = view;
        if (revision === state.revision) state.saved = state.revision;
        render();
        return view;
      } catch (error) {
        elements.channels.innerHTML = `<p class="muted">读取推送设置失败：${esc(error.message)}</p>`;
        return null;
      }
    }

    function adopt(view) {
      if (view && Array.isArray(view.channels)) {
        state.view = view;
        render();
      }
    }

    // ---------- 自动保存 ----------
    async function save() {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
      const { patch, error } = pushDraftPatch(state.draft);
      if (error) {
        setStatus(error, 'fail');
        throw new Error(error);
      }
      const revision = state.revision;
      const run = (async () => {
        await state.saving?.catch(() => {});
        const view = await request('/api/push/settings', { body: patch });
        if (revision === state.revision) state.saved = revision;
        adopt(view);
        return view;
      })();
      state.saving = run;
      try {
        const view = await run;
        if (revision === state.revision) setStatus(`已自动保存 · ${view.schedule}`, 'ok');
        return view;
      } catch (failure) {
        setStatus(`保存失败：${failure.message}`, 'fail');
        throw failure;
      } finally {
        if (state.saving === run) state.saving = null;
      }
    }

    function change(mutate) {
      if (!state.draft) return;
      const message = mutate(state.draft);
      if (typeof message === 'string') {
        setStatus(message, 'warning');
        return;
      }
      state.revision += 1;
      renderOptions();
      setStatus('正在保存…');
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => { save().catch(() => {}); }, saveDelayMs);
    }

    function parseChoice(group, raw) {
      if (group === 'skipEmpty') return raw === 'true';
      if (['intervalMinutes', 'maxItems', 'minHeat'].includes(group)) return Number(raw);
      return raw;
    }

    function addTime(draft) {
      const pick = state.pick || defaultPick();
      const time = `${pad2(pick.hour)}:${pad2(pick.minute)}`;
      if (draft.times.includes(time)) return `${time} 已在推送时刻里。`;
      if (draft.times.length >= PUSH_MAX_TIMES) return `每天最多 ${PUSH_MAX_TIMES} 个推送时刻。`;
      draft.times = [...draft.times, time].sort((a, b) => clockMinutes(a) - clockMinutes(b));
      state.pick = { hour: (pick.hour + 1) % 24, minute: pick.minute };
      return null;
    }

    function onOptionClick(event) {
      const target = event.target.closest('button');
      if (!target || target.disabled) return;
      const data = target.dataset;
      if (data.pushSet) {
        change(draft => { draft[data.pushSet] = parseChoice(data.pushSet, data.value); });
      } else if (data.pushRemove) {
        change(draft => {
          if (draft.times.length <= 1) return '至少保留一个推送时刻；想停止推送请关闭上方开关。';
          draft.times = draft.times.filter(time => time !== data.pushRemove);
          return null;
        });
      } else if (data.pushPreset) {
        change(draft => { draft.times = data.pushPreset.split(','); });
      } else if (target.matches('[data-push-add]')) {
        change(addTime);
      } else if (target.matches('[data-push-allday]')) {
        change(draft => {
          const allDay = draft.windowStart === '00:00' && draft.windowEnd === '24:00';
          [draft.windowStart, draft.windowEnd] = allDay ? ['08:00', '22:00'] : ['00:00', '24:00'];
        });
      } else if (data.pushDays) {
        change(draft => { draft.weekdays = data.pushDays.split(',').map(Number); });
      } else if (data.pushDay) {
        const day = Number(data.pushDay);
        change(draft => {
          if (draft.weekdays.includes(day) && draft.weekdays.length === 1) return '至少保留一个推送日。';
          draft.weekdays = draft.weekdays.includes(day) ? draft.weekdays.filter(value => value !== day) : [...draft.weekdays, day].sort((a, b) => a - b);
          return null;
        });
      }
    }

    function onOptionChange(event) {
      const select = event.target;
      if (select.dataset.pushPick) {
        state.pick = { ...(state.pick || defaultPick()), [select.dataset.pushPick]: Number(select.value) };
      } else if (select.dataset.pushWindow) {
        change(draft => { draft[select.dataset.pushWindow] = select.value; });
      }
    }

    // 单选组：方向键在组内移动并立即选中（与系统单选按钮一致）
    function onOptionKeydown(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const button = event.target.closest('[data-push-set]');
      const group = button?.closest('[role="radiogroup"]');
      if (!group) return;
      const buttons = [...group.querySelectorAll('[data-push-set]')];
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const next = buttons[(buttons.indexOf(button) + step + buttons.length) % buttons.length];
      event.preventDefault();
      next.focus();
      next.click();
    }

    async function toggleEnabled(enabled) {
      const anyBound = state.view?.channels.some(channel => channel.bound);
      if (enabled && !anyBound) {
        elements.enabled.checked = false;
        setStatus('请先在下方绑定至少一个机器人，再开启定时推送。', 'fail');
        return;
      }
      elements.enabled.disabled = true;
      try {
        if (state.saveTimer || state.saving) await save();
        const view = await request('/api/push/settings', { body: { enabled } });
        adopt(view);
        setStatus(enabled ? `定时推送已开启：${view.schedule}。` : '定时推送已关闭，已绑定的机器人保留。', enabled ? 'ok' : '');
      } catch (failure) {
        elements.enabled.checked = !enabled;
        setStatus(`保存失败：${failure.message}`, 'fail');
      } finally {
        renderSummary();
      }
    }

    async function showPreview() {
      elements.preview.disabled = true;
      try {
        if (state.saveTimer || state.saving) await save();
        const preview = await request('/api/push/preview');
        const list = elements.previewList;
        if (!preview.items.length) {
          list.hidden = true;
          list.innerHTML = '';
          setStatus('当前没有尚未推送的新情报；有新入选内容后会在下一次推送时送达。');
          return preview;
        }
        list.innerHTML = preview.items.map((item, index) => `<li class="note-item"><div class="note-body"><p>${index + 1}. ${esc(item.title)}</p>
          <span class="note-time">${esc([item.source, Number.isFinite(item.heat) ? `热度 ${Math.round(item.heat)}` : ''].filter(Boolean).join(' · '))}</span></div></li>`).join('');
        list.hidden = false;
        setStatus(`下一次推送预计包含 ${preview.items.length} 条。`);
        return preview;
      } catch (error) {
        setStatus(`预览失败：${error.message}`, 'fail');
        return null;
      } finally {
        elements.preview.disabled = false;
      }
    }

    async function pushNow() {
      if (!state.view?.channels.some(channel => channel.enabled)) {
        setStatus('请先绑定并启用至少一个机器人。', 'fail');
        return null;
      }
      elements.pushNow.disabled = true;
      setStatus('正在推送…');
      try {
        if (state.saveTimer || state.saving) await save();
        const result = await request('/api/push/run', { body: {} });
        adopt(result.view);
        const parts = (result.results || []).map(entry => {
          const name = state.view.channels.find(channel => channel.id === entry.channel)?.shortName || entry.channel;
          return !entry.ok ? `${name}失败：${entry.error}` : entry.skipped ? `${name}没有新情报` : `${name}已送达 ${entry.count} 条`;
        });
        const failed = (result.results || []).some(entry => !entry.ok);
        setStatus(parts.join('；') || '没有可推送的机器人。', failed ? 'fail' : 'ok');
        if (!failed) toast('推送已完成');
        return result;
      } catch (error) {
        setStatus(`推送失败：${error.message}`, 'fail');
        return null;
      } finally {
        elements.pushNow.disabled = false;
      }
    }

    // ---------- 渠道 ----------
    function openBind(id) {
      const defaults = id === 'qq' ? { baseUrl: 'http://127.0.0.1:3000', targetType: 'private' } : {};
      state.bind = { channel: id, step: 'form', values: defaults, busy: false, message: '', tone: '' };
      renderChannels();
      renderBindPanel();
      elements.bindPanel.querySelector('[data-bind-field]')?.focus();
    }

    function readBindValues() {
      const values = { ...state.bind.values };
      for (const input of elements.bindPanel.querySelectorAll('[data-bind-field]')) values[input.dataset.bindField] = input.value.trim();
      return values;
    }

    async function sendCode() {
      const bind = state.bind;
      bind.values = readBindValues();
      bind.busy = true;
      bind.message = '正在向机器人发送验证码…';
      bind.tone = '';
      renderBindPanel();
      try {
        const result = await request(`/api/push/channels/${bind.channel}/bind`, { body: bind.values });
        if (state.bind !== bind) return result;
        if (result.ok) {
          bind.step = 'code';
          bind.message = `验证码已发送到 ${result.target}，请查看手机。`;
          bind.tone = 'ok';
        } else {
          bind.message = result.error || '发送失败';
          bind.tone = 'fail';
        }
        return result;
      } catch (error) {
        bind.message = error.message;
        bind.tone = 'fail';
        return null;
      } finally {
        bind.busy = false;
        if (state.bind === bind) {
          renderBindPanel();
          elements.bindPanel.querySelector(bind.step === 'code' ? '[data-bind-code]' : '[data-bind-field]')?.focus();
        }
      }
    }

    async function verifyCode() {
      const bind = state.bind;
      const code = elements.bindPanel.querySelector('[data-bind-code]')?.value.replace(/\s+/g, '') || '';
      if (!/^\d{6}$/.test(code)) {
        bind.message = '请输入手机上收到的 6 位数字验证码。';
        bind.tone = 'fail';
        renderBindPanel();
        return null;
      }
      bind.values = readBindValues();
      bind.busy = true;
      renderBindPanel();
      try {
        const result = await request(`/api/push/channels/${bind.channel}/verify`, { body: { code } });
        state.bind = null;
        state.channelStatus[bind.channel] = { text: '绑定成功，手机上会收到一条确认消息。', tone: 'ok' };
        adopt(result.view);
        toast(`${state.view.channels.find(channel => channel.id === bind.channel)?.name || '机器人'}绑定成功`);
        if (!state.view.settings.enabled) setStatus('绑定完成。选好下方的推送时间，再打开上方开关即可开始定时推送。', 'ok');
        return result;
      } catch (error) {
        bind.busy = false;
        bind.message = error.message;
        bind.tone = 'fail';
        renderBindPanel();
        return null;
      }
    }

    async function channelAction(id, action) {
      const channel = state.view?.channels.find(entry => entry.id === id);
      if (!channel) return;
      if (action === 'bind' || action === 'rebind') return openBind(id);
      if (action === 'unbind' && !await confirm(`解绑后将删除本机加密保存的${channel.name}连接信息，并停止向它推送。`, { title: `解绑${channel.name}？`, okText: '解绑' })) return;
      state.busy.add(id);
      state.channelStatus[id] = { text: action === 'test' ? '正在发送测试消息…' : '正在保存…', tone: '' };
      renderChannels();
      try {
        if (action === 'test') {
          const result = await request(`/api/push/channels/${id}/test`, { body: {} });
          state.channelStatus[id] = result.ok ? { text: '测试消息已发出，请查看手机。', tone: 'ok' } : { text: result.error, tone: 'fail' };
          await load();
        } else if (action === 'toggle') {
          adopt(await request(`/api/push/channels/${id}/enabled`, { body: { enabled: !channel.enabled } }));
          state.channelStatus[id] = { text: channel.enabled ? '已暂停向它推送。' : '已恢复推送。', tone: '' };
        } else if (action === 'unbind') {
          adopt(await request(`/api/push/channels/${id}`, { method: 'DELETE' }));
          state.channelStatus[id] = { text: '已解绑，连接信息已从本机删除。', tone: '' };
        }
      } catch (error) {
        state.channelStatus[id] = { text: error.message, tone: 'fail' };
      } finally {
        state.busy.delete(id);
        renderChannels();
        renderSummary();
      }
    }

    // ---------- 接线 ----------
    elements.channels.addEventListener('click', event => {
      const button = event.target.closest('[data-push-act]');
      const card = button?.closest('[data-push-channel]');
      if (button && card) channelAction(card.dataset.pushChannel, button.dataset.pushAct).catch(() => {});
    });
    elements.bindPanel.addEventListener('click', event => {
      const act = event.target.closest('[data-bind-act]')?.dataset.bindAct;
      if (!act || !state.bind || state.bind.busy) return;
      if (act === 'cancel') {
        state.bind = null;
        renderBindPanel();
        renderChannels();
      } else if (act === 'send') sendCode().catch(() => {});
      else if (act === 'verify') verifyCode().catch(() => {});
    });
    elements.bindPanel.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || !state.bind || state.bind.busy || event.target.tagName !== 'INPUT') return;
      event.preventDefault();
      (state.bind.step === 'code' ? verifyCode() : sendCode()).catch(() => {});
    });
    for (const host of [elements.schedule, elements.content]) {
      host.addEventListener('click', onOptionClick);
      host.addEventListener('change', onOptionChange);
      host.addEventListener('keydown', onOptionKeydown);
    }
    elements.enabled.addEventListener('change', event => { toggleEnabled(event.currentTarget.checked).catch(() => {}); });
    elements.preview.addEventListener('click', () => { showPreview().catch(() => {}); });
    elements.pushNow.addEventListener('click', () => { pushNow().catch(() => {}); });

    return Object.freeze({ load, save, toggleEnabled, showPreview, pushNow, openBind, sendCode, verifyCode, channelAction, state });
  }

  return Object.freeze({
    createSettingsFormController,
    createModelsSettings,
    createPushSettings,
    pushDraftPatch,
    planTimeline,
    formatPushMoment,
    describeCountdown,
    parseCapacity,
    formatCapacity,
    apiKeyFailure,
    modelRowsFailure,
    providerDraft,
    rowPayload,
    draftRow,
    presetChips,
    describeInterval,
    COLLECT_INTERVAL_PRESETS,
    RETENTION_PRESETS,
    IRRELEVANT_RETENTION_PRESETS
  });
});
