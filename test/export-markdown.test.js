'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPORT_VERSION, FORMATS, normalizeFormat, escapeMarkdown,
  renderDaily, renderDailyArchive, renderArticles, exportFilename
} = require('../server/export/markdown');

const BRAND = {
  productName: '摘星阁',
  version: '0.0.12',
  homepage: 'https://github.com/Icdafy/Star-Picking-Pavilion'
};

const REPORT = {
  date: '2026-07-25',
  total: 2,
  byDomain: { lowaltitude: 1, aerospace: 1 },
  generatedAt: '2026-07-25T00:05:00.000Z',
  sections: [
    {
      category: '政策法规',
      items: [{
        title: '民航局发布低空空域管理试行办法',
        url: 'https://example.gov.cn/notice/1',
        source_name: '民航局',
        tier: 'T1',
        domain: 'lowaltitude',
        category: '政策法规',
        quality_score: 82.4,
        ai_summary: '办法自下月起施行。',
        ai_reason: '首个全国统一口径的空域管理规则。'
      }]
    },
    {
      category: '发射与任务',
      items: [{
        title: '某型运载火箭完成首飞',
        url: 'https://example.com/launch',
        source_name: '东方财富',
        tier: 'T2',
        domain: 'aerospace',
        quality_score: 71,
        cluster_size: 4
      }]
    }
  ]
};

test('导出格式白名单只认 markdown 与 text，其余一律回落到 markdown', () => {
  assert.equal(EXPORT_VERSION, '0.0.12');
  assert.deepEqual([...FORMATS].sort(), ['markdown', 'text']);
  assert.equal(normalizeFormat('markdown'), 'markdown');
  assert.equal(normalizeFormat('text'), 'text');
  for (const value of ['html', 'pdf', '', null, undefined, 'MARKDOWN']) {
    assert.equal(normalizeFormat(value), 'markdown');
  }
});

test('Markdown 日报保留标题、分组、链接、来源与研判', () => {
  const output = renderDaily(REPORT, { ...BRAND, format: 'markdown' });

  assert.match(output, /^# 摘星阁 · 情报日报 2026-07-25\n/);
  assert.match(output, /> 共 2 条精选 · 低空经济 1 条 · 商业航天 1 条/);
  assert.match(output, /## 政策法规/);
  assert.match(output, /## 发射与任务/);
  assert.match(
    output,
    /1\. \*\*\[民航局发布低空空域管理试行办法\]\(https:\/\/example\.gov\.cn\/notice\/1\)\*\*/
  );
  assert.match(output, /- 民航局（T1） · 低空经济 · 政策法规 · 质量分 82/);
  assert.match(output, /- 研判：首个全国统一口径的空域管理规则。/);
  // 多信源事件簇要在导出里保留「这条被几家报了」的信息
  assert.match(output, /质量分 71 · 4 个信源/);
  assert.match(output, /由 摘星阁 v0\.0\.12 生成 · https:\/\/github\.com\/Icdafy\/Star-Picking-Pavilion/);
});

test('纯文本日报把链接单独成行，不留任何 Markdown 语法', () => {
  const output = renderDaily(REPORT, { ...BRAND, format: 'text' });

  assert.match(output, /^摘星阁 · 情报日报 2026-07-25\n/);
  assert.match(output, /【政策法规】/);
  assert.match(output, /1\. 民航局发布低空空域管理试行办法/);
  assert.match(output, /\n {3}https:\/\/example\.gov\.cn\/notice\/1\n/);
  // 贴进微信群时 **粗体** 和 [标题](链接) 只会变成噪声
  assert.doesNotMatch(output, /\*\*/);
  assert.doesNotMatch(output, /\]\(http/);
  assert.doesNotMatch(output, /^#/m);
});

test('标题里的 Markdown 语法字符被转义，不会把链接和强调撑破', () => {
  const output = renderDaily({
    ...REPORT,
    sections: [{
      category: '企业动态',
      items: [{ title: 'A公司[收购]B公司 *内幕* <script>', url: 'https://example.com/x' }]
    }]
  }, { ...BRAND, format: 'markdown' });

  assert.match(output, /\\\[收购\\\]/);
  assert.match(output, /\\\*内幕\\\*/);
  assert.match(output, /\\<script>/);
  // 转义只针对行内语义字符：日期里的连字符和句点不该被反斜杠污染
  assert.match(output, /情报日报 2026-07-25/);
});

test('非 HTTP(S) 链接不会进入导出内容', () => {
  for (const url of ['javascript:alert(1)', 'file:///C:/secret.txt', 'https://user:pass@example.com/x']) {
    const output = renderArticles([{ title: '可疑条目', url }], { ...BRAND, format: 'text' });
    assert.doesNotMatch(output, /javascript:|file:|user:pass/);
    assert.match(output, /1\. 可疑条目/);
  }
});

test('摘要中的换行与控制字符被压平，一条情报始终占固定行数', () => {
  const output = renderArticles([{
    title: '带\n换行的标题',
    url: 'https://example.com/a',
    summary: '第一行\n第二行\t带制表符\u0007响铃'
  }], { ...BRAND, format: 'text' });

  assert.match(output, /1\. 带 换行的标题/);
  assert.match(output, /第一行 第二行 带制表符 响铃/);
  assert.equal(output.includes('\u0007'), false);
});

test('空日报和空列表给出明确说明而不是一份只有标题的空文档', () => {
  const emptyDaily = renderDaily({ date: '2026-07-25', total: 0, byDomain: {}, sections: [] }, BRAND);
  assert.match(emptyDaily, /该日期没有达到精选阈值的情报。/);
  assert.match(emptyDaily, /共 0 条精选 · 低空经济 0 条 · 商业航天 0 条/);

  const emptyFeed = renderArticles([], { ...BRAND, title: '星标情报' });
  assert.match(emptyFeed, /当前筛选条件下没有情报。/);
  assert.match(emptyFeed, /# 摘星阁 · 星标情报/);
});

test('研究简报同时呈现窗口统计、技术突破和完整行业索引', () => {
  const item = {
    title: '可重复使用火箭完成回收验证',
    url: 'https://example.com/breakthrough',
    sourceName: '官方源',
    sourceTier: 'T1',
    domain: 'aerospace',
    category: '技术研发',
    quality: 88,
    breakthroughBonus: 8,
    aiSummary: '完成关键回收试验。'
  };
  const output = renderDailyArchive({
    date: '2026-07-31',
    window: {
      start: new Date(2026, 6, 30, 8).toISOString(),
      end: new Date(2026, 6, 31, 8).toISOString()
    },
    generatedAt: new Date(2026, 6, 31, 8, 0, 5).toISOString(),
    summary: {
      total: 3,
      relevant: 1,
      featured: 1,
      pending: 1,
      irrelevant: 1,
      breakthroughs: 1,
      byDomain: { lowaltitude: 0, aerospace: 1 }
    },
    readable: {
      hot: [item],
      breakthroughs: [item],
      sections: [{ category: '技术研发', items: [item] }],
      relevantIndex: [item]
    }
  }, BRAND);

  assert.match(output, /^# 摘星阁 · 每日新闻简报 2026-07-31/m);
  assert.match(output, /采集 3 条 · 行业相关 1 条 · 精选 1 条/);
  assert.match(output, /待分析 1 条 · 无关 1 条 · 技术突破 1 条/);
  assert.match(output, /## 当日热点/);
  assert.match(output, /## 可信技术突破/);
  assert.match(output, /## 完整行业索引/);
  assert.match(output, /技术突破 \+8/);
});

test('列表导出带上检索上下文与条数，便于收件人判断口径', () => {
  const output = renderArticles(
    [{ title: '条目一', url: 'https://example.com/1' }, { title: '条目二', url: 'https://example.com/2' }],
    { ...BRAND, title: '全部动态', subtitle: '检索「eVTOL」', exportedAt: new Date(2026, 6, 25, 9, 30) }
  );

  assert.match(output, /> 共 2 条/);
  assert.match(output, /> 检索「eVTOL」/);
  assert.match(output, /> 导出于 2026-07-25 09:30/);
});

test('导出文件名可以直接落到 Windows 磁盘', () => {
  assert.equal(exportFilename('摘星阁-情报日报', '2026-07-25', 'markdown'), '摘星阁-情报日报-2026-07-25.md');
  assert.equal(exportFilename('摘星阁-星标情报', '2026-07-25', 'text'), '摘星阁-星标情报-2026-07-25.txt');
  // Windows 保留字符必须被剔除，否则另存为会直接失败
  assert.equal(exportFilename('a/b\\c:d*e?f"g<h>i|j', '', 'markdown'), 'abcdefghij.md');
  assert.equal(exportFilename('', '', 'markdown'), 'export.md');
});

test('escapeMarkdown 是幂等安全的纯函数，可空可非字符串', () => {
  assert.equal(escapeMarkdown(null), '');
  assert.equal(escapeMarkdown(undefined), '');
  assert.equal(escapeMarkdown(42), '42');
  assert.equal(escapeMarkdown('a*b'), 'a\\*b');
});
