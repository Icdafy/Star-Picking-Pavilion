'use strict';
// 管线第 4、5 段：标注 与 实体提取。
//
// 「标注」是把一条情报挂到主题上（低空经济总纲 / 适航与监管 / 资本与产业…），
// 「实体提取」是把里面出现的具名对象抠出来（企业、型号、发射场、政策文件…）。
// 两件事共用同一份词库：config/lexicon.json 的分组既是主题，组里的词条又是实体候选。
//
// 双通道合并，各补各的短板：
//   ① 代码通道 —— 词库精确匹配。零成本、确定性强，还自带别名归一
//      （「蓝箭」「蓝箭航天」「LandSpace」归到同一个规范名），但只认识词库里有的东西。
//   ② 模型通道 —— 评分那一次调用顺带产出 entities 字段。能认出词库里没有的新公司、
//      新型号、人名，但会写出各种简称。
// 代码通道的结果优先：它给出的是规范名，模型给的同义写法会被它吸收掉。
const lexicon = require('./lexicon');
const { foldFullWidthAlnum, collapseSpace } = require('./normalize');

// 实体类型。org=机构主体，product=型号/产品/星座，facility=场站基建，
// place=地域，person=人物，policy=政策文件与许可。
const ENTITY_TYPES = Object.freeze(['org', 'product', 'facility', 'place', 'person', 'policy']);
const TYPE_ORDER = new Map(ENTITY_TYPES.map((type, index) => [type, index]));

// 词库分组 → 实体类型。没列进来的分组（总纲、无人机、资本与产业）是主题而不是实体：
// 「低空经济」「商业航天」当标注很合适，当实体则毫无区分度——所有条目都会命中。
const GROUP_ENTITY_TYPES = Object.freeze({
  'la-oem': 'org',
  'la-intl': 'org',
  'cs-rocketco': 'org',
  'cs-satco': 'org',
  'cs-intl': 'org',
  'la-aircraft': 'product',
  'cs-rocket': 'product',
  'cs-sat': 'product',
  'la-infra': 'facility',
  'cs-launch': 'facility',
  'la-cert': 'policy'
});

const MAX_ENTITIES = 10;
const MAX_TOPICS = 5;
const MAX_NAME_LENGTH = 40;

// 归一键：大小写、全半角、空白与标点全部抹平。
// 「Space X」「SpaceX」「space-x」必须落到同一个键，否则聚类那一段又要重复做一次同义判断。
function entityKey(name) {
  return foldFullWidthAlnum(String(name || ''))
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

// 别名归一：模型写「蓝箭」，词库里规范名是「蓝箭航天」，统一取规范名。
// 只在整体等于某个匹配面时替换 —— 子串包含会把「星网集团」错认成「星网」。
let aliasIndex = null;
let aliasIndexVersion = -1;

function surfaceIndex() {
  const { version, terms } = lexicon.loadLexicon();
  if (aliasIndex && aliasIndexVersion === version) return aliasIndex;
  const index = new Map();
  for (const term of terms) {
    const type = GROUP_ENTITY_TYPES[term.group];
    if (!type) continue;
    for (const surface of term.surfaces) {
      const key = entityKey(surface);
      // 先到先得：ordered 已按长度倒序，长匹配面先占位
      if (key && !index.has(key)) index.set(key, { name: term.term, type, weight: term.weight });
    }
  }
  aliasIndex = index;
  aliasIndexVersion = version;
  return index;
}

// 测试与词库热更新用
function resetAliasIndex() {
  aliasIndex = null;
  aliasIndexVersion = -1;
}

function canonicalizeName(name) {
  const cleaned = collapseSpace(String(name || '')).slice(0, MAX_NAME_LENGTH);
  if (!cleaned) return null;
  const key = entityKey(cleaned);
  if (!key) return null;
  const known = surfaceIndex().get(key);
  return known
    ? { name: known.name, type: known.type, key: entityKey(known.name), weight: known.weight, known: true }
    : { name: cleaned, type: null, key, weight: 0, known: false };
}

// 代码通道：词库命中里属于实体分组的部分
function lexiconEntities(hits) {
  const found = [];
  for (const hit of hits || []) {
    const type = GROUP_ENTITY_TYPES[hit.group];
    if (!type) continue;
    found.push({ name: hit.term, type, key: entityKey(hit.term), weight: hit.weight, known: true });
  }
  return found;
}

// 模型通道：{"n":"名称","t":"org"} 的数组。类型不在白名单内就交给词库判定，
// 词库也不认识时落到 org —— 模型愿意单独列出来的，绝大多数是机构主体。
function modelEntities(raw) {
  const found = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const canonical = canonicalizeName(typeof item === 'string' ? item : item?.n ?? item?.name);
    if (!canonical) continue;
    const declared = String((typeof item === 'object' && (item?.t ?? item?.type)) || '').toLowerCase();
    found.push({
      ...canonical,
      type: canonical.type || (ENTITY_TYPES.includes(declared) ? declared : 'org')
    });
  }
  return found;
}

// 主题标注：词库分组即主题，按该组命中的权重和排序取前几个
function topicsOf(hits) {
  const byGroup = new Map();
  for (const hit of hits || []) {
    const current = byGroup.get(hit.group) || { id: hit.group, label: hit.groupLabel, weight: 0 };
    current.weight += hit.weight;
    byGroup.set(hit.group, current);
  }
  return [...byGroup.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_TOPICS)
    .map(({ id, label }) => ({ id, label }));
}

// 合并两个通道。词库结果先入列，因此同一个键上模型的写法会被规范名吸收。
function analyzeEntities(text, rawModelEntities) {
  const hits = lexicon.matchTerms(text);
  const merged = new Map();
  for (const entity of [...lexiconEntities(hits), ...modelEntities(rawModelEntities)]) {
    if (!merged.has(entity.key)) merged.set(entity.key, entity);
  }
  const entities = [...merged.values()]
    .sort((a, b) =>
      (TYPE_ORDER.get(a.type) ?? 99) - (TYPE_ORDER.get(b.type) ?? 99)
      || b.weight - a.weight
      || a.name.localeCompare(b.name))
    .slice(0, MAX_ENTITIES)
    .map(({ name, type, key, known }) => ({ name, type, key, known }));
  return { entities, topics: topicsOf(hits) };
}

// 能当「锚点」的实体类型。product 与 policy 在本词库里混着大量技术路线词
// （液氧甲烷、复合翼、卫星互联网、适航取证…），它们描述的是一类事而不是一个主体：
// 两条毫不相干的发射快讯都会同时命中「运载火箭 + 入轨」，凑够两个共享锚点就被并簇。
// 机构、场站、人物才是真正指向唯一对象的名字；具名型号（朱雀三号、吉林一号）
// 在词库里本就落在企业组里，因此不会因为这条收紧而漏掉。
const ANCHOR_TYPES = new Set(['org', 'facility', 'person']);

// 聚类与语义合并只关心「有没有共享具名主体」，通用主题词在这里是噪声，
// 所以只取词库认识、且类型够具体的那部分键 ——
// 模型顺手写出的泛称同样不参与并簇判定。
function anchorKeys(entities) {
  return [...new Set(
    (Array.isArray(entities) ? entities : [])
      .filter(entity => entity?.known && entity.key && ANCHOR_TYPES.has(entity.type))
      .map(entity => entity.key)
  )];
}

module.exports = {
  ENTITY_TYPES,
  GROUP_ENTITY_TYPES,
  ANCHOR_TYPES,
  MAX_ENTITIES,
  entityKey,
  canonicalizeName,
  analyzeEntities,
  anchorKeys,
  topicsOf,
  resetAliasIndex
};
