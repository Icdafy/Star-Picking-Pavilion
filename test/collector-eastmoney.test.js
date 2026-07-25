'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseEastmoneySpec, buildGuard } = require('../server/collectors/api');
const { sanitizeSourceInput } = require('../server/input-validation');

const seed = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'sources.default.json'), 'utf8'));

test('eastmoney 地址解析：默认相关性优先 + 时效补充，参数可选', () => {
  assert.deepEqual(parseEastmoneySpec('eastmoney://低空经济'),
    { keyword: '低空经济', pages: 1, mode: 'both', guard: true });
  assert.deepEqual(parseEastmoneySpec('eastmoney://商业航天?pages=3&mode=relevance&guard=off'),
    { keyword: '商业航天', pages: 3, mode: 'relevance', guard: false });
});

test('翻页数被夹在合法区间，非法参数退回默认值', () => {
  assert.equal(parseEastmoneySpec('eastmoney://X?pages=99').pages, 3);
  assert.equal(parseEastmoneySpec('eastmoney://X?pages=0').pages, 1);
  assert.equal(parseEastmoneySpec('eastmoney://X?pages=abc').pages, 1);
  assert.equal(parseEastmoneySpec('eastmoney://X?mode=nonsense').mode, 'both');
});

test('关键词经过 URL 解码，空关键词被拒绝', () => {
  assert.equal(parseEastmoneySpec('eastmoney://' + encodeURIComponent('低空经济')).keyword, '低空经济');
  assert.throws(() => parseEastmoneySpec('eastmoney://'), /缺少关键词/);
  assert.throws(() => parseEastmoneySpec('eastmoney://?pages=2'), /缺少关键词/);
});

test('入库守卫拦下东财的降级泛新闻，放行真正相关的条目', () => {
  // 这正是 v0.0.6 的病灶：检索「蓝箭航天」，东财按分词 OR 匹配返回当天全网最新新闻
  const guard = buildGuard('蓝箭航天');
  assert.equal(guard({ title: '沙特空袭也门胡塞据点，曼德海峡通航量回升', summary: '' }), false);
  assert.equal(guard({ title: '松江九亭人口三年增长超5万', summary: '' }), false);
  // 关键词直接出现
  assert.equal(guard({ title: '蓝箭航天完成新一轮融资', summary: '' }), true);
  // 关键词没出现，但整条确实落在本领域内（词库判定）—— 换个说法说同一件事的报道不该被误杀
  assert.equal(guard({ title: '朱雀三号完成静态点火试验', summary: '可回收火箭进展' }), true);
});

test('守卫也检查摘要，标题党标题不会漏掉正文里的实体', () => {
  const guard = buildGuard('峰飞航空');
  assert.equal(guard({ title: '又一笔大单落地', summary: '峰飞航空与顺丰签署合作协议' }), true);
  assert.equal(guard({ title: '又一笔大单落地', summary: '某白酒经销商年会签约' }), false);
});

test('带空格的组合关键词按整体与分片双重匹配', () => {
  const guard = buildGuard('Blue Origin');
  assert.equal(guard({ title: 'Blue Origin 新格伦火箭二次发射', summary: '' }), true);
  assert.equal(guard({ title: 'Origin 品牌发布新款咖啡机', summary: '' }), true, '分片匹配会放行，随后交由预筛把关');
  assert.equal(guard({ title: '某地啤酒节开幕', summary: '' }), false);
});

test('信源校验接受带参数的 eastmoney 地址，且关键词长度单独校验', () => {
  const source = sanitizeSourceInput({
    name: '东财检索·测试', type: 'api', url: 'eastmoney://低空经济?pages=2', tier: 'T2', domain: 'lowaltitude'
  });
  assert.equal(source.url, 'eastmoney://低空经济?pages=2');
  // 参数不该被算进关键词长度里蒙混过关
  assert.throws(() => sanitizeSourceInput({
    name: 'x', type: 'api', url: 'eastmoney://' + '词'.repeat(101) + '?pages=2', tier: 'T2', domain: 'both'
  }), /关键词长度/);
});

test('种子库只锁定低空经济与商业航天两个领域', () => {
  for (const source of seed.sources) {
    assert.ok(['lowaltitude', 'aerospace', 'both'].includes(source.domain),
      `${source.name} 的领域越界：${source.domain}`);
    assert.ok(['rss', 'api', 'html', 'bing'].includes(source.type), `${source.name} 类型未知`);
    assert.ok(['T1', 'T1.5', 'T2'].includes(source.tier), `${source.name} 等级未知`);
  }
});

test('种子库显著扩容，且没有重复地址', () => {
  assert.ok(seed.sources.length >= 100, `信源数量 ${seed.sources.length}，扩容不足`);
  assert.ok(seed.sources.filter(s => s.type === 'api').length >= 70, '关键词检索线覆盖不足');
  assert.ok(seed.sources.filter(s => s.type === 'html').length >= 8, '官方一手信源不足');
  assert.ok(seed.sources.filter(s => s.type === 'rss').length >= 15, 'RSS 信源不足');
  const urls = new Set();
  for (const source of seed.sources) {
    assert.equal(urls.has(source.url), false, `重复地址 ${source.url}`);
    urls.add(source.url);
  }
});

test('每条 api 信源的地址都能被采集器解析', () => {
  for (const source of seed.sources.filter(s => s.type === 'api')) {
    assert.doesNotThrow(() => parseEastmoneySpec(source.url), `${source.name} 地址无法解析`);
  }
});

test('html 信源都带选择器，默认停用的源都在备注里说明了原因', () => {
  for (const source of seed.sources.filter(s => s.type === 'html')) {
    assert.ok(source.selector?.list, `${source.name} 缺少列表选择器`);
  }
  for (const source of seed.sources.filter(s => s.enabled === false)) {
    assert.ok(source.note && source.note.length > 10, `${source.name} 默认停用却没说明原因`);
  }
});

test('迁移清单的三种写法各自自洽，不会误伤本次新增的信源', () => {
  // 三种：relocate（换地址，带 to）／ patch（原地修选择器等，无 to）／ retire（停用）
  const seededUrls = new Set(seed.sources.map(s => s.url));
  assert.ok(Array.isArray(seed._migrations) && seed._migrations.length > 0);

  for (const step of seed._migrations) {
    assert.ok(step.from, '迁移步骤缺少 from');
    if (step.retire) {
      assert.ok(step.note, `停用 ${step.from} 却没写原因`);
      continue;
    }
    if (step.to) {
      assert.notEqual(step.to, step.from, '换地址的目标不能与来源相同');
      assert.equal(seededUrls.has(step.to), true, `迁移目标 ${step.to} 不在种子库里`);
      // 换了地址的老源不能同时还留在种子库里，否则补新源那一步会把它原样插回来，
      // 用户看到的就是一条刚迁走的新源加一条继续报错的老源。
      assert.equal(seededUrls.has(step.from), false,
        `老地址 ${step.from} 仍在种子库中，迁移会被立刻撤销`);
      continue;
    }
    // 原地修正：地址不变，必须真的改了点什么，且该地址仍在种子库里
    assert.ok(step.selector || step.name || step.tier || step.note,
      `${step.from} 既不换地址也不改内容，这一步没有意义`);
    assert.equal(seededUrls.has(step.from), true,
      `原地修正的 ${step.from} 应当仍在种子库里`);
  }
});

test('原地修正的信源，种子库与迁移清单里的配置必须一致', () => {
  // 两处不一致的话，老用户走迁移拿到 A，新用户走种子库拿到 B，同一个信源两套行为
  const seededByUrl = new Map(seed.sources.map(s => [s.url, s]));
  for (const step of seed._migrations.filter(s => !s.retire && !s.to)) {
    const seeded = seededByUrl.get(step.from);
    assert.ok(seeded, `${step.from} 不在种子库中`);
    if (step.name) assert.equal(seeded.name, step.name);
    if (step.tier) assert.equal(seeded.tier, step.tier);
    if (step.selector) assert.deepEqual(seeded.selector, step.selector);
  }
  // 换地址的同理：迁移后的那一行要和种子库里同地址的那条长得一样
  for (const step of seed._migrations.filter(s => s.to)) {
    const seeded = seededByUrl.get(step.to);
    if (step.name) assert.equal(seeded.name, step.name, `${step.to} 名称两处不一致`);
    if (step.tier) assert.equal(seeded.tier, step.tier, `${step.to} 等级两处不一致`);
    if (step.selector) assert.deepEqual(seeded.selector, step.selector, `${step.to} 选择器两处不一致`);
  }
});
