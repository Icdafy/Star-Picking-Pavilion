'use strict';
// 公开 API 适配器 —— 当前支持：东方财富关键词搜索（url 形如 "eastmoney://关键词"）
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

async function fetch(source, settings) {
  if (!source.url.startsWith(EASTMONEY_SCHEME)) {
    throw new Error('未知 API 信源格式: ' + source.url);
  }
  return fetchEastmoney(parseEastmoneySpec(source.url), settings);
}

module.exports = { fetch, parseEastmoneySpec, buildGuard };
