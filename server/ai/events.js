'use strict';
// 管线第 6 段：原子事件分离。
//
// 一条新闻常常打包了好几件事：「某公司完成 B 轮融资，同期其 X 型号完成首飞」。
// 按整篇做聚类，这条既进不了「融资」簇也进不了「首飞」簇，多源印证就漏了。
// 拆成原子事件（主体 · 动作 · 客体）之后，同一件事无论被哪家怎么改写标题，
// 都会落到同一个事件键上，聚类与语义合并才有一个精确通道可用。
//
// 动作先归到「动作类」再进键：模型会写「成功入轨」「送入预定轨道」「发射升空」，
// 都是同一件事；不归类的话每家媒体的措辞都会产生一个新键，等于没拆。
const { canonicalizeName, entityKey } = require('./entities');

// 动作类。顺序即优先级：一句话里同时出现「发射成功」和「试验」时按前者归类，
// 所以把语义更强、更具体的类放在前面。
const ACTION_CLASSES = Object.freeze([
  // 「送入预定轨道」「进入预定轨道」是航天通稿里最常见的入轨说法，
  // 中间会插「预定」「既定」之类的词，所以不能只写死「送入轨道」
  ['launch', /(发射|入轨|升空|点火升空|(送|进|推)入[^，。；]{0,6}轨道|组网发射|一箭[\d一二三四五六七八九十]+星|launch|liftoff)/i],
  ['recovery', /(回收|复用|垂直返回|着陆回收|海上回收|recovery|reflight)/i],
  ['flight-test', /(首飞|试飞|验证飞行|悬停试验|转换飞行|飞行测试|maiden flight|test flight)/i],
  ['certification', /(适航|取证|型号合格证|生产许可|运行合格|适航审定|获批|颁证|许可证|certification|type certificate)/i],
  ['funding', /(融资|轮融|募资|增资|领投|注资|估值达|pre-[ab]|[ABCD]\s*轮|funding|raise)/i],
  ['listing', /(上市|IPO|挂牌|过会|招股|敲钟|listing)/i],
  ['order', /(订单|中标|采购|订购|意向书|签署采购|order|contract award)/i],
  ['delivery', /(交付|下线|出厂|量产|投产|首架|首套|delivery|rollout)/i],
  ['partnership', /(签约|战略合作|达成合作|框架协议|联合研制|共建|合资|partnership|joint venture)/i],
  ['policy', /(出台|印发|发布.{0,6}(办法|条例|规划|意见|通知|标准|规范)|批复|获批复|试点|开放.{0,4}空域|立法|新规)/i],
  ['facility', /(开工|建成|启用|投用|揭牌|落成|竣工|奠基|投入运营)/i],
  ['research', /(研制成功|技术突破|攻关|点火试车|地面试验|热试车|完成试验|完成测试|验证成功|breakthrough)/i],
  ['personnel', /(任命|出任|离职|卸任|加盟|成立.{0,6}(公司|事业部|研究院))/i],
  ['incident', /(失败|故障|事故|失联|推迟|延期|取消|中止|坠毁|异常|召回|anomaly|failure)/i]
]);

const MAX_EVENTS = 4;
const MAX_FIELD_LENGTH = 40;

function classifyAction(text) {
  const haystack = String(text || '');
  if (!haystack.trim()) return null;
  for (const [name, pattern] of ACTION_CLASSES) {
    if (pattern.test(haystack)) return name;
  }
  return null;
}

function shortField(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text ? [...text].slice(0, MAX_FIELD_LENGTH).join('') : '';
}

// 归一化一个事件三元组。actor 必填 —— 没有主体的「完成首飞」无法与任何东西对齐，
// 留着只会在语义合并里制造假阳性。
function normalizeEvent(raw, { fallbackText = '' } = {}) {
  const actorName = shortField(typeof raw === 'string' ? raw : raw?.a ?? raw?.actor);
  if (!actorName) return null;
  const objectName = shortField(raw?.o ?? raw?.object);
  const actionText = shortField(raw?.v ?? raw?.action);
  const actionClass = classifyAction(`${actionText} ${objectName}`) || classifyAction(fallbackText);
  const actor = canonicalizeName(actorName);
  if (!actor) return null;
  let object = objectName ? canonicalizeName(objectName) : null;
  // 别名归一之后客体可能塌回主体自己：词库把机型登记成了厂商的别名
  // （AE200 → 沃飞长空），于是「沃飞长空 试飞验证 · 沃飞长空」既读着结巴，
  // 事件键里也多了一段没有信息量的重复。丢掉即可。
  if (object && object.key === actor.key) object = null;

  // 动作类归不出来时退回动作原文做键。这样至少「同一主体同一措辞」还能对齐，
  // 而不会让所有未分类动作挤成同一个键，把无关的事情并到一起。
  const actionSlot = actionClass || entityKey(actionText).slice(0, 24);
  if (!actionSlot) return null;
  const objectSlot = object ? object.key : '';
  return {
    actor: actor.name,
    action: actionText || actionClass || '',
    actionClass,
    object: object ? object.name : '',
    time: shortField(raw?.w ?? raw?.time),
    key: `${actor.key}|${actionSlot}${objectSlot ? `|${objectSlot}` : ''}`
  };
}

// 模型输出 → 原子事件列表。按键去重并截断，主事件（第一条）排在最前。
function normalizeEvents(raw, { fallbackText = '' } = {}) {
  const seen = new Set();
  const events = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const event = normalizeEvent(item, { fallbackText });
    if (!event || seen.has(event.key)) continue;
    seen.add(event.key);
    events.push(event);
    if (events.length === MAX_EVENTS) break;
  }
  return events;
}

// 降级通道：无 Key 或模型没给 events 时，用「词库实体 + 标题动作」凑一个主事件。
// 只有当动作能归类时才生成 —— 归不出类的标题，硬凑出来的事件键没有任何判别力。
function deriveEvents(text, entities) {
  const actionClass = classifyAction(text);
  if (!actionClass) return [];
  const anchor = (Array.isArray(entities) ? entities : []).find(entity => entity?.known && entity.name);
  if (!anchor) return [];
  return normalizeEvents([{ a: anchor.name, v: actionClass }], { fallbackText: text });
}

// 主事件键：这条情报最该被对齐的那一件事。聚类的精确通道只看它，
// 次要事件参与语义合并时的加权判断，不单独并簇（否则「顺带提了一句」也会把两条并起来）。
function primaryEventKey(events) {
  return Array.isArray(events) && events.length ? events[0].key : null;
}

function eventKeys(events) {
  return [...new Set((Array.isArray(events) ? events : []).map(event => event?.key).filter(Boolean))];
}

module.exports = {
  ACTION_CLASSES,
  MAX_EVENTS,
  classifyAction,
  normalizeEvent,
  normalizeEvents,
  deriveEvents,
  primaryEventKey,
  eventKeys
};
