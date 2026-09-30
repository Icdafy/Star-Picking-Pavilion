'use strict';
// 设置页「模型」一节的 HTTP 面 —— 行为照搬 DeepSeek Harness 的 Models 页：
// 提供商行（密钥状态点、编辑、删除）、从内置目录添加、声明自定义模型 API、
// 用表单当前显示的端点与密钥询问可用模型、选定分析模型。
// 所有写入走设置协调器的同一条队列；密钥只经凭据通道落盘，响应里永远只有「是否已配置」。
const { HttpError, validateAiBaseUrl } = require('./http-security');
const catalog = require('./ai/model-catalog');

const MAX_ROWS = 200;
const MAX_CAPACITY = 100_000_000;

function badRequest(message) {
  return new HttpError(400, message);
}

function plainObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message);
  return value;
}

function textField(value, { field, maximum, required = false }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field}不能为空`);
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /\p{Cc}/u.test(value)) {
    throw badRequest(`${field}必须是 1 到 ${maximum} 个字符的文本`);
  }
  return value.trim();
}

function endpoint(value, { required = false } = {}) {
  const text = textField(value, { field: 'API 地址', maximum: 2048, required });
  if (text === undefined) return undefined;
  const normalized = text.replace(/\/+$/, '');
  if (!validateAiBaseUrl(normalized)) throw badRequest('API 地址必须使用 HTTPS（本机回环地址除外），且不能内嵌账号密码');
  return normalized;
}

function protocol(value) {
  if (!catalog.PROTOCOLS.includes(value)) throw badRequest('API 协议无效');
  return value;
}

function apiKeyField(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest('API 密钥必须是文本');
  const key = value.trim();
  if (!key) return undefined;
  if (key.length > 4096 || /[\s\p{Cc}]/u.test(key) || !/^[\x21-\x7e]+$/.test(key) || key.includes('****')) {
    throw badRequest('该 API 密钥格式错误，请检查');
  }
  return key;
}

// 严格校验模型行：与 sanitizeModels 的「静默丢弃」不同，编辑器提交的每一行都要么被接受，
// 要么点名是第几行出了什么问题，免得用户以为存进去了。
function modelRows(value) {
  if (!Array.isArray(value)) throw badRequest('模型目录必须是数组');
  if (value.length > MAX_ROWS) throw badRequest(`模型目录最多 ${MAX_ROWS} 行`);
  const seen = new Set();
  return value.map((raw, index) => {
    const row = plainObject(raw, `模型 ${index + 1}：格式无效`);
    const at = `模型 ${index + 1}：`;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) throw badRequest(`${at}模型 ID 不能为空`);
    if (id.length > 200 || /\p{Cc}/u.test(id)) throw badRequest(`${at}模型 ID 过长或含控制字符`);
    if (seen.has(id)) throw badRequest(`${at}模型 ID 不能重复`);
    seen.add(id);
    const model = { id };
    if (row.name !== undefined && row.name !== null && row.name !== '') {
      model.name = textField(row.name, { field: `${at}显示名称`, maximum: 200 });
    }
    for (const [key, label] of [['contextWindow', '上下文窗口'], ['maxTokens', '最大输出 token 数']]) {
      if (row[key] === undefined || row[key] === null || row[key] === '') continue;
      const number = Number(row[key]);
      if (!Number.isInteger(number) || number <= 0 || number > MAX_CAPACITY) {
        throw badRequest(`${at}${label}必须是正整数`);
      }
      model[key] = number;
    }
    if (row.input !== undefined) {
      if (!Array.isArray(row.input) || row.input.some(type => !['text', 'image'].includes(type))) {
        throw badRequest(`${at}输入类型只能是文本或图片`);
      }
      model.input = ['text', ...(row.input.includes('image') ? ['image'] : [])];
    }
    return model;
  });
}

function orderedProviderIds(providers) {
  const ids = Object.keys(providers);
  const catalogOrder = catalog.CATALOG.map(entry => entry.provider);
  return [
    ...catalogOrder.filter(id => ids.includes(id)),
    ...ids.filter(id => !catalogOrder.includes(id)).sort((a, b) => a.localeCompare(b))
  ];
}

function modelsView(settings, credentials) {
  const providers = settings.ai.providers;
  const configuredKeys = new Set(credentials.configuredProviders());
  return {
    activeProvider: settings.ai.activeProvider,
    activeModel: settings.ai.model,
    protocols: catalog.PROTOCOLS.map(value => ({ value, label: catalog.PROTOCOL_LABELS[value] })),
    catalog: catalog.catalogEntries().map(entry => ({ ...entry, added: Boolean(providers[entry.provider]) })),
    providers: orderedProviderIds(providers).map(id => {
      const described = catalog.describeProvider(id, providers[id]);
      return {
        ...described,
        keyConfigured: configuredKeys.has(id),
        active: id === settings.ai.activeProvider
      };
    })
  };
}

function createModelRoutes({ loadSettings, coordinator, credentials, discoverModels, testConnection }) {
  if (!loadSettings || !coordinator || !credentials || !discoverModels || !testConnection) {
    throw new TypeError('model routes dependencies are required');
  }

  const view = () => modelsView(loadSettings(), credentials);

  // 已存密钥只会发往它被保存时对应的端点：表单改了地址却没重新输入密钥时，不带密钥询问
  function probeTarget(settings, body) {
    const id = textField(body.provider, { field: '提供商', maximum: 40, required: true });
    const stored = settings.ai.providers[id];
    const known = stored || catalog.isCatalogProvider(id);
    const described = catalog.describeProvider(id, stored || {});
    const baseUrl = endpoint(body.baseUrl) || (known ? described.baseUrl : undefined);
    if (!baseUrl) throw badRequest('请先填写 API 地址，再获取');
    const api = body.api !== undefined && body.api !== '' ? protocol(body.api) : described.api;
    const typedKey = apiKeyField(body.apiKey);
    const storedKey = stored && baseUrl === described.baseUrl ? credentials.getProviderKey(id) : '';
    return {
      id, baseUrl, api, described,
      apiKey: typedKey || storedKey || (described.keyOptional ? catalog.KEYLESS_PLACEHOLDER : '')
    };
  }

  async function saveProvider(id, body) {
    return coordinator.transact(settings => {
      const exists = Boolean(settings.ai.providers[id]);
      if (!exists && !catalog.isCatalogProvider(id)) throw new HttpError(404, '提供商不存在');
      const described = catalog.describeProvider(id, settings.ai.providers[id] || {});
      const profile = { ...(settings.ai.providers[id] || {}) };
      const keyChanges = {};
      const typedKey = apiKeyField(body.apiKey);

      if (Object.hasOwn(body, 'baseUrl')) {
        const next = endpoint(body.baseUrl, { required: described.declared });
        const effectiveNext = next || described.defaultBaseUrl;
        if (next && next !== described.defaultBaseUrl) profile.baseUrl = next;
        else delete profile.baseUrl;
        // 端点换了而没有重新输入密钥：旧密钥不跟过去
        if (exists && effectiveNext !== described.baseUrl && !typedKey && credentialsHas(id)) keyChanges[id] = '';
      }
      if (Object.hasOwn(body, 'models')) {
        if (body.models === null) {
          if (described.declared) throw badRequest('自定义模型 API 至少需要一个模型');
          delete profile.models;
        } else {
          const rows = modelRows(body.models);
          if (described.declared && !rows.length) throw badRequest('自定义模型 API 至少需要一个模型');
          profile.models = rows;
        }
      }
      if (described.declared) {
        if (Object.hasOwn(body, 'displayName')) {
          const name = textField(body.displayName, { field: '显示名称', maximum: 60 });
          if (name) profile.displayName = name;
          else delete profile.displayName;
        }
        if (Object.hasOwn(body, 'api')) profile.api = protocol(body.api);
      }
      if (typedKey) keyChanges[id] = typedKey;
      else if (body.clearKey === true && credentialsHas(id)) keyChanges[id] = '';

      const next = structuredClone(settings);
      next.ai.providers = { ...settings.ai.providers, [id]: profile };
      return { settings: next, credentials: keyChanges, result: { ok: true, provider: id } };
    });
  }

  function credentialsHas(id) {
    return Boolean(credentials.getProviderKey(id));
  }

  async function createProvider(body) {
    return coordinator.transact(settings => {
      const id = textField(body.provider, { field: 'Provider ID', maximum: 40, required: true });
      if (!catalog.PROVIDER_ID.test(id)) throw badRequest('Provider ID 需以小写字母开头，之后可用小写字母、数字和短横线');
      if (settings.ai.providers[id] || catalog.isCatalogProvider(id)) throw badRequest('已有提供商使用了这个 ID');
      const baseUrl = endpoint(body.baseUrl, { required: true });
      const api = protocol(body.api);
      const models = modelRows(body.models ?? []);
      if (!models.length) throw badRequest('自定义模型 API 至少需要一个模型');
      const profile = { declared: true, baseUrl, api, models };
      const displayName = textField(body.displayName, { field: '显示名称', maximum: 60 });
      if (displayName) profile.displayName = displayName;
      const typedKey = apiKeyField(body.apiKey);
      const next = structuredClone(settings);
      next.ai.providers = { ...settings.ai.providers, [id]: profile };
      return {
        settings: next,
        credentials: typedKey ? { [id]: typedKey } : {},
        result: { ok: true, provider: id }
      };
    });
  }

  async function removeProvider(id) {
    return coordinator.transact(settings => {
      if (id === catalog.DEFAULT_PROVIDER) throw badRequest('DeepSeek 是默认提供商，不能删除');
      if (!settings.ai.providers[id]) throw new HttpError(404, '提供商不存在');
      const next = structuredClone(settings);
      const { [id]: _removed, ...rest } = settings.ai.providers;
      next.ai.providers = rest;
      return {
        settings: next,
        credentials: credentialsHas(id) ? { [id]: '' } : {},
        result: { ok: true, removed: id }
      };
    });
  }

  async function selectActive(body) {
    return coordinator.transact(settings => {
      const id = textField(body.provider, { field: '提供商', maximum: 40, required: true });
      if (!settings.ai.providers[id]) throw badRequest('请先添加该提供商');
      const model = textField(body.model, { field: '模型', maximum: 200, required: true });
      const described = catalog.describeProvider(id, settings.ai.providers[id]);
      if (!described.models.some(entry => entry.id === model)) {
        throw badRequest(`${model} 不在「${described.displayName}」的模型目录中`);
      }
      const next = structuredClone(settings);
      next.ai.activeProvider = id;
      next.ai.model = model;
      return { settings: next, result: { ok: true, provider: id, model } };
    });
  }

  async function discover(body) {
    const target = probeTarget(loadSettings(), body);
    try {
      const models = await discoverModels({ baseUrl: target.baseUrl, api: target.api, apiKey: target.apiKey });
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function test(body) {
    const settings = loadSettings();
    const target = probeTarget(settings, body);
    const model = textField(body.model, { field: '模型', maximum: 200 })
      || (target.id === settings.ai.activeProvider ? settings.ai.model : target.described.models[0]?.id);
    if (!model) return { ok: false, error: '该提供商还没有模型，请先添加或获取模型' };
    if (!target.apiKey) return { ok: false, error: '请先填写 API 密钥' };
    const probeSettings = structuredClone(settings);
    Object.assign(probeSettings.ai, {
      activeProvider: target.id,
      providerName: target.described.displayName,
      baseUrl: target.baseUrl,
      api: target.api,
      apiKey: target.apiKey,
      model
    });
    const started = Date.now();
    try {
      await testConnection(probeSettings);
      return { ok: true, model, latencyMs: Date.now() - started };
    } catch (error) {
      const message = String(error?.message || error);
      return { ok: false, model, error: message === 'NO_API_KEY' ? '请先填写 API 密钥' : message };
    }
  }

  async function handle({ req, res, pathname, json, readJsonBody }) {
    if (!pathname.startsWith('/api/models')) return false;
    if (pathname === '/api/models' && req.method === 'GET') {
      json(res, 200, view());
      return true;
    }
    if (pathname === '/api/models/providers' && req.method === 'POST') {
      await createProvider(plainObject(await readJsonBody(req), '请求体必须是对象'));
      json(res, 200, view());
      return true;
    }
    const match = pathname.match(/^\/api\/models\/providers\/([a-z][a-z0-9-]{0,39})$/);
    if (match && req.method === 'POST') {
      await saveProvider(match[1], plainObject(await readJsonBody(req), '请求体必须是对象'));
      json(res, 200, view());
      return true;
    }
    if (match && req.method === 'DELETE') {
      await removeProvider(match[1]);
      json(res, 200, view());
      return true;
    }
    if (pathname === '/api/models/active' && req.method === 'POST') {
      await selectActive(plainObject(await readJsonBody(req), '请求体必须是对象'));
      json(res, 200, view());
      return true;
    }
    if (pathname === '/api/models/discover' && req.method === 'POST') {
      json(res, 200, await discover(plainObject(await readJsonBody(req), '请求体必须是对象')));
      return true;
    }
    if (pathname === '/api/models/test' && req.method === 'POST') {
      json(res, 200, await test(plainObject(await readJsonBody(req), '请求体必须是对象')));
      return true;
    }
    return false;
  }

  return Object.freeze({ handle, view });
}

module.exports = { createModelRoutes, modelRows, modelsView };
