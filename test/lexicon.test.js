'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lexicon = require('../server/ai/lexicon');
const keywords = require('../server/ai/keywords');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'lexicon.json'), 'utf8'));

test('词库覆盖两个领域，且每条都有可匹配的规范词', () => {
  const loaded = lexicon.loadLexicon();
  assert.ok(loaded.groups.length >= 12, '分组数量过少，覆盖不足');
  assert.ok(loaded.terms.length >= 180, '词条数量过少，覆盖不足');
  assert.ok(loaded.byDomain.lowaltitude.length >= 70);
  assert.ok(loaded.byDomain.aerospace.length >= 70);
  for (const term of loaded.terms) {
    assert.ok(term.term.length > 0, '词条缺少规范词');
    assert.ok(term.surfaces.includes(term.term), '匹配面必须包含规范词');
    assert.ok(term.weight >= 0 && term.weight <= 10, `${term.term} 权重越界`);
    assert.ok(['lowaltitude', 'aerospace'].includes(term.domain));
  }
});

test('匹配面按长度倒序，长词优先认领同一段文本', () => {
  const hits = lexicon.matchTerms('低空经济示范区落地');
  const terms = hits.map(hit => hit.term);
  assert.ok(terms.includes('低空经济示范区'));
  // 长词先出现，短词不会抢在前面
  assert.ok(terms.indexOf('低空经济示范区') < terms.indexOf('低空经济'));
});

test('同一词条重复出现只计一次，复读不能刷高权重', () => {
  const once = lexicon.analyze('低空经济');
  const tenTimes = lexicon.analyze('低空经济'.repeat(10));
  assert.equal(once.weightSum, tenTimes.weightSum);
  assert.equal(once.count, tenTimes.count);
});

test('领域判定：定义词与具名主体单独出现即可定性，泛词不行', () => {
  assert.equal(lexicon.analyze('低空经济迎来政策窗口').domain, 'lowaltitude');
  assert.equal(lexicon.analyze('朱雀三号完成静态点火').domain, 'aerospace');
  // 单个具名主体足够：一条新闻的主语是这个赛道的公司，它就是这个赛道的新闻
  assert.equal(lexicon.isRelevantSummary(lexicon.analyze('中国商飞发布新机型')), true);
  assert.equal(lexicon.isRelevantSummary(lexicon.analyze('山河智能发布半年报')), true);
  // 完全无关的内容不能被拉进来
  assert.equal(lexicon.isRelevantSummary(lexicon.analyze('某白酒企业三季报点评')), false);
  assert.equal(lexicon.analyze('某白酒企业三季报点评').domain, null);
});

test('两个领域权重接近时判为跨领域，悬殊时归入较重的一侧', () => {
  assert.equal(lexicon.analyze('卫星互联网赋能低空经济航路规划').domain, 'both');
  assert.equal(lexicon.analyze('朱雀三号首飞成功，蓝箭航天完成一子级垂直回收').domain, 'aerospace');
});

test('keywords 完全派生自词库，不再自带第二份词表', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', 'keywords.js'), 'utf8');
  // 领域词只能来自 lexicon；本文件里除噪声形态外不应再出现硬编码的领域词数组
  assert.match(source, /require\('\.\/lexicon'\)/);
  assert.doesNotMatch(source, /const LOWALTITUDE = \[/);
  assert.doesNotMatch(source, /const AEROSPACE = \[/);
  const lowaltitude = new Set(keywords.LOWALTITUDE);
  for (const term of lexicon.loadLexicon().byDomain.lowaltitude) {
    assert.ok(lowaltitude.has(term.term), `${term.term} 未出现在派生词表中`);
  }
});

test('噪声形态覆盖股评、综合汇总与机关党务三类', () => {
  assert.ok(keywords.noiseHits('四大证券报精华摘要：龙虎榜显示游资抢筹') >= 2);
  assert.ok(keywords.noiseHits('民航局党组理论学习中心组举行集体学习') >= 1);
  assert.equal(keywords.noiseHits('朱雀三号完成静态点火试验'), 0);
});

test('相关性画像把噪声与领域判定合成一次结论', () => {
  // 命中领域词，但整篇是综合财经汇总 —— 不该进情报库
  const packed = keywords.relevanceOf('四大证券报精华摘要：商业航天概念股拉升，龙虎榜现游资身影');
  assert.equal(packed.relevant, false);
  assert.ok(packed.noiseHits >= 2);

  const real = keywords.relevanceOf('亿航智能EH216-S取得运营合格证，低空经济商业化提速');
  assert.equal(real.relevant, true);
  assert.equal(real.domain, 'lowaltitude');
  assert.ok(real.weightSum > 0);
});

test('词库文件本身没有重复的匹配面，命中计数不会被重复归属', () => {
  const seen = new Map();
  for (const group of raw.groups) {
    for (const term of group.terms) {
      for (const surface of [term.t, ...(term.a || [])]) {
        const previous = seen.get(surface);
        assert.equal(previous, undefined,
          `匹配面「${surface}」同时属于 ${previous} 和 ${term.t}`);
        seen.set(surface, term.t);
      }
    }
  }
});

test('检索面板结构保留分组、别名与权重', () => {
  const listed = lexicon.listTerms();
  assert.equal(listed.length, lexicon.loadLexicon().groups.length);
  const first = listed[0];
  assert.ok(first.id && first.label && first.domain);
  assert.ok(Array.isArray(first.terms) && first.terms.length > 0);
  assert.ok(Object.hasOwn(first.terms[0], 'aliases'));
  assert.ok(Object.hasOwn(first.terms[0], 'weight'));
});
