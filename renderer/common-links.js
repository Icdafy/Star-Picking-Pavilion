'use strict';

(function exposeCommonLinks(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CommonLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCommonLinks() {
  const ALL_CATEGORY = '全部';
  const STORAGE_KEY = 'star-picking-pavilion.common-links.favorites';
  const LEGACY_STORAGE_KEYS = Object.freeze(['zxg-common-links-favorites']);
  const rawLinks = [
    {
      id: 'key-work-progress',
      name: '重点工作推进情况',
      url: 'https://kdocs.cn/l/cdynqdek9Grz',
      category: '督办计划',
      description: '查看重点工作进展、阶段性推进情况和需要持续跟进的事项。',
      tags: ['重点工作', '推进情况', '跟踪'],
      pinned: true
    },
    {
      id: 'work-plan',
      name: '工作计划',
      url: 'https://www.kdocs.cn/l/ceLNYZKEnfVt',
      category: '督办计划',
      description: '汇总日常工作安排、计划事项和后续执行节点。',
      tags: ['计划', '安排', '节点'],
      pinned: true
    },
    {
      id: 'travel-memo',
      name: '外出备忘',
      url: 'https://www.kdocs.cn/l/cf4eyjJHmZdN',
      category: '督办计划',
      description: '记录外出事项、行程提醒和临时备忘内容。',
      tags: ['外出', '备忘', '提醒'],
      pinned: false
    },
    {
      id: 'industrial-investment-project-library',
      name: '产投项目库',
      url: 'https://www.kdocs.cn/ent/618840529/3001739888',
      category: '项目投资',
      description: '进入产投项目资料库，集中查看项目相关文档和信息。',
      tags: ['产投', '项目库', '资料'],
      pinned: true
    },
    {
      id: 'industrial-investment-project-excel',
      name: '产投项目Excel',
      url: 'https://www.kdocs.cn/l/cscKdxg3exuL',
      category: '项目投资',
      description: '打开产投项目台账表格，查看或维护项目清单数据。',
      tags: ['产投', 'Excel', '台账'],
      pinned: true
    },
    {
      id: 'fund-project-excel',
      name: '基金项目Excel',
      url: 'https://www.kdocs.cn/l/ch0RuMujDMQL',
      category: '项目投资',
      description: '打开基金项目台账表格，查看或维护基金项目数据。',
      tags: ['基金', 'Excel', '项目'],
      pinned: false
    },
    {
      id: 'invoice-verification',
      name: '发票查验',
      url: 'https://inv-veri.chinatax.gov.cn/index.html',
      category: '财税办公',
      description: '进入国家税务总局发票查验平台；如页面打不开，可在空白处输入 thisisunsafe 后回车。',
      tags: ['发票', '查验', '税务'],
      pinned: true
    },
    {
      id: 'qichacha',
      name: '企查查',
      url: 'https://www.qcc.com/',
      category: '综合办公',
      description: '进入企查查，查询企业工商信息、股权结构和经营风险。',
      tags: ['企查查', '企业查询', '工商信息'],
      pinned: true
    },
    {
      id: 'chengjian-oa',
      name: '城建OA',
      url: 'http://121.37.86.182:8088/seeyon/main.do?method=index',
      category: '综合办公',
      description: '进入城建 OA 办公系统，处理流程审批和日常办公事项。',
      tags: ['OA', '审批', '办公'],
      pinned: true
    },
    {
      id: 'seal-use-records',
      name: '印鉴使用记录表',
      url: 'https://f.kdocs.cn/g/GLu4FEL9/',
      category: '合同印鉴',
      description: '登记和查看印鉴使用记录，便于流程留痕和后续核对。',
      tags: ['印鉴', '使用记录', '登记表'],
      pinned: true
    },
    {
      id: 'contract-filing-records',
      name: '合同备案记录表',
      url: 'https://f.kdocs.cn/g/QfgmT3M7/',
      category: '合同印鉴',
      description: '登记和查看合同备案记录，集中维护合同备案台账。',
      tags: ['合同', '备案', '记录表'],
      pinned: true
    },
    {
      id: 'kimi-ai',
      name: 'Kimi',
      url: 'https://www.kimi.com/agent?chat_enter_method=change_model',
      category: 'AI',
      description: '进入 Kimi，处理长文阅读、资料梳理和中文对话任务。',
      tags: ['Kimi', 'AI', '长文'],
      pinned: true
    },
    {
      id: 'doubao-ai',
      name: '豆包',
      url: 'https://www.doubao.com/chat',
      category: 'AI',
      description: '进入豆包，进行日常问答、内容生成和办公辅助。',
      tags: ['豆包', 'AI', '问答'],
      pinned: true
    },
    {
      id: 'yuanbao-ai',
      name: '元宝',
      url: 'https://yuanbao.tencent.com/chat/naQivTmsDa?yb_channel=3009&yb_dl=js',
      category: 'AI',
      description: '进入腾讯元宝，进行 AI 对话、搜索和资料整理。',
      tags: ['元宝', 'AI', '腾讯'],
      pinned: true
    }
  ];
  const LINKS = Object.freeze(rawLinks.map(item => Object.freeze({
    ...item,
    tags: Object.freeze([...item.tags])
  })));

  function getCategories(links = LINKS) {
    return [ALL_CATEGORY, ...new Set(links.map(item => item.category))];
  }

  function getDefaultFavoriteIds(links = LINKS) {
    return new Set(links.filter(item => item.pinned).map(item => item.id));
  }

  function isValidFavoriteStorage(serialized) {
    if (serialized == null) return false;
    try {
      return Array.isArray(JSON.parse(serialized));
    } catch {
      return false;
    }
  }

  function parseFavoriteIds(serialized, links = LINKS) {
    const fallback = () => getDefaultFavoriteIds(links);
    if (serialized == null) return fallback();
    try {
      const value = JSON.parse(serialized);
      if (!Array.isArray(value)) return fallback();
      const validIds = new Set(links.map(item => item.id));
      return new Set(value.filter(id => typeof id === 'string' && validIds.has(id)));
    } catch {
      return fallback();
    }
  }

  function filterAndSortLinks({ category = ALL_CATEGORY, favoriteIds = new Set(), links = LINKS } = {}) {
    return links
      .map((item, order) => ({ ...item, order, isFavorite: favoriteIds.has(item.id) }))
      .filter(item => category === ALL_CATEGORY || item.category === category)
      .sort((a, b) => a.isFavorite === b.isFavorite ? a.order - b.order : a.isFavorite ? -1 : 1);
  }

  return Object.freeze({
    ALL_CATEGORY,
    STORAGE_KEY,
    LEGACY_STORAGE_KEYS,
    LINKS,
    getCategories,
    getDefaultFavoriteIds,
    isValidFavoriteStorage,
    parseFavoriteIds,
    filterAndSortLinks
  });
});
