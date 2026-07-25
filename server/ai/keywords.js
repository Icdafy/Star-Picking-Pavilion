'use strict';
// 关键词判定 —— v0.0.7 起不再自己维护一份词表，全部派生自 config/lexicon.json。
// 之前这里的 LOWALTITUDE / AEROSPACE 数组和词库是两套事实，加了新赛道要改两处，
// 迟早漂移。现在词库是唯一入口，本模块只负责三件判定：
//   ① 领域归属（matchDomain）
//   ② 相关强度（keywordHits / relevanceOf）
//   ③ 噪声形态（isNoise / noiseHits）——噪声不是「哪个领域」的问题，所以留在本地
//
// 双重用途照旧：无 API Key 时做启发式降级判定与打分；有 Key 时做预筛前的粗过滤省 token。
const lexicon = require('./lexicon');

// 噪声形态：命中即扣分（config/scoring.json 的 noisePenalty），命中足够多则直接判无关。
// 两类——
//   A. 股评/炒作形态：主旨是股价而不是产业事件
//   B. 综合汇总打包：即使其中一段提到航天/低空，整篇主旨都不是本领域
const NOISE_PATTERNS = [
  // A. 股评与炒作
  '股吧', '涨停', '跌停', '盘中异动', '异动拉升', '概念股拉升', '概念股异动',
  '游资', '主力资金', '龙虎榜', '北向资金', '融资余额', '主力净流入',
  '尾盘拉升', '集合竞价', '抢筹', '牛股', '妖股', '掘金', '布局良机', '目标价',
  '涨幅居前', '领涨', '封涨停', '连板', '题材股',
  // B. 综合汇总与打包内容
  '四大证券报', '证券报精华', '财经晚报', '财经早报', '头版头条', '重要财经媒体',
  '新闻联播', '早参', '晚参', '盘前必读', '盘后', '复盘', '收评', '午评', '早评',
  '重磅消息一览', '重要事件', '今日要闻', '每日经济新闻', '一周要闻', '每经',
  '早间新闻', '隔夜外盘', '市场早报', '财经日历', '公告精选', '互动易',
  '一图读懂今日', '今日热点汇总',
  // C. 机关党务与礼仪性活动：官方信源（T1）的稳定产出，但对读者不是行业情报。
  //    这类标题往往同时带着「民航局」「航天科技集团」等高权重词，不显式排除就会被
  //    词库判成强相关，再乘上 T1 系数直接冲进精选——实测「党组理论学习中心组举行
  //    集体学习」拿到过 77.6 分。只列党务与礼仪性活动，不列泛化的「会议」，
  //    以免误伤「全国民航工作会议」这类真政策场合。
  '党组理论学习', '理论学习中心组', '党课', '主题教育', '组织生活会', '党史学习',
  '廉政', '巡视整改', '警示教育', '表彰大会', '慰问演出', '党支部', '党建工作',
  '职工代表大会', '文艺汇演', '运动会'
];

// 兼容导出：老代码（和测试）按 LOWALTITUDE / AEROSPACE / NOISE 读词表，
// 现在这三个都是词库的投影，仍然是普通字符串数组。
function surfacesOf(domain) {
  const terms = lexicon.loadLexicon().byDomain[domain] || [];
  return [...new Set(terms.flatMap(term => term.surfaces))];
}

const LOWALTITUDE = surfacesOf('lowaltitude');
const AEROSPACE = surfacesOf('aerospace');
const NOISE = NOISE_PATTERNS;

// 领域归属：'lowaltitude' | 'aerospace' | 'both' | null
// 判定交给词库的加权逻辑，单个泛词（航空、卫星）不足以定性
function matchDomain(text) {
  const summary = lexicon.analyze(text);
  if (!lexicon.isRelevantSummary(summary)) return null;
  return summary.domain;
}

// 命中的词条数量（启发式打分用作强度信号）
function keywordHits(text) {
  return lexicon.analyze(text).count;
}

// 完整的相关性画像：领域、命中词、权重和、噪声数——打分与预筛都从这里取数，
// 一次分析复用，不必在多处重复扫描同一段文本
function relevanceOf(text) {
  const summary = lexicon.analyze(text);
  const noise = noiseHits(text);
  return {
    ...summary,
    noiseHits: noise,
    relevant: lexicon.isRelevantSummary(summary) && noise < 2
  };
}

function noiseHits(text) {
  const haystack = String(text || '');
  let hits = 0;
  for (const pattern of NOISE_PATTERNS) if (haystack.includes(pattern)) hits++;
  return hits;
}

function isNoise(text) {
  return noiseHits(text) > 0;
}

module.exports = {
  LOWALTITUDE, AEROSPACE, NOISE, NOISE_PATTERNS,
  matchDomain, keywordHits, relevanceOf, noiseHits, isNoise
};
