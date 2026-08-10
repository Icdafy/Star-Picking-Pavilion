'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const DomUtils = require('../renderer/dom-utils');
const FormatUtils = require('../renderer/format-utils');
const FeedCard = require('../renderer/feed-card');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'feed-card.js'), 'utf8');

function createCard() {
  return FeedCard.createFeedCard({
    esc: DomUtils.escapeHTML,
    safeHttpUrl: DomUtils.safeHttpUrl,
    format: FormatUtils
  });
}

test('feed-card 是依赖注入的表示层模块：不直读 window，也不泄漏全局', () => {
  // lint 式护栏：工厂体（含 UMD 暴露层）不得出现裸 window. 直读，
  // esc/safeHttpUrl/format 一律由组合根注入
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  assert.throws(() => FeedCard.createFeedCard({}), TypeError);
  const modulePath = require.resolve('../renderer/feed-card');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.FeedCard;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createFeedCard === 'function'
        && typeof api.createCardRenderer === 'function'
        && typeof api.createFeedDiffList === 'function'
        && typeof api.publishedTime === 'function'
        && typeof api.starredTime === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'FeedCard')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    exported: true,
    frozen: true,
    globalCreated: false
  });
});

test('scorePill 区分精选、已评分与待评三态', () => {
  const { scorePill } = createCard();
  assert.match(scorePill({ featured: true, quality: 87.4, heat: 120 }), /class="score-pill featured"/);
  assert.match(scorePill({ featured: true, quality: 87.4, heat: 120 }), /精选 <b>87<\/b>/);
  assert.match(scorePill({ quality: 62 }), /质量 <b>62<\/b>/);
  assert.equal(scorePill({}), '<span class="score-pill">待评</span>');
});

test('scorePill 的 title 数值经 Number 收敛，无 undefined/NaN 裸插值', () => {
  const { scorePill } = createCard();
  const featured = scorePill({ featured: true, quality: '87.4', heat: '120' });
  assert.match(featured, /质量分 87\.4 · 当前热度 120/);
  // 热度缺失时收敛为 0，不得出现 undefined/NaN
  const plain = scorePill({ quality: 62 });
  assert.match(plain, /质量分 62 · 当前热度 0/);
  assert.doesNotMatch(plain, /undefined|NaN/);
  const noHeat = scorePill({ featured: true, quality: 80 });
  assert.doesNotMatch(noHeat, /undefined|NaN/);
});

test('breakthroughPresentation 拒绝无效加成并约束 bonus/score 取值范围', () => {
  const { breakthroughPresentation } = createCard();
  assert.equal(breakthroughPresentation({}), null);
  assert.equal(breakthroughPresentation({ breakthroughBonus: 0 }), null);
  assert.equal(breakthroughPresentation({ breakthroughBonus: 'abc' }), null);
  const capped = breakthroughPresentation({ breakthroughBonus: 350, breakthroughScore: 2 });
  assert.equal(capped.bonus, '100');
  assert.equal(capped.score, 100);
  const fractional = breakthroughPresentation({ breakthroughBonus: 12.5, breakthroughScore: 0.83 });
  assert.equal(fractional.bonus, '12.5');
  assert.equal(fractional.score, 83);
  assert.match(fractional.explanation, /热度加成 12\.5 分/);
  assert.match(fractional.explanation, /突破强度：83%/);
});

test('breakthroughPresentation 清洗信号词并翻译可信度依据', () => {
  const { breakthroughPresentation } = createCard();
  const presentation = breakthroughPresentation({
    breakthroughBonus: 20,
    breakthroughScore: 0.5,
    breakthroughSignals: {
      objects: [' 亿航智能 ', '', null, 'A', 'B', 'C', 'D', 'E'],
      actions: ['<b>取证</b>'],
      credibilityEvidence: 'tier-t1'
    }
  });
  // 词条只保留非空字符串、截断到 4 个、去掉首尾空白
  assert.match(presentation.explanation, /技术对象：亿航智能、A、B、C/);
  assert.doesNotMatch(presentation.explanation, /、E/);
  assert.match(presentation.explanation, /完成证据：<b>取证<\/b>/);
  assert.match(presentation.explanation, /可信依据：官方一手信源/);
  const fallback = breakthroughPresentation({ breakthroughBonus: 5, breakthroughSignals: 'not-object' });
  assert.match(fallback.explanation, /可信依据：可信信源验证/);
});

test('entityChipsHtml 只渲染有名字的实体并转义文案', () => {
  const { entityChipsHtml } = createCard();
  assert.equal(entityChipsHtml({}), '');
  assert.equal(entityChipsHtml({ entities: [{ type: 'org' }] }), '');
  const html = entityChipsHtml({
    entities: [
      { name: '蓝箭航天', type: 'org' },
      { name: '"未知型"', type: 'mystery' }
    ]
  });
  assert.match(html, /class="card-entities"/);
  assert.match(html, /data-entity="蓝箭航天"/);
  assert.match(html, /按机构检索「蓝箭航天」/);
  assert.match(html, /data-entity="&quot;未知型&quot;"/);
  assert.match(html, /按实体检索/);
  const many = entityChipsHtml({
    entities: Array.from({ length: 9 }, (_, i) => ({ name: `实体${i}` }))
  });
  assert.equal([...many.matchAll(/class="card-entity"/g)].length, 6);
});

test('atomicEventsHtml 少于两件事不渲染，动作按类别归一', () => {
  const { atomicEventsHtml } = createCard();
  assert.equal(atomicEventsHtml({}), '');
  assert.equal(atomicEventsHtml({ events: [{ actor: '朱雀三号', actionClass: 'launch' }] }), '');
  const html = atomicEventsHtml({
    events: [
      { actor: '朱雀三号', actionClass: 'launch', object: '遥二' },
      { actor: '<script>', action: '自定义动作' }
    ]
  });
  assert.match(html, /原子事件 2/);
  assert.match(html, /<b>朱雀三号<\/b><span>发射入轨<\/span> · 遥二/);
  assert.match(html, /<b>&lt;script&gt;<\/b><span>自定义动作<\/span>/);
});

test('skeletons 输出指定数量的 rem 骨架卡片', () => {
  const { skeletons } = createCard();
  assert.equal([...skeletons().matchAll(/class="card skeleton"/g)].length, 5);
  assert.equal([...skeletons(3).matchAll(/class="card skeleton"/g)].length, 3);
  assert.match(skeletons(1), /margin-bottom:\.875rem/);
});
