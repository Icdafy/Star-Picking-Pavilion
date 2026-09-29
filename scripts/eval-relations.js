'use strict';
// 事件关系校准（AIHOT 885b736「pairwise event-relation evaluation harness」的桌面版）：
// 用你自己标注的报道对，检验归组三分类（同一件事 / 后续进展 / 两件事）与合并置信度门槛。
//
//   node scripts/eval-relations.js --gold data/relation-gold.jsonl [--split development|holdout|all] [--n 200] [--seed 7]
//                                  [--thresholds 0.6,0.75,0.85] [--label 第一版]
//
// 每行一对报道（字段同 AIHOT，示例见 config/industry/relation-gold.example.jsonl）：
//   {"caseId":"…","a":{"title":"…","source":"…","publishedAt":"…","summary":"…"},"b":{…},
//    "samplingContext":{"benchmarkSplit":"development","samplingStratum":"同轮融资"},"gold":{"relation":"SAME_OCCURRENCE"}}
// gold.relation 接受 AIHOT 四分类（SAME_OCCURRENCE / SAME_STORY / UNRELATED / ROUNDUP），
// 也接受本地三分类（same / development / different）；汇总到本地三分类计分，ROUNDUP 视为 different。
// 与线上同一套 group-pair 提示词与模型，走回执与预算：同样的输入与提示词再跑不重复付费。
// 输出：3×3 混淆矩阵、每类查准/查全/F1、准确率与 macro-F1，以及各置信度门槛下“合并与否”的二分类结果。
// 报告写到 <数据目录>/eval/。需要 API Key：环境变量 STAR_PICKING_PAVILION_AI_API_KEY，或在已配置密钥的桌面端数据目录下运行。
const fs = require('node:fs');
const path = require('node:path');

const RELATIONS = Object.freeze(['same', 'development', 'different']);
const GOLD_MAP = Object.freeze({
  SAME_OCCURRENCE: 'same', SAME_STORY: 'development', UNRELATED: 'different', ROUNDUP: 'different',
  same: 'same', development: 'development', different: 'different'
});

function parseArgs(argv) {
  const args = { split: 'all', n: 200, seed: 7, thresholds: [0.6, 0.75, 0.85], label: '' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--gold') { args.gold = value; i++; }
    else if (key === '--split') { args.split = value; i++; }
    else if (key === '--n') { args.n = Number(value); i++; }
    else if (key === '--seed') { args.seed = Number(value); i++; }
    else if (key === '--thresholds') { args.thresholds = String(value).split(',').map(Number).filter(v => v >= 0 && v <= 1); i++; }
    else if (key === '--label') { args.label = value; i++; }
    else if (key === '--help' || key === '-h') args.help = true;
  }
  return args;
}

function report(value, line, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`第 ${line} 行：${field} 必须是对象`);
  if (typeof value.title !== 'string' || !value.title.trim()) throw new Error(`第 ${line} 行：${field}.title 不能为空`);
  if (value.publishedAt != null && !Number.isFinite(Date.parse(value.publishedAt))) throw new Error(`第 ${line} 行：${field}.publishedAt 不是有效时间`);
  return { title: value.title.trim(), source: String(value.source || ''), publishedAt: value.publishedAt || null, summary: String(value.summary || '') };
}

function parseGold(text) {
  const rows = [];
  const ids = new Set();
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim() || raw.trim().startsWith('//')) return;
    let row;
    try { row = JSON.parse(raw); } catch { throw new Error(`第 ${line} 行不是合法 JSON`); }
    if (typeof row?.caseId !== 'string' || !row.caseId.trim()) throw new Error(`第 ${line} 行缺少 caseId`);
    if (ids.has(row.caseId)) throw new Error(`第 ${line} 行 caseId 重复：${row.caseId}`);
    ids.add(row.caseId);
    const relation = GOLD_MAP[row?.gold?.relation];
    if (!relation) throw new Error(`第 ${line} 行 gold.relation 须为 ${Object.keys(GOLD_MAP).join(' / ')}`);
    rows.push({
      caseId: row.caseId,
      a: report(row.a, line, 'a'),
      b: report(row.b, line, 'b'),
      split: row.samplingContext?.benchmarkSplit || 'development',
      stratum: row.samplingContext?.samplingStratum || '未分组',
      gold: relation
    });
  });
  return rows;
}

// 确定性抽样：同一 seed 抽到同一批，方便前后两版提示词对照
function sample(rows, { split = 'all', n = rows.length, seed = 7 } = {}) {
  let state = seed >>> 0;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return (split === 'all' ? rows : rows.filter(r => r.split === split))
    .map(row => ({ row, key: rand() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, Math.max(0, n))
    .map(({ row }) => row);
}

const round = value => Number(value.toFixed(3));

function relationMetrics(predictions, totalCases = predictions.length) {
  const matrix = Object.fromEntries(RELATIONS.map(g => [g, Object.fromEntries(RELATIONS.map(p => [p, 0]))]));
  for (const p of predictions) matrix[p.gold][p.relation]++;
  const perClass = Object.fromEntries(RELATIONS.map(relation => {
    const tp = matrix[relation][relation];
    const fp = RELATIONS.filter(g => g !== relation).reduce((sum, g) => sum + matrix[g][relation], 0);
    const support = RELATIONS.reduce((sum, p) => sum + matrix[relation][p], 0);
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, support);
    const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
    return [relation, { precision: round(precision), recall: round(recall), f1: round(f1), support }];
  }));
  const correct = RELATIONS.reduce((sum, r) => sum + matrix[r][r], 0);
  return {
    sampleSize: totalCases,
    evaluated: predictions.length,
    errors: Math.max(0, totalCases - predictions.length),
    accuracy: round(correct / Math.max(1, predictions.length)),
    macroF1: round(RELATIONS.reduce((sum, r) => sum + perClass[r].f1, 0) / RELATIONS.length),
    confusionMatrix: matrix,
    perClass
  };
}

// “是否并入同一事件”：same 与 development 都会并入，置信度须达到门槛
function mergeMetrics(predictions, threshold) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of predictions) {
    const gold = p.gold !== 'different';
    const merged = p.relation !== 'different' && p.confidence >= threshold;
    if (merged && gold) tp++; else if (merged) fp++; else if (gold) fn++; else tn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return { threshold, tp, fp, fn, tn, precision: round(precision), recall: round(recall),
    f1: round((2 * precision * recall) / Math.max(1e-9, precision + recall)), accuracy: round((tp + tn) / Math.max(1, tp + fp + fn + tn)) };
}

function asDoc(r) {
  return { title: r.title, summary: r.summary, eventText: '', eventDate: r.publishedAt ? r.publishedAt.slice(0, 10) : null };
}

// judgePair 可注入（测试用本地替身）；默认调用线上归组判断，回执与预算照常生效
async function evaluate(rows, { judgePair, concurrency = 4 } = {}) {
  const predictions = [];
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        const verdict = await judgePair(asDoc(row.b), asDoc(row.a));
        predictions.push({ caseId: row.caseId, stratum: row.stratum, gold: row.gold, relation: verdict.relation, confidence: verdict.confidence });
      } catch (error) {
        failures.push({ caseId: row.caseId, error: String(error.message || error).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, worker));
  const order = new Map(rows.map((r, i) => [r.caseId, i]));
  predictions.sort((a, b) => order.get(a.caseId) - order.get(b.caseId));
  return { predictions, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.gold) {
    console.log('用法：node scripts/eval-relations.js --gold <报道对.jsonl> [--split development|holdout|all] [--n 200] [--seed 7] [--thresholds 0.6,0.75,0.85] [--label 说明]');
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  const { loadSettings } = require('../server/config');
  const { DATA_DIR } = require('../server/db');
  const industry = require('../server/industry');
  const { judge } = require('../server/ai/stories');
  const settings = loadSettings();
  if (!settings.ai.apiKey) throw new Error('没有可用的 API Key：设置环境变量 STAR_PICKING_PAVILION_AI_API_KEY 后重试');
  const rows = sample(parseGold(fs.readFileSync(path.resolve(args.gold), 'utf8')), args);
  if (!rows.length) throw new Error(`样本集中没有 split=${args.split} 的条目`);
  const { predictions, failures } = await evaluate(rows, {
    judgePair: async (doc, other) => (await judge(doc, [{ evidence: other }], settings))[0]
  });
  const metrics = relationMetrics(predictions, rows.length);
  const merge = args.thresholds.map(t => mergeMetrics(predictions, t));
  const prompt = `group-pair@${industry.renderPrompt('group-pair').version}`;
  const at = new Date().toISOString();
  const out = { label: args.label, at, split: args.split, seed: args.seed, prompt, metrics, merge, failures, predictions };
  const outDir = path.join(DATA_DIR, 'eval');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = at.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, `relations-${stamp}.json`), JSON.stringify(out, null, 2));
  const lines = [
    `# 事件关系校准 ${args.label || ''}`.trim(), '',
    `- 样本：${rows.length} 对（split=${args.split}，seed=${args.seed}）；提示词：${prompt}；失败 ${failures.length}`,
    `- 准确率 ${metrics.accuracy} · macro-F1 ${metrics.macroF1}`, '',
    '| 真实 \\ 预测 | same | development | different |', '|---|---:|---:|---:|',
    ...RELATIONS.map(g => `| ${g} | ${RELATIONS.map(p => metrics.confusionMatrix[g][p]).join(' | ')} |`), '',
    '| 合并门槛 | 查准 | 查全 | F1 | 准确率 |', '|---:|---:|---:|---:|---:|',
    ...merge.map(m => `| ${m.threshold} | ${m.precision} | ${m.recall} | ${m.f1} | ${m.accuracy} |`)
  ];
  fs.writeFileSync(path.join(outDir, `relations-${stamp}.md`), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  console.log(`完整报告：${path.join(outDir, `relations-${stamp}.md`)}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`校准失败：${error.message}`);
    process.exitCode = 1;
  }).finally(() => {
    try { require('../server/db').closeDatabase(); } catch {}
  });
}

module.exports = { RELATIONS, GOLD_MAP, parseArgs, parseGold, sample, relationMetrics, mergeMetrics, evaluate };
