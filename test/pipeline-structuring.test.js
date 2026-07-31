'use strict';
// 八段式管线里四段纯代码环节的单测：
// 结构化/清洗（normalize）、标注与实体提取（entities）、原子事件分离（events）、语义合并（merge）。
// 这四段不调模型，因此可以被完全确定地断言——回归发生时这里必须先红。
const test = require('node:test');
const assert = require('node:assert/strict');

const normalize = require('../server/ai/normalize');
const entities = require('../server/ai/entities');
const events = require('../server/ai/events');
const { semanticPairs } = require('../server/ai/merge');

// ---------- ① 结构化 / ② 数据清洗 ----------

test('canonical url strips tracking noise so one article is one row', () => {
  const canonical = normalize.canonicalizeUrl(
    'HTTP://www.Example.com/news/1?utm_source=wx&id=7&spm=a1&from=timeline#comments'
  );
  // 只保留真参数 id；协议、www、锚点与全部跟踪参数都被抹平
  assert.equal(canonical, 'https://example.com/news/1?id=7');
  // 三个入口进来的同一篇文章必须落到同一个去重键
  assert.equal(
    normalize.canonicalizeUrl('https://example.com/news/1/?id=7&scene=23'),
    canonical
  );
  assert.equal(
    normalize.canonicalizeUrl('https://example.com/news/1?fbclid=abc&id=7'),
    canonical
  );
  // 真参数不同就是不同文章，不能被误并
  assert.notEqual(normalize.canonicalizeUrl('https://example.com/news/1?id=8'), canonical);
});

test('canonical url rejects non-http schemes and unparseable input', () => {
  assert.equal(normalize.canonicalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalize.canonicalizeUrl('file:///etc/passwd'), '');
  assert.equal(normalize.canonicalizeUrl('not a url'), '');
  assert.equal(normalize.canonicalizeUrl(''), '');
  assert.equal(normalize.canonicalizeUrl(null), '');
});

test('title cleaning removes entities, site tails, and the source prefix', () => {
  assert.equal(
    normalize.cleanTitle('【东方财富】蓝箭航天完成首飞 &amp; 一子级回收_东方财富网', { sourceName: '东方财富' }),
    '蓝箭航天完成首飞 & 一子级回收'
  );
  // 叠了两层站点名的标题要一路剪干净
  assert.equal(
    normalize.cleanTitle('垣信卫星完成新一轮融资_新浪财经_新浪网'),
    '垣信卫星完成新一轮融资'
  );
  // 全角字母数字折半角，型号才能和其他信源对齐
  assert.equal(normalize.cleanTitle('Ｃ９１９完成测试'), 'C919完成测试');
});

test('title cleaning does not amputate real titles that end with a dash', () => {
  // 尾巴不像站点名就不剪 —— 这是站点后缀规则最容易误伤的地方
  const title = '朱雀三号首飞成功 - 一子级完成海上回收';
  assert.equal(normalize.cleanTitle(title), title);
  // 剪完剩不到 6 个字符时同样放弃
  assert.equal(normalize.cleanTitle('短标题_财经网'), '短标题_财经网');
});

test('summary cleaning drops boilerplate tails but keeps all-boilerplate text intact', () => {
  assert.equal(
    normalize.cleanSummary('<p>公司宣布本轮融资由某基金领投，资金将用于产线建设。</p>责任编辑：张三'),
    '公司宣布本轮融资由某基金领投，资金将用于产线建设。'
  );
  // 声明出现在最开头时不截断：截了会得到空串，
  // 留着反而能让预筛认出这是模板内容并判无关
  const allBoilerplate = '免责声明：本文不构成投资建议。';
  assert.equal(normalize.cleanSummary(allBoilerplate), allBoilerplate);
  // script 块整体丢弃，不能把脚本正文当成摘要
  assert.equal(normalize.cleanSummary('<script>var a=1;</script>正文内容'), '正文内容');
});

test('structureItem rejects items without a usable title or url', () => {
  assert.equal(normalize.structureItem({ title: '有标题', url: 'javascript:void(0)' }), null);
  assert.equal(normalize.structureItem({ title: '   ', url: 'https://example.com/a' }), null);
  const structured = normalize.structureItem(
    { title: '亿航智能取得生产许可证_民航资源网', url: 'https://example.com/a?utm_medium=x', summary: ' 摘要 ' },
    { sourceName: '民航资源网', domain: 'lowaltitude' }
  );
  assert.equal(structured.title, '亿航智能取得生产许可证');
  assert.equal(structured.canonicalUrl, 'https://example.com/a');
  assert.equal(structured.url, 'https://example.com/a?utm_medium=x');   // 跳转仍用原始地址
  assert.equal(structured.summaryRaw, '摘要');
  assert.equal(structured.domain, 'lowaltitude');
  assert.equal(structured.cleanVersion, normalize.CLEAN_VERSION);
});

// ---------- ④ 标注 / ⑤ 实体提取 ----------

test('entity extraction merges the lexicon channel with the model channel', () => {
  const { entities: found, topics } = entities.analyzeEntities(
    '蓝箭航天朱雀三号在海南商业航天发射场完成首飞',
    [{ n: '蓝箭', t: 'org' }, { n: '某未知火箭公司', t: 'org' }]
  );
  const names = found.map(entity => entity.name);
  // 模型写的简称「蓝箭」被词库规范名吸收，不会重复成两个实体
  assert.ok(names.includes('蓝箭航天'));
  assert.equal(names.filter(name => name === '蓝箭航天').length, 1);
  assert.equal(names.includes('蓝箭'), false);
  // 词库不认识的新主体照样保留 —— 这正是模型通道存在的理由
  assert.ok(names.includes('某未知火箭公司'));
  // 场站被认成 facility 而不是 org
  const launchSite = found.find(entity => entity.name === '海南商业航天发射场');
  assert.equal(launchSite?.type, 'facility');
  assert.ok(topics.length > 0, '标注：命中的词库分组即主题');
});

test('行业名不是实体，泛称主体不参与并簇', () => {
  const { entities: found } = entities.analyzeEntities('低空经济与商业航天迎来政策利好', []);
  // 总纲组不在实体白名单里：所有条目都会命中的词毫无区分度
  assert.deepEqual(found.map(entity => entity.name), []);
  // 模型顺手写出的泛称进得来，但拿不到锚点资格
  const mixed = entities.analyzeEntities('蓝箭航天与某研究院签约', [{ n: '某研究院', t: 'org' }]);
  const anchors = entities.anchorKeys(mixed.entities);
  assert.deepEqual(anchors, [entities.entityKey('蓝箭航天')]);
});

test('技术路线词可以当标签，但不能当并簇锚点', () => {
  // 「运载火箭 + 入轨 + 液氧甲烷」是一类事，不是一个主体。
  // 两条毫不相干的发射快讯都会命中它们，若算作锚点就会被误并。
  const { entities: found } = entities.analyzeEntities(
    '某火箭采用液氧甲烷发动机，运载火箭将载荷送入预定轨道', []
  );
  assert.ok(found.length > 0, '技术路线词仍然作为实体标签展示');
  assert.deepEqual(entities.anchorKeys(found), [], '但一个锚点都不产生');

  // 机构与场站才是指向唯一对象的名字
  const named = entities.analyzeEntities('蓝箭航天在海南商业航天发射场完成发射', []);
  assert.deepEqual(
    entities.anchorKeys(named.entities).sort(),
    [entities.entityKey('海南商业航天发射场'), entities.entityKey('蓝箭航天')].sort()
  );
});

test('entity keys fold case, width, and punctuation differences', () => {
  assert.equal(entities.entityKey('Space X'), entities.entityKey('SpaceX'));
  assert.equal(entities.entityKey('space-x'), entities.entityKey('SpaceX'));
  assert.equal(entities.entityKey('Ｓｐａｃｅ Ｘ'), entities.entityKey('SpaceX'));
});

// ---------- ⑥ 原子事件分离 ----------

test('multi-event articles are split into distinct atomic events', () => {
  const atomic = events.normalizeEvents([
    { a: '沃飞长空', v: '完成 B 轮融资' },
    { a: '沃飞长空', v: 'AE200 完成首飞', o: 'AE200' }
  ]);
  assert.equal(atomic.length, 2, '一条资讯里的两件事必须拆开');
  assert.equal(atomic[0].actionClass, 'funding');
  assert.equal(atomic[1].actionClass, 'flight-test');
  assert.notEqual(atomic[0].key, atomic[1].key);
  // 主事件键取第一条 —— 排在最前的是最重要的那件
  assert.equal(events.primaryEventKey(atomic), atomic[0].key);
});

test('different wording for the same event lands on the same key', () => {
  const [a] = events.normalizeEvents([{ a: '蓝箭航天', v: '发射入轨', o: '朱雀三号' }]);
  const [b] = events.normalizeEvents([{ a: '蓝箭', v: '成功送入预定轨道', o: '朱雀二号' }]);
  // 主体别名归一 + 动作归类 + 客体别名归一，三者一致即同一件事
  assert.equal(a.key, b.key);
  // 动作类不同就不是同一件事
  const [c] = events.normalizeEvents([{ a: '蓝箭航天', v: '签署战略合作协议', o: '朱雀三号' }]);
  assert.notEqual(a.key, c.key);
});

test('客体在别名归一后塌回主体时被丢掉', () => {
  // 词库把 AE200 登记成了沃飞长空的别名，归一后主客体同名，
  // 留着只会得到「沃飞长空 试飞验证 · 沃飞长空」和一段重复的事件键
  const [event] = events.normalizeEvents([{ a: '沃飞长空', v: '完成首飞', o: 'AE200' }]);
  assert.equal(event.actor, '沃飞长空');
  assert.equal(event.object, '');
  assert.equal(event.key, `${entities.entityKey('沃飞长空')}|flight-test`);
});

test('atomic events without an actor or an action are dropped', () => {
  assert.deepEqual(events.normalizeEvents([{ v: '完成首飞' }]), []);
  assert.deepEqual(events.normalizeEvents([{ a: '蓝箭航天', v: '' }]), []);
  assert.deepEqual(events.normalizeEvents(null), []);
  assert.deepEqual(events.normalizeEvents('not an array'), []);
});

test('deriveEvents backfills a primary event when the model returns none', () => {
  const { entities: found } = entities.analyzeEntities('亿航智能获颁生产许可证', []);
  const derived = events.deriveEvents('亿航智能获颁生产许可证', found);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].actionClass, 'certification');
  // 归不出动作类时不硬凑：没有判别力的键只会制造假阳性
  assert.deepEqual(events.deriveEvents('亿航智能今天很忙', found), []);
  // 没有词库锚点时同样不生成
  assert.deepEqual(events.deriveEvents('某公司完成首飞', []), []);
});

// ---------- ⑧ 语义合并 ----------

function collectPairs(rows, options) {
  const merged = [];
  semanticPairs(rows, (a, b, channel) => merged.push([a.id, b.id, channel].join('|')), options);
  return merged;
}

test('semantic merge unites articles that share a primary event key', () => {
  const key = 'lanjian|launch|zhuque';
  const merged = collectPairs([
    { id: 1, domain: 'aerospace', primaryEventKey: key, actionClass: 'launch', anchorKeys: ['lanjian'] },
    { id: 2, domain: 'aerospace', primaryEventKey: key, actionClass: 'launch', anchorKeys: ['lanjian'] },
    { id: 3, domain: 'aerospace', primaryEventKey: 'other|funding', actionClass: 'funding', anchorKeys: ['x'] }
  ]);
  assert.deepEqual(merged, ['1|2|event-key']);
});

test('anchor overlap needs two shared entities and a matching action class', () => {
  const base = { domain: 'aerospace', primaryEventKey: null, actionClass: 'launch' };
  // 只共享一个锚点：不并（否则「又一家公司拿到 SpaceX 订单」会被并进「SpaceX 发射成功」）
  assert.deepEqual(collectPairs([
    { ...base, id: 1, anchorKeys: ['spacex', 'starlink'] },
    { ...base, id: 2, anchorKeys: ['spacex', 'kuiper'] }
  ]), []);
  // 共享两个锚点且动作类一致：并
  assert.deepEqual(collectPairs([
    { ...base, id: 1, anchorKeys: ['spacex', 'starlink'] },
    { ...base, id: 2, anchorKeys: ['spacex', 'starlink'] }
  ]), ['1|2|anchor-overlap']);
  // 锚点相同但动作类不同：同一批公司在做不同的事，不并
  assert.deepEqual(collectPairs([
    { ...base, id: 1, anchorKeys: ['spacex', 'starlink'] },
    { ...base, id: 2, actionClass: 'partnership', anchorKeys: ['spacex', 'starlink'] }
  ]), []);
});

test('semantic merge never crosses domains and skips high-frequency anchors', () => {
  const key = 'shared|launch';
  // 跨领域禁并的约束在语义通道里同样成立
  assert.deepEqual(collectPairs([
    { id: 1, domain: 'aerospace', primaryEventKey: key, actionClass: 'launch', anchorKeys: [] },
    { id: 2, domain: 'lowaltitude', primaryEventKey: key, actionClass: 'launch', anchorKeys: [] }
  ]), []);

  // 出现得太频繁的锚点没有判别力，把上限压到 2 之后它不再参与配对
  const rows = Array.from({ length: 4 }, (unused, index) => ({
    id: index + 1,
    domain: 'aerospace',
    primaryEventKey: null,
    actionClass: 'launch',
    anchorKeys: ['common', 'alsocommon']
  }));
  assert.deepEqual(collectPairs(rows, { maxAnchorPostings: 2 }), []);
  assert.ok(collectPairs(rows).length > 0, '不设上限时这批本来是会被并起来的');
});

test('semanticPairs tolerates empty and malformed input', () => {
  assert.equal(semanticPairs([], () => {}), 0);
  assert.equal(semanticPairs(null, () => {}), 0);
  assert.equal(semanticPairs([{ id: 1 }], () => {}), 0);
  assert.equal(semanticPairs([{ id: 1, anchorKeys: null }, { id: 2 }], () => {}), 0);
});
