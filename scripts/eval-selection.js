'use strict';
// 精选校准（AIHOT SelectBench 的桌面版）：用你自己标注的样本检验评分标准与门槛。
//
//   node scripts/eval-selection.js --gold data/gold.jsonl [--split development|holdout|all] [--n 200] [--label 第一版]
//
// 每行一条样本（字段同 AIHOT，示例见 config/industry/gold.example.jsonl）：
//   {"caseId":"la-001","material":{"title":"…","publishedAt":"…","sourceName":"…","bodyZh":"…"},
//    "sourceFacts":{"sourceTier":"T2"},"samplingContext":{"benchmarkSplit":"development","samplingStratum":"融资"},
//    "gold":{"decision":"select|reject|either"}}
// 对每条跑一次预筛与两次独立评分（与线上同一套提示词与模型），输出：
//   · 按当前分级门槛的准确率、查准率、查全率
//   · 门槛从 40 到 90 每隔 2 分各自的结果（看整体偏松还是偏紧）
//   · 判错的条目与五轴、内容类型，按 samplingStratum 分组
// 报告写到 <数据目录>/eval/。同样的输入与提示词再跑不会重复付费（回执复用）。
// 需要 API Key：环境变量 STAR_PICKING_PAVILION_AI_API_KEY，或在已配置密钥的桌面端数据目录下运行。
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { split: 'development', n: 200, label: '' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--gold') { args.gold = value; i++; }
    else if (key === '--split') { args.split = value; i++; }
    else if (key === '--n') { args.n = Number(value); i++; }
    else if (key === '--label') { args.label = value; i++; }
    else if (key === '--help' || key === '-h') args.help = true;
  }
  return args;
}

function readGold(file) {
  const cases = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`第 ${index + 1} 行不是合法 JSON`); }
    if (!row?.caseId || !row?.material?.title || !['select', 'reject', 'either'].includes(row?.gold?.decision)) {
      throw new Error(`第 ${index + 1} 行缺少 caseId、material.title 或 gold.decision`);
    }
    cases.push(row);
  });
  return cases;
}

function asArticle(row, index) {
  const m = row.material;
  return {
    id: -(index + 1),
    title: m.title,
    summary_raw: m.summary || '',
    content_text: m.bodyZh || m.bodyOriginal || '',
    published_at: m.publishedAt || null,
    source_name: m.sourceName || '',
    tier: row.sourceFacts?.sourceTier || 'T2'
  };
}

function metrics(results, decide) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of results) {
    if (r.gold === 'either') continue;
    const picked = decide(r);
    if (picked && r.gold === 'select') tp++;
    else if (picked) fp++;
    else if (r.gold === 'select') fn++;
    else tn++;
  }
  const total = tp + fp + fn + tn;
  const ratio = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
  return { total, tp, fp, fn, tn, accuracy: ratio(tp + tn, total), precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.gold) {
    console.log('用法：node scripts/eval-selection.js --gold <样本.jsonl> [--split development|holdout|all] [--n 200] [--label 说明]');
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  const { loadSettings } = require('../server/config');
  const { DATA_DIR } = require('../server/db');
  const industry = require('../server/industry');
  const editorial = require('../server/ai/editorial');
  const settings = loadSettings();
  if (!settings.ai.apiKey) throw new Error('没有可用的 API Key：设置环境变量 STAR_PICKING_PAVILION_AI_API_KEY 后重试');

  const cases = readGold(path.resolve(args.gold))
    .filter(row => args.split === 'all' || (row.samplingContext?.benchmarkSplit || 'development') === args.split)
    .slice(0, Math.max(1, args.n || 200));
  if (!cases.length) throw new Error(`样本集中没有 split=${args.split} 的条目`);
  const selection = industry.loadSelection();
  const results = [];
  for (const [index, row] of cases.entries()) {
    const article = asArticle(row, index);
    const [pre] = await editorial.prefilterBatch([article], settings);
    let passA = null;
    let passB = null;
    if (pre.label !== 'BLOCK') {
      [passA, passB] = await Promise.all([editorial.scorePass(article, 1, settings), editorial.scorePass(article, 2, settings)]);
    }
    const decision = passA ? editorial.decideSelection({ scoreA: passA.score, scoreB: passB.score, tier: article.tier }, selection) : null;
    results.push({
      caseId: row.caseId,
      stratum: row.samplingContext?.samplingStratum || '未分组',
      tier: article.tier,
      title: article.title,
      gold: row.gold.decision,
      prefilter: pre.label,
      itemType: passA?.itemType || null,
      scores: passA ? [passA.score, passB.score] : null,
      axes: passA ? [passA.axes, passB.axes] : null,
      average: decision?.attention ?? null,
      threshold: decision?.threshold ?? null,
      selected: Boolean(decision?.selected)
    });
    process.stdout.write(`\r已评 ${index + 1}/${cases.length}`);
  }
  process.stdout.write('\n');

  const current = metrics(results, r => r.selected);
  const sweep = [];
  for (let threshold = 40; threshold <= 90; threshold += 2) {
    sweep.push({ threshold, ...metrics(results, r => Boolean(r.scores) && r.scores[0] + r.scores[1] >= 2 * threshold) });
  }
  const errors = results.filter(r => r.gold !== 'either' && r.selected !== (r.gold === 'select'));
  const byStratum = {};
  for (const r of results) {
    const entry = byStratum[r.stratum] || (byStratum[r.stratum] = { total: 0, wrong: 0 });
    entry.total++;
    if (errors.includes(r)) entry.wrong++;
  }
  const prompts = ['prefilter', 'selection-score'].map(name => `${name}@${industry.renderPrompt(name).version}`);
  const report = { label: args.label, at: new Date().toISOString(), split: args.split, prompts, thresholds: selection.thresholds, current, sweep, byStratum, errors, results };

  const outDir = path.join(DATA_DIR, 'eval');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.at.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, `selection-${stamp}.json`), JSON.stringify(report, null, 2));
  const lines = [
    `# 精选校准 ${args.label || ''}`.trim(), '',
    `- 样本：${results.length} 条（split=${args.split}）；提示词：${prompts.join('、')}`,
    `- 当前门槛 ${JSON.stringify(selection.thresholds)}：准确率 ${current.accuracy}% · 查准率 ${current.precision}% · 查全率 ${current.recall}%`, '',
    '| 统一门槛 | 准确率 | 查准率 | 查全率 | 选中 |', '|---:|---:|---:|---:|---:|',
    ...sweep.map(s => `| ${s.threshold} | ${s.accuracy ?? '–'} | ${s.precision ?? '–'} | ${s.recall ?? '–'} | ${s.tp + s.fp} |`), '',
    '## 判错条目', '',
    ...errors.map(e => `- [${e.gold === 'select' ? '漏选' : '误选'}] ${e.caseId} · ${e.stratum} · ${e.tier} · ${e.itemType || e.prefilter} · ${e.scores ? e.scores.join('/') : '预筛拦下'} · ${e.title}`)
  ];
  fs.writeFileSync(path.join(outDir, `selection-${stamp}.md`), `${lines.join('\n')}\n`);
  console.log(lines.slice(0, 5).join('\n'));
  console.log(`完整报告：${path.join(outDir, `selection-${stamp}.md`)}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`校准失败：${error.message}`);
    process.exitCode = 1;
  }).finally(() => {
    try { require('../server/db').closeDatabase(); } catch {}
  });
}

module.exports = { parseArgs, readGold, metrics };
