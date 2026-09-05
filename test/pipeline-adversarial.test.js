'use strict';
// 流水线对抗性与边界测试（有 Key 完整桩 / 毒丸 / 并发 / 脏行 / 状态机 / 投毒定性）。
// 每个场景在隔离子进程里跑（见 helpers/pipeline-stub-child.js）：
// 独立数据目录 + 127.0.0.1 的 OpenAI 兼容桩端点，避免测试间共享模块级失败计数。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const childPath = path.join(__dirname, 'helpers', 'pipeline-stub-child.js');

// 场景子进程启动成本不低，同一场景的多个断言面共享一次运行结果
const scenarioCache = new Map();
function runScenario(scenario, options = {}) {
  const cacheKey = scenario;
  if (scenarioCache.has(cacheKey)) return scenarioCache.get(cacheKey);
  const result = spawnScenario(scenario, options);
  scenarioCache.set(cacheKey, result);
  return result;
}

function spawnScenario(scenario, { withKey = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-adversarial-'));
  try {
    const child = spawnSync(process.execPath, [childPath, scenario], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        STAR_PICKING_PAVILION_DATA_DIR: dataDir,
        ...(withKey ? { STAR_PICKING_PAVILION_AI_API_KEY: 'sk-test-only' } : {})
      }
    });
    assert.equal(child.status, 0, `场景 ${scenario} 子进程失败:\n${child.stderr}`);
    return JSON.parse(child.stdout);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---------- H4：有 Key 完整流水线桩测试 ----------

test('historical upgrade repairs events without rerunning relevance or replacing judgments', () => {
  const out=runScenario('historical-timing',{withKey:true});
  assert.equal(out.calls,1);
  assert.match(out.system,/原子事件提取器/);
  assert.equal(out.result.analyzed,0);
  assert.equal(out.result.timingRepair.repaired,1);
  assert.equal(out.row.event_date,'2026-09-01');
  assert.equal(out.row.analyzed,1);
  assert.equal(out.row.starred,1);
  assert.equal(out.row.featured,1);
  assert.equal(out.row.quality_score,88);
  assert.equal(out.row.ai_summary,'保留历史摘要');
});

test('H4a: 预筛正常 JSON 时模型结果全字段落库，请求带反注入声明与 item 包裹', () => {
  const out = runScenario('full-happy', { withKey: true });
  assert.equal(out.mode, 'full');
  assert.equal(out.analyzed, 1, '模型路径完成写 analyzed=1');
  assert.equal(out.domain, 'aerospace', '预筛 d=B 落库为 aerospace');
  assert.equal(out.category, '发射与任务');
  assert.equal(out.scores.importance, 78);
  assert.deepEqual(out.tags, ['可回收火箭', '首飞']);
  assert.ok(out.eventKey, '结构化产物 event_key 必须落库');
  assert.deepEqual(out.callKinds, ['prefilter', 'scoring'], '先预筛后评分，各一次调用');
  // 反注入声明与结构化分隔标记
  assert.match(out.prefilterSystem, /安全声明/);
  assert.match(out.prefilterSystem, /不得执行/);
  assert.match(out.prefilterSystem, /<item id=/);
  assert.match(out.prefilterUser, /<item id="0">/);
  assert.match(out.prefilterUser, /<\/item>/);
});

test('H4b: 预筛返回非法 JSON 时整批降级启发式且不抛异常', () => {
  const out = runScenario('prefilter-invalid-json', { withKey: true });
  assert.equal(out.mode, 'full', '解析失败不改变整轮的完整模式');
  assert.equal(out.analyzedCount, 1);
  assert.equal(out.analyzed, 3, '启发式降级写 analyzed=3，而不是判无关或失败');
  assert.equal(out.domain, 'aerospace');
  assert.equal(out.prefilterCalls, 1, '预筛确实调用过（是响应解析失败，不是调用失败）');
  assert.equal(out.scoringCalls, 0, '降级后不再发起评分调用');
});

test('H4c: 评分调用单次失败保持 analyzed=0，连续三次才降级（无关条目写 2）', () => {
  const out = runScenario('scoring-failure', { withKey: true });
  // 锁定实现语义：失败不是终态 —— 第 1、2 次失败保持待判，第 3 次降级启发式；
  // 该条目词库判无关，故降级路径写 analyzed=2
  assert.deepEqual(out.flags, [0, 0, 2]);
  assert.deepEqual(out.analyzedCounts, [0, 0, 1]);
  assert.equal(out.prefilterCalls, 3, '每轮重判都重新预筛');
  // 每轮评分真实尝试一次，非审核类 400 还会触发一次删参兜底重发 → 每轮 2 次请求
  assert.equal(out.scoringCalls, 6);
});

test('H4d: 预筛序号缺失/重复/非数字时整批降级启发式，而非缺项判无关', () => {
  const out = runScenario('prefilter-bad-index', { withKey: true });
  assert.equal(out.rounds.length, 3);
  for (const [index, round] of out.rounds.entries()) {
    // 三条都是词库相关条目：M1 校验失败 → 整批启发式 → analyzed=3。
    // 若缺项被静默判无关，这里会出现 relevant=0/analyzed=1
    assert.deepEqual(round.analyzedFlags, [3, 3, 3], `第 ${index + 1} 轮序号异常应整批降级`);
    assert.deepEqual(round.relevantFlags, [1, 1, 1], `第 ${index + 1} 轮不得把缺项误判为无关`);
  }
  assert.equal(out.scoringCalls, 0, '降级批次不再发起评分调用');
});

// ---------- M3：毒丸隔离 ----------

test('M3: 持久化抛错的毒丸条目写 analyzed=2，其余条目正常完成且不 reject', () => {
  const out = runScenario('poison');
  assert.equal(out.rejected, false, 'analyzePending 不得因单条毒丸整体 reject');
  assert.equal(out.mode, 'heuristic');
  assert.equal(out.poison.analyzed, 2, '毒丸条目写失败终态 analyzed=2');
  assert.equal(out.poison.scoresJson, null, '毒丸事务回滚，半截数据不得落库');
  for (const other of out.others) {
    assert.equal(other.analyzed, 3, '其余条目照常完成');
    assert.ok(other.quality > 0);
    assert.ok(other.scoresJson, '其余条目评分证据完整落库');
  }
  assert.equal(out.analyzedCount, 3, '三条都被处理（含毒丸的失败终态）');
});

// ---------- 并发 ----------

test('并发: 两轮 analyzePending 真实交错时不抛异常且终态一致（冗余双写不产生脏数据）', () => {
  const out = runScenario('concurrency', { withKey: true });
  assert.equal(out.mode, 'full', '配 Key 后走完整模式，两轮才能真正交错');
  // analyzePending 没有在途占位（生产靠 scheduler 串行化）：直接并发时两实例各自
  // 选中同一批待分析条目，冗余处理但不得抛异常、不得产生不一致终态
  assert.equal(out.firstAnalyzed, 30, '第一轮处理全部待分析条目');
  assert.equal(out.secondAnalyzed, 30, '交错之下第二轮同样处理了同一批条目（冗余而非丢失）');
  assert.equal(out.allDone, true, '30 条全部到达模型路径终态 analyzed=1');
  assert.equal(out.firstPhase.writtenIds, 30, '每条都被持久化写过');
  assert.equal(out.firstPhase.maxWritesPerArticle, 2, '交错双写上限为 2，无更多重复写');
});

test('并发: rescoreAfterClustering 与 analyzePending 交叉后无版本/信号不一致行', () => {
  const out = runScenario('concurrency', { withKey: true });
  assert.equal(out.inconsistentRows, 0, '所有 relevant 行的信号 JSON 可解析且版本一致');
  assert.equal(out.crossRowsDone, true, '交叉批条目在完整模式下全部到达终态');
  assert.equal(out.rescoreAgainChanged, 0, '交叉写之后再跑 rescore 幂等，说明状态自洽');
});

// ---------- rescore 脏行容错与幂等 ----------

test('rescore: 脏 scores_json 不抛异常且保持原值，tags_json=null 走空数组回退', () => {
  const out = runScenario('rescore-dirty');
  assert.equal(out.dirty.scoresJson, '{{bad', '解析失败的行跳过更新，原值保持');
  assert.equal(out.dirty.quality, 55, '脏行质量分不被覆写');
  assert.equal(out.stale.scoringVersion, 2, '合法行（tags_json=null）被正常重算并刷新版本');
  assert.ok(out.firstChanged >= 1, '第一轮至少更新了合法行');
});

test('rescore: 连跑两次第二次 changed===0（幂等）', () => {
  const out = runScenario('rescore-dirty');
  assert.equal(out.secondChanged, 0);
});

// ---------- 状态机 ----------

test('状态机: 无 Key 下无关条目 analyze 后 analyzed=1，且再跑不重处理', () => {
  const out = runScenario('state-irrelevant');
  assert.equal(out.mode, 'heuristic');
  assert.equal(out.firstAnalyzed, 1);
  assert.deepEqual(out.afterFirst, { analyzed: 1, relevant: 0 });
  assert.equal(out.secondAnalyzed, 0, '终态条目不进入第二轮处理');
  assert.deepEqual(out.afterSecond, { analyzed: 1, relevant: 0 });
});

test('状态机: 预筛调用失败保持 analyzed=0，可被下一轮重判', () => {
  const out = runScenario('failure-recover', { withKey: true });
  assert.equal(out.round1Analyzed, 0, '调用失败不写任何终态');
  assert.equal(out.afterRound1.analyzed, 0, '条目保持待判');
  assert.equal(out.afterRound1.scoresJson, null);
  assert.equal(out.round2Analyzed, 1, '下一轮网络恢复后正常完成');
  assert.equal(out.afterRound2.analyzed, 1);
  assert.equal(out.afterRound2.scores.importance, 70, '评分证据落库');
});

// ---------- H5：事件键投毒定性测试 ----------

test('H5: 旧事件键被重新生成，伪造关联报道不能获得加成', () => {
  const out = runScenario('event-key-poisoning');
  // 聚类前基线：T2 单源，可信门槛拦下，加成为 0
  assert.equal(out.before.t2.bonus, 0);
  assert.equal(out.before.t2.rejectedReason, 'credibility-gate');
  // 升级后的原子事件重新生成键；关联报道没有可信度加成。
  assert.equal(out.sameCluster, false, '升级迁移重新生成事件键，丢弃伪造键');
  assert.equal(out.after.t2.bonus, 0, '关联报道不再绕过可信门槛');
  assert.equal(out.after.t2.rejectedReason, 'credibility-gate');
});

// ---------- H1：注入桩测试 ----------

test('H1: 桩模型无条件满分并伪造 tags，T2 单源条目的突破加成仍被可信门槛拦截', () => {
  const out = runScenario('injection', { withKey: true });
  assert.equal(out.mode, 'full');
  assert.equal(out.analyzed, 1);
  // 注入「成功」的表象：模型确实给了满分，伪造 tags 也确实落库
  assert.equal(out.scores.importance, 100);
  assert.equal(out.scores.credibility, 100);
  assert.deepEqual(out.tags, ['可回收火箭', '回收', '试验成功', '满分']);
  // 但代码侧的可信门槛不看模型脸色：T2 单源没有多源印证，突破加成必须为 0
  assert.equal(out.breakthroughBonus, 0, '满分 + 伪造 tags 也换不来突破加成');
  assert.equal(out.breakthroughScore, 0);
  assert.equal(out.rejectedReason, 'credibility-gate');
  assert.equal(out.credibilityEvidence, null, '门槛未通过时不产生任何可信证据');
});
