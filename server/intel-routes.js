'use strict';
// v0.2.0 情报接口：热点、事件、一级市场（公司库 / 融资 / 机构）、周报月报、行业包信息。
// 与 index.js 同一套鉴权（调用前已通过 authorize），这里只做路由与入参收口。
// 全部只读库或做纯代码计算——读者打开页面不会触发任何模型调用（AIHOT 的“页面不调模型”）。
const { HttpError } = require('./http-security');
const hot = require('./ai/hot');
const companies = require('./ai/companies');
const deals = require('./ai/deals');
const reports = require('./ai/reports');
const industry = require('./industry');
const { usageSnapshot } = require('./ai/receipts');

const DOMAINS = new Set(['lowaltitude', 'aerospace']);
const COMPANY_ID = /^(?:u-[0-9a-f]{10}|[a-z0-9-]{2,48})$/;

function domainParam(value) {
  if (!value) return null;
  if (!DOMAINS.has(value)) throw new HttpError(400, '不支持的领域');
  return value;
}

function intParam(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${label}必须是正整数`);
  const number = Number(value);
  if (number < min || number > max) throw new HttpError(400, `${label}须在 ${min}–${max} 之间`);
  return number;
}

function companyIdParam(value) {
  if (typeof value !== 'string' || !COMPANY_ID.test(value)) throw new HttpError(400, '公司编号无效');
  return value;
}

function stringArray(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 24 || value.some(v => typeof v !== 'string' || v.length > 40)) {
    throw new HttpError(400, `${label}须为不超过 24 个、每个不超过 40 字的文本列表`);
  }
  return value;
}

// 业务层抛出的 {status} 错误统一转成 HttpError，其余照常冒泡为 500
async function guard(action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (Number.isInteger(error?.status)) throw new HttpError(error.status, error.message);
    throw error;
  }
}

function industryInfo() {
  const site = industry.loadSite();
  const taxonomy = industry.loadTaxonomy();
  const selection = industry.loadSelection();
  const prompts = industry.listPrompts().map(name => {
    try { return { name, version: industry.renderPrompt(name, { periodLabel: '日报' }).version }; }
    catch { return { name, version: null }; }
  });
  return {
    siteName: site.siteName,
    industry: site.industry,
    readers: site.readers,
    axes: taxonomy.axes,
    itemTypes: taxonomy.itemTypes.map(({ id, label, category, weights }) => ({ id, label, category, weights })),
    topicTags: taxonomy.topicTags,
    thresholds: selection.thresholds,
    hot: selection.hot,
    budget: usageSnapshot(),
    prompts
  };
}

// 返回 true 表示已处理
async function handleIntelRoute({ req, res, url, json, readJsonBody, queryFeed }) {
  const p = url.pathname;
  const q = url.searchParams;
  const method = req.method;

  if (p === '/api/hot' && method === 'GET') {
    json(res, 200, hot.latestHot({ domain: domainParam(q.get('domain')) }));
    return true;
  }
  const mStory = p.match(/^\/api\/stories\/(\d+)$/);
  if (mStory && method === 'GET') {
    const detail = hot.storyDetail(Number(mStory[1]));
    if (!detail) throw new HttpError(404, '事件不存在');
    json(res, 200, detail);
    return true;
  }

  if (p === '/api/companies' && method === 'GET') {
    const watch = q.get('watch') || '';
    if (watch && !['watched', 'portfolio'].includes(watch)) throw new HttpError(400, '不支持的关注筛选');
    const text = (q.get('q') || '').trim();
    if (text.length > 40) throw new HttpError(400, '检索词不得超过 40 个字符');
    json(res, 200, companies.listCompanies({ domain: domainParam(q.get('domain')), watch: watch || null, q: text }));
    return true;
  }
  if (p === '/api/companies/heat' && method === 'GET') {
    json(res, 200, companies.companyHeat({
      domain: domainParam(q.get('domain')),
      watchedOnly: q.get('watched') === '1',
      limit: intParam(q.get('limit'), 30, 1, 200, '条数')
    }));
    return true;
  }
  if (p === '/api/companies' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求体必须是对象');
    stringArray(body.aliases, '别名');
    stringArray(body.products, '型号');
    if (body.domain != null && body.domain !== '' && !DOMAINS.has(body.domain)) throw new HttpError(400, '不支持的领域');
    json(res, 200, await guard(() => companies.addCompany(body)));
    return true;
  }
  const mCompany = p.match(/^\/api\/companies\/([^/]+)$/);
  if (mCompany && method === 'GET') {
    const id = companyIdParam(decodeURIComponent(mCompany[1]));
    const company = companies.getCompany(id);
    if (!company) throw new HttpError(404, '公司不存在');
    const feedQuery = new URLSearchParams({ view: 'all', company: id, page: String(intParam(q.get('page'), 0, 0, 1000, '页码')) });
    json(res, 200, { company, feed: queryFeed(feedQuery), deals: deals.listDeals({ companyId: id, days: 3650, limit: 50 }) });
    return true;
  }
  const mWatch = p.match(/^\/api\/companies\/([^/]+)\/watch$/);
  if (mWatch && method === 'POST') {
    const id = companyIdParam(decodeURIComponent(mWatch[1]));
    const body = await readJsonBody(req);
    if (body?.note !== undefined && (typeof body.note !== 'string' || body.note.length > 200)) throw new HttpError(400, '备注不得超过 200 个字符');
    json(res, 200, await guard(() => companies.setWatch(id, body?.watch, body?.note)));
    return true;
  }
  if (mCompany && method === 'PATCH') {
    const id = companyIdParam(decodeURIComponent(mCompany[1]));
    const body = await readJsonBody(req);
    stringArray(body?.aliases, '别名');
    stringArray(body?.products, '型号');
    if (body?.enabled !== undefined && typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled 必须是布尔值');
    json(res, 200, await guard(() => companies.updateCompany(id, body || {})));
    return true;
  }
  if (mCompany && method === 'DELETE') {
    const id = companyIdParam(decodeURIComponent(mCompany[1]));
    json(res, 200, await guard(() => companies.removeCompany(id)));
    return true;
  }

  if (p === '/api/deals' && method === 'GET') {
    const days = intParam(q.get('days'), 90, 1, 3650, '天数');
    const domain = domainParam(q.get('domain'));
    json(res, 200, {
      days,
      deals: deals.listDeals({ days, domain, watchedOnly: q.get('watched') === '1', limit: intParam(q.get('limit'), 120, 1, 500, '条数') }),
      investors: deals.investorBoard({ days, domain }),
      discovered: deals.discoveredCompanies({ days: Math.max(days, 90) })
    });
    return true;
  }

  if (p === '/api/reports' && method === 'GET') {
    const kind = q.get('kind');
    if (!['weekly', 'monthly'].includes(kind)) throw new HttpError(400, '刊期类型须为 weekly 或 monthly');
    const key = q.get('key') || reports.periodKeyOf(kind);
    if (key.length > 10) throw new HttpError(400, '期号无效');
    const report = await guard(() => reports.generatePeriod(kind, key));
    json(res, 200, { report, keys: reports.listPeriods(kind) });
    return true;
  }

  if (p === '/api/industry' && method === 'GET') {
    json(res, 200, industryInfo());
    return true;
  }
  return false;
}

module.exports = { handleIntelRoute, industryInfo };
