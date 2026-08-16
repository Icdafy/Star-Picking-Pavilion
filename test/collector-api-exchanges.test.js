'use strict';

// cninfo / sse / szse / cls 四个子适配器的 fixture 驱动单测：
// 正常 JSON → 条目映射正确；结构异常 → throw（走退避，不入库脏数据）。
// 与 collector-eastmoney.test.js 同风格：不打真实网络，映射函数直接吃 fixture。
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetch,
  parseApiSpec,
  mapCninfoResponse,
  mapSseResponse,
  mapSzseResponse,
  mapClsResponse
} = require('../server/collectors/api');
const { sanitizeSourceInput } = require('../server/input-validation');

// ---------------------------------------------------------------------------
// cninfo://（巨潮资讯网，POST 表单 JSON）—— 2026-08 实测可用

const cninfoOk = JSON.stringify({
  totalAnnouncement: 2,
  announcements: [
    {
      secCode: '600118', secName: '中国卫星',
      announcementTitle: '中国<em>卫星</em>2025年年度权益分派实施公告',
      announcementTime: 1784160000000,
      adjunctUrl: 'finalpage/2026-07-17/1225428009.PDF'
    },
    {
      secCode: '000001', secName: '平安银行',
      announcementTitle: '平安银行关于某事项的公告',
      announcementTime: 1784246400000,
      adjunctUrl: 'finalpage/2026-07-18/1.PDF'
    }
  ]
});

test('cninfo 正常返回：条目映射正确，<em> 高亮被剥除', () => {
  const items = mapCninfoResponse(cninfoOk, { keyword: '' });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '中国卫星2025年年度权益分派实施公告');
  assert.equal(items[0].url, 'http://static.cninfo.com.cn/finalpage/2026-07-17/1225428009.PDF');
  assert.equal(items[0].summary, '中国卫星（600118）');
  assert.equal(items[0].publishedAt, new Date(1784160000000).toISOString());
});

test('cninfo 带检索词时过关键词守卫，无关公告被拦下', () => {
  const items = mapCninfoResponse(cninfoOk, { keyword: '卫星' });
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, '中国卫星（600118）');
});

test('cninfo 结构异常：缺 announcements 数组即 throw', () => {
  assert.throws(() => mapCninfoResponse('{}', { keyword: '' }), /announcements/);
  assert.throws(() => mapCninfoResponse(JSON.stringify({ announcements: 'nope' }), { keyword: '' }), /announcements/);
  assert.throws(() => mapCninfoResponse('not json', { keyword: '' }));
});

// ---------------------------------------------------------------------------
// sse://（上交所，JSONP + 站内 Referer）—— 2026-08 实测可达但空列表，映射按历史文档

const sseOk = 'cb(' + JSON.stringify({
  result: [{
    TITLE: '某科创板公司关于发射任务的提示性公告',
    URL: 'http://static.sse.com.cn/disclosure/x.pdf',
    SECURITY_CODE: '688001',
    SSEDATE: '2026-08-11'
  }],
  pageHelp: { total: 1 }
}) + ');';

test('sse 正常返回：JSONP 剥离 + 条目映射正确', () => {
  const items = mapSseResponse(sseOk, { keyword: '' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '某科创板公司关于发射任务的提示性公告');
  assert.equal(items[0].url, 'http://static.sse.com.cn/disclosure/x.pdf');
  assert.equal(items[0].publishedAt, '2026-08-10T16:00:00.000Z');
});

test('sse 结构异常：缺 result 数组即 throw', () => {
  assert.throws(() => mapSseResponse('cb({"pageHelp":{}});', { keyword: '' }), /result 数组/);
});

// ---------------------------------------------------------------------------
// szse://（深交所，POST JSON）—— 2026-08 实测 404/500，映射按接口历史文档

const szseOk = JSON.stringify({
  error: null,
  data: {
    announceCount: 1,
    announce: [{
      id: '123', title: '关于发射任务的公告', publishTime: '2026-08-11',
      attachPath: '/finalpage/2026-08-11/x.PDF', secName: ['某公司']
    }]
  }
});

test('szse 正常返回：公告附件拼成静态直链', () => {
  const items = mapSzseResponse(szseOk);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '关于发射任务的公告');
  assert.equal(items[0].url, 'https://disc.static.szse.cn/finalpage/2026-08-11/x.PDF');
  assert.equal(items[0].summary, '某公司');
  assert.equal(items[0].publishedAt, '2026-08-10T16:00:00.000Z', 'YYYY-MM-DD 按北京时间零点折算 UTC');
});

test('szse 接口带 error 或结构异常都 throw', () => {
  assert.throws(() => mapSzseResponse(JSON.stringify({ error: { code: '500', message: 'x' } })), /szse 接口返回错误/);
  assert.throws(() => mapSzseResponse(JSON.stringify({ data: {} })), /data\.announce/);
});

// ---------------------------------------------------------------------------
// cls://（财联社电报流）—— 2026-08 实测 404；电报是泛财经流，必须过守卫

const clsOk = JSON.stringify({
  errno: 0,
  data: {
    roll_data: [
      { id: 111, title: '我国成功发射卫星互联网星座', content: '发射任务圆满成功', ctime: 1786435200 },
      { id: 222, content: '某白酒企业召开经销商大会', ctime: 1786435300 }
    ]
  }
});

test('cls 正常返回：带检索词过守卫，无关电报被拦下', () => {
  const items = mapClsResponse(clsOk, { keyword: '卫星互联网' });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.cls.cn/detail/111');
  assert.equal(items[0].publishedAt, new Date(1786435200 * 1000).toISOString());
});

test('cls 无标题电报用内容截断兜底，无检索词时走词库守卫', () => {
  const items = mapClsResponse(clsOk, { keyword: '' });
  // 白酒电报不在本领域词库内，应当被词库守卫拦下
  assert.ok(items.every(i => i.title.includes('卫星')), '泛财经电报必须被词库守卫过滤');
});

test('cls errno 非 0 与结构异常都 throw', () => {
  assert.throws(() => mapClsResponse(JSON.stringify({ errno: 10012, msg: '签名错误' })), /签名错误/);
  assert.throws(() => mapClsResponse('{"data":{}}', { keyword: '' }), /电报数组/);
});

// ---------------------------------------------------------------------------
// scheme 分派与校验层放宽

test('地址解析覆盖全部 5 种 scheme，未知 scheme 被拒绝', () => {
  assert.deepEqual(parseApiSpec('cninfo://?column=szse'),
    { keyword: '', column: 'szse', stock: '', category: '' });
  assert.deepEqual(parseApiSpec('cninfo://卫星互联网?column=sse'),
    { keyword: '卫星互联网', column: 'sse', stock: '', category: '' });
  assert.deepEqual(parseApiSpec('sse://'), { keyword: '' });
  assert.deepEqual(parseApiSpec('szse://'), { keyword: '' });
  assert.deepEqual(parseApiSpec('cls://低空经济'), { keyword: '低空经济' });
  assert.throws(() => parseApiSpec('cninfo://?column=nonsense'), /column/);
  assert.throws(() => parseApiSpec('unknown://x'), /未知 API 信源格式/);
});

test('未知 scheme 的信源在采集入口直接 throw（走退避不入库）', async () => {
  await assert.rejects(fetch({ url: 'weibo://话题' }, {}), /未知 API 信源格式/);
});

test('校验层接受全部 5 种 scheme，仍拒绝 http 地址冒充 api 源', () => {
  for (const url of ['eastmoney://低空经济', 'cninfo://?column=szse', 'sse://', 'szse://', 'cls://低空经济']) {
    assert.equal(sanitizeSourceInput({
      name: 'x', type: 'api', url, tier: 'T1', domain: 'both'
    }).url, url);
  }
  assert.throws(() => sanitizeSourceInput({
    name: '错配', type: 'api', url: 'https://example.com/api', tier: 'T2', domain: 'both'
  }), /eastmoney/);
  // 检索词长度单独校验，不被参数段蒙混
  assert.throws(() => sanitizeSourceInput({
    name: 'x', type: 'api', url: 'cninfo://' + '词'.repeat(101), tier: 'T1', domain: 'both'
  }), /关键词长度/);
});

test('条目 URL 校验：非 HTTP(S) 被丢弃，附件路径解析后必须留在站内静态域', () => {
  // sse：javascript: 与内嵌凭据进不了映射结果
  const sseBad = 'cb(' + JSON.stringify({
    result: [
      { TITLE: '脚本链接', URL: 'javascript:alert(1)', SECURITY_CODE: 'x', SSEDATE: '2026-08-11' },
      { TITLE: '正常链接', URL: 'http://static.sse.com.cn/ok.pdf', SECURITY_CODE: 'x', SSEDATE: '2026-08-11' },
      { TITLE: '内嵌凭据', URL: 'https://a:b@static.sse.com.cn/x.pdf', SECURITY_CODE: 'x', SSEDATE: '2026-08-11' }
    ],
    pageHelp: {}
  }) + ');';
  const sseItems = mapSseResponse(sseBad, { keyword: '' });
  assert.equal(sseItems.length, 1);
  assert.equal(sseItems[0].url, 'http://static.sse.com.cn/ok.pdf');

  // cninfo：绝对地址与协议相对地址都解析不到站内静态域，整条丢弃
  const cninfoEvil = JSON.stringify({
    announcements: [
      {
        secCode: 'x', secName: 'x', announcementTitle: '跨域附件公告',
        announcementTime: 1784160000000, adjunctUrl: 'https://evil.example/x.pdf'
      },
      {
        secCode: 'x', secName: 'x', announcementTitle: '协议相对附件公告',
        announcementTime: 1784160000000, adjunctUrl: '//evil.example/x.pdf'
      }
    ]
  });
  assert.equal(mapCninfoResponse(cninfoEvil, { keyword: '' }).length, 0);

  // szse：协议相对 attachPath 同理被拒
  const szseEvil = JSON.stringify({
    data: {
      announce: [{
        title: '协议相对附件公告', attachPath: '//evil.example/x.pdf',
        secName: ['x'], publishTime: '2026-08-11'
      }]
    }
  });
  assert.equal(mapSzseResponse(szseEvil).length, 0);
});
