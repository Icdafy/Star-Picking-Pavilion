'use strict';
// 公开 API 适配器 —— scheme 分派：eastmoney://关键词 | cninfo://检索词?column= | sse://关键词 | szse:// | cls://关键词
//
// v0.0.7 修了一个一直在灌噪声的老问题：东财搜索是「分词 OR 匹配」，
// 用 sort=time 取回的是**按时间排序的全网新闻**，长实体名（蓝箭航天、峰飞航空）
// 会被拆成「航」「空」这类弱片段，于是每轮都把中东局势、财经晚报原样抓进库。
// 实测同一批关键词：sort=time 相关率 0–25%，sort=default（相关性排序）40–100%。
//
// 因此这里做三件事：
//   ① 相关性优先：主取 sort=default，再补一路 sort=time 保住「刚刚发生」的时效性
//   ② 深度采集：可翻多页（pages），把覆盖面真正做宽
//   ③ 入库守卫：标题与摘要都不沾关键词、也不沾同领域词库的条目直接丢弃，
//      噪声在进库前就被拦下，既省 AI 预筛的 token，也不占保留期
const { fetchText } = require('./fetch-util');
const lexicon = require('../ai/lexicon');

const EASTMONEY_SCHEME = 'eastmoney://';
const PAGE_SIZE = 30;
const MAX_PAGES = 3;

// eastmoney://关键词?pages=2&mode=both —— 参数可选，缺省即为默认行为
function parseEastmoneySpec(url) {
  const raw = url.slice(EASTMONEY_SCHEME.length);
  const separator = raw.indexOf('?');
  const keywordPart = separator === -1 ? raw : raw.slice(0, separator);
  const query = new URLSearchParams(separator === -1 ? '' : raw.slice(separator + 1));
  const keyword = decodeURIComponent(keywordPart).trim();
  if (!keyword) throw new Error('eastmoney 信源缺少关键词');
  const requestedPages = Number(query.get('pages'));
  const mode = query.get('mode');
  return {
    keyword,
    pages: Number.isInteger(requestedPages) ? Math.max(1, Math.min(MAX_PAGES, requestedPages)) : 1,
    // relevance=只要相关性排序 | recent=只要时间排序 | both=两路合并（默认）
    mode: ['relevance', 'recent', 'both'].includes(mode) ? mode : 'both',
    // 守卫默认开启；个别宽口径关键词可以显式关掉
    guard: query.get('guard') !== 'off'
  };
}

async function fetchPage(keyword, { sort, pageIndex }, settings) {
  const param = {
    uid: '', keyword, type: ['cmsArticleWebOld'],
    client: 'web', clientType: 'web', clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default', sort, pageIndex, pageSize: PAGE_SIZE, preTag: '', postTag: ''
      }
    }
  };
  const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=' +
    encodeURIComponent(JSON.stringify(param));
  const raw = await fetchText(url, settings);
  const body = raw.replace(/^[^(]*\(/, '').replace(/\)\s*$/, '');
  const parsed = JSON.parse(body);
  const articles = parsed?.result?.cmsArticleWebOld || [];
  return articles.map(a => ({
    title: String(a.title || '').replace(/<[^>]+>/g, '').trim(),
    url: a.url,
    summary: String(a.content || '').replace(/<[^>]+>/g, '').trim(),
    publishedAt: a.date ? new Date(a.date.replace(' ', 'T') + '+08:00').toISOString() : null,
    image: (a.image && /^https?:\/\//.test(a.image)) ? a.image : null
  })).filter(a => a.title && a.url);
}

// 守卫：条目必须自己长得像这条检索线要的东西。
// 命中关键词本身（去掉空格后比较，「马斯克 火箭」这类组合词才对得上），
// 或命中词库里同一领域的词条 —— 后者放行的是「用别名说同一件事」的报道。
function buildGuard(keyword) {
  const probes = [keyword, keyword.replace(/\s+/g, '')]
    .concat(keyword.split(/\s+/))
    .map(p => p.trim())
    .filter(p => p.length >= 2);
  const unique = [...new Set(probes)];
  return item => {
    const text = `${item.title} ${item.summary || ''}`;
    if (unique.some(probe => text.includes(probe))) return true;
    // 关键词没直接出现，就要求整条确实落在本领域内（词库判定）
    return lexicon.isRelevantSummary(lexicon.analyze(text));
  };
}

async function fetchEastmoney(spec, settings) {
  const { keyword, pages, mode, guard } = spec;
  const plans = [];
  if (mode === 'relevance' || mode === 'both') {
    for (let page = 1; page <= pages; page++) plans.push({ sort: 'default', pageIndex: page });
  }
  if (mode === 'recent' || mode === 'both') {
    // 时间线只取第一页：它的作用是补最新动态，翻页越深噪声越多
    plans.push({ sort: 'time', pageIndex: 1 });
  }

  const merged = new Map();
  let failures = 0;
  for (const plan of plans) {
    try {
      for (const item of await fetchPage(keyword, plan, settings)) {
        if (!merged.has(item.url)) merged.set(item.url, item);
      }
    } catch (error) {
      failures++;
      // 单页失败不该让整个信源判失败：还有其他排序/页码可能成功
      if (failures === plans.length) throw error;
    }
  }

  const items = [...merged.values()];
  return guard ? items.filter(buildGuard(keyword)) : items;
}

// ---------------------------------------------------------------------------
// 交易所/资讯类子适配器（v7 新增）——每个都遵循同一条纪律：
// 复用 fetchText 与 buildGuard 式入库守卫，严格 schema 校验，解析失败即 throw
// （走退避、不入库脏数据）。端点均在 2026-08 实测，结果写进种子库 note。

const API_SCHEMES = ['eastmoney://', 'cninfo://', 'sse://', 'szse://', 'cls://'];

// 中文站点常见的两种日期写法；解不出就返回 null，交给入库时间兜底
function parseCnDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00+08:00') : new Date(s);
  return isNaN(t) ? null : t.toISOString();
}

// cninfo://检索词?column=szse|sse&stock=&category= —— 检索词可空（空=全量最新公告流）
const CNINFO_COLUMNS = ['szse', 'sse', 'cyb', 'kcb', 'third', 'hke'];
function parseCninfoSpec(url) {
  const raw = url.slice('cninfo://'.length);
  const separator = raw.indexOf('?');
  const keyword = decodeURIComponent(separator === -1 ? raw : raw.slice(0, separator)).trim();
  const query = new URLSearchParams(separator === -1 ? '' : raw.slice(separator + 1));
  const column = query.get('column') || 'szse';
  if (!CNINFO_COLUMNS.includes(column)) throw new Error('cninfo 信源 column 参数无效');
  return { keyword, column, stock: query.get('stock') || '', category: query.get('category') || '' };
}

// sse:// / szse:// / cls:// 后跟可选检索词
function parseKeywordSpec(url, scheme) {
  const raw = url.slice(scheme.length);
  const separator = raw.indexOf('?');
  return { keyword: decodeURIComponent(separator === -1 ? raw : raw.slice(0, separator)).trim() };
}

// 巨潮资讯网公告查询（POST 表单）—— 2026-08 实测可用，返回 announcements[]
function mapCninfoResponse(raw, spec) {
  const parsed = JSON.parse(raw);
  const list = parsed && parsed.announcements;
  if (!Array.isArray(list)) throw new Error('cninfo 返回结构异常：缺少 announcements 数组');
  const items = list.map(a => ({
    // isHLtitle=true 时命中词会被 <em> 包裹，入库前剥掉
    title: String(a.announcementTitle || '').replace(/<[^>]+>/g, '').trim(),
    url: a.adjunctUrl ? 'http://static.cninfo.com.cn/' + a.adjunctUrl : null,
    summary: a.secName || a.secCode ? `${a.secName || ''}（${a.secCode || ''}）` : '',
    publishedAt: Number.isFinite(a.announcementTime) ? new Date(a.announcementTime).toISOString() : null,
    image: null
  })).filter(a => a.title && a.url);
  return spec.keyword ? items.filter(buildGuard(spec.keyword)) : items;
}

async function fetchCninfo(spec, settings) {
  const form = new URLSearchParams({
    pageNum: '1', pageSize: '30', column: spec.column, tabName: 'fulltext',
    plate: '', stock: spec.stock, searchkey: spec.keyword, secid: '',
    category: spec.category, trade: '', seDate: '', sortName: '', sortType: '', isHLtitle: 'true'
  });
  const raw = await fetchText('http://www.cninfo.com.cn/new/hisAnnouncement/query', settings, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: form.toString()
  });
  return mapCninfoResponse(raw, spec);
}

// 上交所公告查询（JSONP，必须携站内 Referer）—— 2026-08 实测可达但持续返回空列表，
// 字段映射按该接口历史文档写，启用前需重新核对真实返回
function mapSseResponse(raw, spec) {
  const body = raw.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, '');
  const parsed = JSON.parse(body);
  const list = parsed && parsed.result;
  if (!Array.isArray(list)) throw new Error('sse 返回结构异常：缺少 result 数组');
  const items = list.map(b => ({
    title: String(b.TITLE || b.DOC_TITLE || '').trim(),
    url: b.URL || b.DOC_URL || null,
    summary: String(b.SECURITY_CODE || '').trim(),
    publishedAt: parseCnDate(b.SSEDATE || b.POST_DATE || b.CREATE_DATE),
    image: null
  })).filter(b => b.title && b.url);
  return spec.keyword ? items.filter(buildGuard(spec.keyword)) : items;
}

async function fetchSse(spec, settings) {
  const params = new URLSearchParams({
    jsonCallBack: 'cb', isPagination: 'true', productId: '', keyWord: spec.keyword,
    securityType: '0101,120100,0201,0202,0203,0204,0205,0206,0207,0208',
    reportType: 'ALL', beginDate: '', endDate: '',
    'pageHelp.pageSize': '30', 'pageHelp.pageCount': '50', 'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1', 'pageHelp.cacheSize': '1', 'pageHelp.endPage': '5'
  });
  const raw = await fetchText(
    'http://query.sse.com.cn/security/stock/queryCompanyBulletinNew.do?' + params.toString(),
    settings,
    { headers: { Referer: 'http://www.sse.com.cn/' } }
  );
  return mapSseResponse(raw, spec);
}

// 深交所公告列表（POST JSON）—— 2026-08 实测 404/500，字段映射按接口历史文档写，
// 端点恢复前种子保持停用
function mapSzseResponse(raw) {
  const parsed = JSON.parse(raw);
  if (parsed && parsed.error) {
    throw new Error('szse 接口返回错误：' + JSON.stringify(parsed.error).slice(0, 120));
  }
  const list = parsed && parsed.data && parsed.data.announce;
  if (!Array.isArray(list)) throw new Error('szse 返回结构异常：缺少 data.announce 数组');
  return list.map(a => ({
    title: String(a.title || '').trim(),
    url: a.attachPath ? 'https://disc.static.szse.cn' + a.attachPath : null,
    summary: Array.isArray(a.secName) ? a.secName.join('，') : String(a.secName || '').trim(),
    publishedAt: parseCnDate(a.publishTime),
    image: null
  })).filter(a => a.title && a.url);
}

async function fetchSzse(spec, settings) {
  const raw = await fetchText('https://www.szse.cn/api/disc/announcement/getList', settings, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ random: Math.random(), pageNum: 1, pageSize: 30 })
  });
  return mapSzseResponse(raw);
}

// 财联社电报流 —— 2026-08 实测 telegraphList 返回 404（需签名），种子保持停用；
// 电报是泛财经流，无论是否带检索词都必须过守卫再入库
function mapClsResponse(raw, spec) {
  const parsed = JSON.parse(raw);
  if (parsed && Number(parsed.errno)) {
    throw new Error(`cls 接口返回错误 errno=${parsed.errno}（${parsed.msg || '未知'}）`);
  }
  const list = (parsed && parsed.data && parsed.data.roll_data) || (parsed && parsed.data);
  if (!Array.isArray(list)) throw new Error('cls 返回结构异常：缺少电报数组');
  const items = list.map(t => {
    const content = String(t.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      title: String(t.title || '').trim() || content.slice(0, 60),
      url: t.id ? `https://www.cls.cn/detail/${t.id}` : null,
      summary: content,
      publishedAt: Number.isFinite(t.ctime) ? new Date(t.ctime * 1000).toISOString() : null,
      image: null
    };
  }).filter(t => t.title && t.url);
  const guard = spec.keyword
    ? buildGuard(spec.keyword)
    : item => lexicon.isRelevantSummary(lexicon.analyze(`${item.title} ${item.summary || ''}`));
  return items.filter(guard);
}

async function fetchCls(spec, settings) {
  const params = new URLSearchParams({
    app: 'CailianpressWeb', os: 'web', sv: '8.4.6', rn: '20',
    lastTime: '', refresh_type: '1', category: ''
  });
  const raw = await fetchText('https://www.cls.cn/nodeapi/telegraphList?' + params.toString(), settings, {
    headers: { Referer: 'https://www.cls.cn/telegraph' }
  });
  return mapClsResponse(raw, spec);
}

// scheme 分派表：新增官方 JSON API 只需在这里加一行与一个子适配器
const SCHEME_FETCHERS = {
  'eastmoney://': (url, settings) => fetchEastmoney(parseEastmoneySpec(url), settings),
  'cninfo://': (url, settings) => fetchCninfo(parseCninfoSpec(url), settings),
  'sse://': (url, settings) => fetchSse(parseKeywordSpec(url, 'sse://'), settings),
  'szse://': (url, settings) => fetchSzse(parseKeywordSpec(url, 'szse://'), settings),
  'cls://': (url, settings) => fetchCls(parseKeywordSpec(url, 'cls://'), settings)
};

async function fetch(source, settings) {
  const scheme = API_SCHEMES.find(s => source.url.startsWith(s));
  if (!scheme) throw new Error('未知 API 信源格式: ' + source.url);
  return SCHEME_FETCHERS[scheme](source.url, settings);
}

// 供校验层复用：任意 scheme 的地址都能在这里解析并报错，保证校验与采集同源
function parseApiSpec(url) {
  if (url.startsWith('eastmoney://')) return parseEastmoneySpec(url);
  if (url.startsWith('cninfo://')) return parseCninfoSpec(url);
  for (const scheme of ['sse://', 'szse://', 'cls://']) {
    if (url.startsWith(scheme)) return parseKeywordSpec(url, scheme);
  }
  throw new Error('未知 API 信源格式: ' + url);
}

module.exports = {
  fetch,
  parseEastmoneySpec,
  parseApiSpec,
  buildGuard,
  API_SCHEMES,
  mapCninfoResponse,
  mapSseResponse,
  mapSzseResponse,
  mapClsResponse
};
