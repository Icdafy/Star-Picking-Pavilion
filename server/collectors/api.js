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
const { setTimeout: delay } = require('node:timers/promises');
const lexicon = require('../ai/lexicon');
const { stripMarkup, decodeEntities } = require('../ai/normalize');

const EASTMONEY_SCHEME = 'eastmoney://';
const PAGE_SIZE = 30;
const MAX_PAGES = 3;

// 公开接口返回的条目 URL 同样不受信任：入库前统一校验协议与凭据，
// javascript:/data: 或带内嵌凭据的地址出不了采集层
function validWebUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

// 附件/公告路径必须解析后仍落在站内静态域：相对路径（带不带前导 /）都放行，
// 绝对地址与协议相对地址（//evil.com）经同源校验挡下
function resolveStaticAssetUrl(base, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return null;
  const baseUrl = new URL(base);
  try {
    const url = new URL(pathValue, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.origin !== baseUrl.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

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
    // 守卫默认开启；个别宽口径关键词可以显式关掉。guard=capital 用于一级市场检索线：条目本身须落在本领域词库内，
    // 且标题带资本信号（融资、轮次、领投、辅导、IPO……）——“商业航天 完成融资”里的“完成融资”会命中全行业融资新闻，
    // 领域词又会命中与资本无关的行业新闻，两者都满足才入库
    guard: query.get('guard') === 'off' ? false : query.get('guard') === 'capital' ? 'capital' : true
  };
}

// 多条关键词共用一个公开搜索服务，限制同主机并发，避免 HTTP 200 空正文。
let eastmoneyRequestQueue = Promise.resolve();
let nextEastmoneyRequestAt = 0;
function fetchPage(keyword, plan, settings) {
  const pending = eastmoneyRequestQueue.then(async () => {
    const remaining = nextEastmoneyRequestAt - Date.now();
    if (remaining > 0) await delay(remaining);
    try { return await fetchEastmoneyPage(keyword, plan, settings); }
    finally { nextEastmoneyRequestAt = Date.now() + 350; }
  });
  eastmoneyRequestQueue = pending.catch(() => {});
  return pending;
}

async function fetchEastmoneyPage(keyword, { sort, pageIndex }, settings) {
  const param = {
    uid: '', keyword, type: ['cmsArticleWebOld'],
    client: 'web', clientType: 'web', clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default', sort, pageIndex, pageSize: PAGE_SIZE, preTag: '<em>', postTag: '</em>'
      }
    }
  };
  const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=' +
    encodeURIComponent(JSON.stringify(param));
  let raw = await fetchText(url, settings, { headers: { Referer: 'https://so.eastmoney.com/' } });
  // 部分限流仍返回 200 空正文；只对这一瞬态响应重试一次，异常 JSON 继续报错。
  if (!raw.trim()) {
    await delay(1000);
    raw = await fetchText(url, settings, { headers: { Referer: 'https://so.eastmoney.com/' } });
  }
  return mapEastmoneyResponse(raw);
}

function mapEastmoneyResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('东财检索返回空响应');
  const jsonp = text.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?$/);
  const parsed = JSON.parse(jsonp ? jsonp[1] : text);
  const articles = parsed?.result?.cmsArticleWebOld;
  if ((parsed?.code != null && Number(parsed.code) !== 0) || !Array.isArray(articles)) {
    throw new Error('东财检索返回结构异常：缺少有效 cmsArticleWebOld 数组');
  }
  return articles.map(a => ({
    title: decodeEntities(stripMarkup(a.title, '')).trim(),
    url: validWebUrl(a.url),
    summary: decodeEntities(stripMarkup(a.content, '')).trim(),
    textFormat: 'plain',
    publishedAt: looseDateIso(a.date),
    image: (a.image && /^https?:\/\//.test(a.image)) ? a.image : null,
    // 检索线只是入口，真正的出版方是 mediaName（财联社、证券时报……）：热度按它计独立参与者
    publisherId: typeof a.mediaName === 'string' && a.mediaName.trim() && !/\p{Cc}/u.test(a.mediaName)
      ? a.mediaName.trim().slice(0, 60) : null
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

const CAPITAL_SIGNAL = /融资|[种天A-F]\+*轮|天使|领投|跟投|注资|增资|募资|战略投资|上市辅导|辅导备案|IPO|科创板|创业板|北交所|招股|过会|估值|并购|收购|产业基金|母基金|基金设立/i;
const CAPITAL_NOISE = /融资租赁|融资融券|融资客|融资余额|融资买入|融资净|两融/;
const CAPITAL_DOMAIN = /商业航天|航天|宇航|火箭|卫星|星座|空天|太空|eVTOL|飞行汽车|无人机|低空|通航|通用航空|航空器|飞行器|垂直起降/i;
function capitalGuard(item) {
  const title = String(item.title || '');
  if (!CAPITAL_SIGNAL.test(title) || CAPITAL_NOISE.test(title)) return false;
  // 新公司常不在词库里：标题直接写明两行业赛道词也算相关（“执宇航天……可复用小火箭”）
  if (CAPITAL_DOMAIN.test(title)) return true;
  return lexicon.isRelevantSummary(lexicon.analyze(`${title} ${item.summary || ''}`));
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
  if (guard === 'capital') return items.filter(capitalGuard);
  return guard ? items.filter(buildGuard(keyword)) : items;
}

// ---------------------------------------------------------------------------
// 交易所/资讯类子适配器（v7 新增）——每个都遵循同一条纪律：
// 复用 fetchText 与 buildGuard 式入库守卫，严格 schema 校验，解析失败即 throw
// （走退避、不入库脏数据）。端点均在 2026-08 实测，结果写进种子库 note。

const API_SCHEMES = ['eastmoney://', 'cninfo://', 'sseipo://', 'szseipo://', 'sse://', 'szse://', 'cls://'];
const { looseDateIso } = require('./loose-date');

// 中文站点常见的两种日期写法；解不出就返回 null，交给入库时间兜底
function parseCnDate(value) {
  let s;
  try { s = String(value == null ? '' : value).trim(); } catch { return null; }
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return looseDateIso(`${s} 00:00:00`, '+08:00');
  // 带时间不带时区的写法按北京时间读，不随本机时区漂移
  return looseDateIso(s, '+08:00');
}

function epochIso(value, factor = 1) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value * factor);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
    title: decodeEntities(stripMarkup(a.announcementTitle, '')).trim(),
    url: resolveStaticAssetUrl('http://static.cninfo.com.cn/', a.adjunctUrl),
    summary: a.secName || a.secCode ? `${a.secName || ''}（${a.secCode || ''}）` : '',
    publishedAt: epochIso(a.announcementTime),
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
    url: validWebUrl(b.URL || b.DOC_URL),
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
    url: resolveStaticAssetUrl('https://disc.static.szse.cn/', a.attachPath),
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
    const content = decodeEntities(stripMarkup(t.content)).replace(/\s+/g, ' ').trim();
    return {
      title: String(t.title || '').trim() || content.slice(0, 60),
      url: t.id ? `https://www.cls.cn/detail/${t.id}` : null,
      summary: content,
      publishedAt: epochIso(t.ctime, 1000),
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

// ---------------------------------------------------------------------------
// v0.2.2 · 交易所 IPO 审核项目（一级市场的“上市进程”一手数据，公开免费）
//   sseipo://[名称关键词]?csrc=C37&days=540  上交所科创板项目动态（query.sse.com.cn，须携站内 Referer）
//   szseipo://[名称关键词]?industry=航空航天&pages=3&days=540  深交所创业板 / 主板项目动态（listing.szse.cn）
// 2026-09-30 实测：上交所 C37（铁路、船舶、航空航天和其他运输设备制造业）返回中科宇航、蓝箭航天、微纳星空等在审项目；
// 深交所按更新时间倒序，按证监会行业与名称过滤出腾盾科创、成立航空、晋铭航空等。
// 每个“项目 × 审核状态”生成一条资料：状态变化（受理 → 问询 → 上市委 → 注册）就是一条新的上市进程报道。
// 标题只写交易所公开字段，不推断结果；超过 days 天未更新的历史项目不入库。
const SSE_IPO_STATUS = Object.freeze({ 1: '已受理', 2: '已问询', 3: '上市委会议', 4: '提交注册', 6: '已发行', 7: '中止', 8: '终止' });
const SSE_REGISTER_RESULT = Object.freeze({ 1: '注册生效', 2: '不予注册', 3: '终止注册' });
const IPO_NOISE = /铁路|铁科|高铁|轨道|中车|通信信号|交控|国铁|百川|船舶|中船|海工|汽车/;

function parseIpoSpec(url, scheme) {
  const raw = url.slice(scheme.length);
  const separator = raw.indexOf('?');
  const keyword = decodeURIComponent(separator === -1 ? raw : raw.slice(0, separator)).trim();
  const query = new URLSearchParams(separator === -1 ? '' : raw.slice(separator + 1));
  const csrc = query.get('csrc') || '';
  if (csrc && !/^[A-S]\d{2}$/.test(csrc)) throw new Error('sseipo 信源 csrc 须为证监会行业代码，如 C37');
  const industry = (query.get('industry') || '').trim();
  if (industry.length > 20) throw new Error('szseipo 信源 industry 不得超过 20 个字');
  const days = Number(query.get('days') || 540);
  const pages = Number(query.get('pages') || 1);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('IPO 信源 days 须为 1–3650 的整数');
  if (!Number.isInteger(pages) || pages < 1 || pages > 5) throw new Error('IPO 信源 pages 须为 1–5 的整数');
  if (!keyword && !csrc && !industry) throw new Error('IPO 信源须指定名称关键词或行业');
  return { keyword, csrc, industry, days, pages };
}

function compactDate(value) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function recentEnough(iso, days, nowMs = Date.now()) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && nowMs - t <= days * 86400e3;
}

function mapSseIpoResponse(raw, spec, nowMs = Date.now()) {
  const parsed = JSON.parse(raw);
  const list = parsed && parsed.result;
  if (!Array.isArray(list)) throw new Error('sseipo 返回结构异常：缺少 result 数组');
  return list.map(p => {
    const name = String(p.stockAuditName || '').replace(/首次公开发行.*$/, '').trim();
    const code = Number(p.currStatus);
    const status = code === 5 ? (SSE_REGISTER_RESULT[Number(p.registeResult)] || '注册结果') : SSE_IPO_STATUS[code];
    const id = String(p.stockAuditNum || '').trim();
    const publishedAt = compactDate(p.updateDate);
    if (!name || !status || !/^\d{1,8}$/.test(id)) return null;
    const amount = Number(p.planIssueCapital);
    const sponsor = Array.isArray(p.intermediary) ? p.intermediary.find(i => Number(i.i_intermediaryType) === 1)?.i_intermediaryAbbrName : '';
    return {
      title: `${name}科创板IPO审核状态：${status}`,
      url: `https://kcb.sse.com.cn/renewal/xmxq/index.shtml?auditId=${id}&st=${code}${p.registeResult || ''}`,
      summary: [`上交所科创板发行上市审核项目动态：${name}，当前状态“${status}”`,
        Number.isFinite(amount) && amount > 0 ? `拟募资 ${amount} 亿元` : '', sponsor ? `保荐机构 ${sponsor}` : '',
        publishedAt ? `状态更新于 ${publishedAt.slice(0, 10)}` : ''].filter(Boolean).join('；') + '。',
      publishedAt,
      image: null,
      publisherId: '上交所'
    };
  }).filter(Boolean)
    .filter(item => !IPO_NOISE.test(item.title) && recentEnough(item.publishedAt, spec.days, nowMs));
}

async function fetchSseIpo(spec, settings) {
  const items = [];
  for (let page = 1; page <= spec.pages; page++) {
    const params = new URLSearchParams({ isPagination: 'true', sqlId: 'SH_XM_LB', 'pageHelp.pageSize': '40', 'pageHelp.pageNo': String(page) });
    if (spec.keyword) params.set('keyword', spec.keyword);
    if (spec.csrc) params.set('csrcCode', spec.csrc);
    const raw = await fetchText('https://query.sse.com.cn/statusAction.do?' + params.toString(), settings,
      { headers: { Referer: 'https://kcb.sse.com.cn/' } });
    const batch = mapSseIpoResponse(raw, spec);
    items.push(...batch);
    if (!batch.length) break;
  }
  return items;
}

function mapSzseIpoResponse(raw, spec, nowMs = Date.now()) {
  const parsed = JSON.parse(raw);
  const list = parsed && parsed.data;
  if (!Array.isArray(list)) throw new Error('szseipo 返回结构异常：缺少 data 数组');
  return list.map(p => {
    const name = String(p.cmpnm || '').trim();
    const status = String(p.prjst || '').trim();
    const id = String(p.prjid || '').trim();
    const board = String(p.boardName || '').trim() || '深交所';
    const industry = String(p.csrcind || '');
    if (!name || !status || !/^\d{1,10}$/.test(id)) return null;
    if (spec.industry && !industry.includes(spec.industry) && !(spec.keyword && name.includes(spec.keyword))) return null;
    const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(p.updtdt || '') ? parseCnDate(p.updtdt) : null;
    const amount = Number(p.maramt);
    return {
      title: `${name}${board}IPO审核状态：${status}`,
      url: `https://listing.szse.cn/projectdynamic/ipo/detail/index.html?id=${id}&st=${Number(p.prjstatus) || 0}`,
      summary: [`深交所${board}发行上市审核项目动态：${name}（${String(p.cmpsnm || '').trim() || name}），当前状态“${status}”`,
        Number.isFinite(amount) && amount > 0 ? `拟募资 ${amount} 亿元` : '', p.sprinsts ? `保荐机构 ${p.sprinsts}` : '',
        p.acptdt ? `受理于 ${p.acptdt}` : '', industry ? `行业 ${industry}` : ''].filter(Boolean).join('；') + '。',
      publishedAt,
      image: null,
      publisherId: '深交所'
    };
  }).filter(Boolean).filter(item => !IPO_NOISE.test(item.title) && recentEnough(item.publishedAt, spec.days, nowMs));
}

async function fetchSzseIpo(spec, settings) {
  const items = [];
  for (let page = 0; page < spec.pages; page++) {
    const params = new URLSearchParams({ bizType: '1', pageIndex: String(page), pageSize: '100' });
    if (spec.keyword && !spec.industry) params.set('keywords', spec.keyword);
    const raw = await fetchText('https://listing.szse.cn/api/ras/projectrends/query?' + params.toString(), settings,
      { headers: { Referer: 'https://listing.szse.cn/' } });
    items.push(...mapSzseIpoResponse(raw, spec));
  }
  return items;
}

// scheme 分派表：新增官方 JSON API 只需在这里加一行与一个子适配器
const SCHEME_FETCHERS = {
  'eastmoney://': (url, settings) => fetchEastmoney(parseEastmoneySpec(url), settings),
  'cninfo://': (url, settings) => fetchCninfo(parseCninfoSpec(url), settings),
  'sseipo://': (url, settings) => fetchSseIpo(parseIpoSpec(url, 'sseipo://'), settings),
  'szseipo://': (url, settings) => fetchSzseIpo(parseIpoSpec(url, 'szseipo://'), settings),
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
  if (url.startsWith('sseipo://')) return parseIpoSpec(url, 'sseipo://');
  if (url.startsWith('szseipo://')) return parseIpoSpec(url, 'szseipo://');
  for (const scheme of ['sse://', 'szse://', 'cls://']) {
    if (url.startsWith(scheme)) return parseKeywordSpec(url, scheme);
  }
  throw new Error('未知 API 信源格式: ' + url);
}

module.exports = {
  fetch,
  parseEastmoneySpec,
  mapEastmoneyResponse,
  parseApiSpec,
  buildGuard,
  capitalGuard,
  API_SCHEMES,
  mapCninfoResponse,
  mapSseIpoResponse,
  mapSzseIpoResponse,
  parseIpoSpec,
  mapSseResponse,
  mapSzseResponse,
  mapClsResponse
};
