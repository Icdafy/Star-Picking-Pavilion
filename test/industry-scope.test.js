'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-industry-scope-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase } = require('../server/db');
const { collectSource } = require('../server/collectors');
const rss = require('../server/collectors/rss');
const keywords = require('../server/ai/keywords');
const editorial = require('../server/ai/editorial');
const { startServer } = require('./helpers/server-child');
const { API_TOKEN_HEADER } = require('../server/http-security');

test.after(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });

function source(tier = 'T2', intl = 0) {
  const id = db.prepare("INSERT INTO sources(name,type,url,tier,domain,intl) VALUES('行业边界测试','rss',?,?,'both',?)")
    .run(`https://example.test/feed-${Math.random()}`, tier, intl).lastInsertRowid;
  return db.prepare('SELECT * FROM sources WHERE id=?').get(id);
}

test('普通媒体的综合新闻在入库及正文请求前过滤，两行业动态继续进入待判队列', async t => {
  const original = rss.fetch;
  t.after(() => { rss.fetch = original; });
  const titles = ['全国铁路预计发送旅客2415万人次', '中国科学家绘制水稻全生命周期细胞图谱',
    '商业航天运载火箭完成试车', '低空经济新增无人机物流航线',
    '假期重点速递 | A股回落；券商热议固态电池'];
  rss.fetch = async () => titles.map((title, index) => ({ title, url: `https://example.test/scope-${index}`,
    summary: index === 4 ? '可回收火箭与卫星通信的运力需求持续增长。' : '' }));
  const fetchedBodies = [];
  const row = source();
  const result = await collectSource(row, { collect: { keepDays: 30 }, ai: { apiKey: '' } }, {
    enrich: async article => { fetchedBodies.push(article.url); return { status: 'unavailable' }; }
  });
  assert.equal(result.added, 2);
  assert.equal(result.filtered, 3);
  assert.deepEqual(fetchedBodies.sort(), ['https://example.test/scope-2', 'https://example.test/scope-3']);
  assert.deepEqual(db.prepare('SELECT title,relevant,analyzed FROM articles WHERE source_id=? ORDER BY id').all(row.id)
    .map(article => ({ ...article })), titles.slice(2, 4).map(title => ({ title, relevant: null, analyzed: 0 })));
});

test('官方和海外陌生主体可留给模型判断，信源领域不等于已确认相关', async t => {
  const original = rss.fetch;
  t.after(() => { rss.fetch = original; });
  for (const [tier, intl] of [['T1', 0], ['T2', 1]]) {
    const row = source(tier, intl);
    rss.fetch = async () => [{ title: 'New company completes demonstrator test', url: `https://example.test/unknown-${row.id}` }];
    const result = await collectSource(row, { collect: { keepDays: 30 }, ai: { apiKey: 'test-only-no-call' } }, {
      enrich: async () => ({ status: 'unavailable' })
    });
    assert.equal(result.added, 1);
    assert.equal(db.prepare('SELECT relevant FROM articles WHERE source_id=?').get(row.id).relevant, null);
  }
});

test('综合财经合集不能用检索摘要中的行业片段取得相关性，行业早参正常保留', () => {
  assert.equal(keywords.relevanceOf('假期重点速递 | A股回落；券商热议固态电池 可回收火箭与卫星通信').relevant, false);
  assert.equal(keywords.relevanceOf('长鑫科技量产；商业航天火箭完成发射——《投资早参》').relevant, false);
  assert.equal(keywords.relevanceOf('SpaceX星舰完成试飞｜航天早参').relevant, true);
});

test('英文缩写需要词边界，避免把 POPULAR 和 DISEASES 当作航天公司', () => {
  assert.equal(keywords.relevanceOf('POPULAR NEWS ON DISEASES').relevant, false);
  assert.equal(keywords.relevanceOf('SES signs a satellite contract').relevant, true);
  assert.equal(keywords.relevanceOf('ULA完成商业发射').relevant, true);
  assert.equal(keywords.relevanceOf('千亿航天产业园').relevant, false);
  assert.equal(keywords.relevanceOf('亿航智能获颁适航证书').relevant, true);
  const { buildGuard } = require('../server/collectors/api');
  assert.equal(buildGuard('ULA')({ title: 'POPULAR NEWS ON DISEASES' }), false);
  assert.equal(buildGuard('ULA')({ title: 'ULA完成商业发射' }), true);
});

test('模型 PASS 必须明确给出两行业之一，缺失或非法领域不能沿用信源领域', () => {
  for (const d of [null, undefined, 'C', 'lowaltitude']) {
    assert.throws(() => editorial.normalizePrefilter({ results: [{ i: 0, label: 'PASS', d }] }, 1),
      error => error.parseFailure === true);
  }
  assert.equal(editorial.normalizePrefilter({ results: [{ i: 0, label: 'PASS', d: 'A' }] }, 1)[0].domain, 'lowaltitude');
});

test('旧预筛回执同样校验领域，缺领域 PASS 不能借助缓存绕过新规则', async () => {
  const industry = require('../server/industry');
  const { loadSettings } = require('../server/config');
  const { modelIdentity } = require('../server/ai/model-policy');
  const { receiptKey, buckets } = require('../server/ai/receipts');
  const settings = loadSettings();
  const article = { id: 123456, title: '新主体验证' };
  const key = receiptKey(['prefilter', industry.renderPrompt('prefilter').version,
    modelIdentity(settings), '<item id="0">标题：新主体验证</item>']);
  const bucket = buckets().hour;
  const previous = db.prepare('SELECT calls FROM model_usage WHERE bucket=?').get(bucket);
  db.prepare('INSERT INTO model_usage(bucket,calls) VALUES(?,?) ON CONFLICT(bucket) DO UPDATE SET calls=excluded.calls')
    .run(bucket, industry.loadSelection().budget.maxCallsPerHour);
  const receipt = value => db.prepare(`INSERT INTO model_receipts(receipt_key,task,response_json,created_at)
    VALUES(?,'prefilter',?,?) ON CONFLICT(receipt_key) DO UPDATE SET response_json=excluded.response_json`)
    .run(key, JSON.stringify([value]), new Date().toISOString());
  try {
    receipt({ label: 'PASS', domain: 'aerospace', reason: '行业相关' });
    assert.equal((await editorial.prefilterBatch([article], settings))[0].domain, 'aerospace', '先确认实际请求命中同一条缓存回执');
    for (const domain of [null, 'other']) {
      receipt({ label: 'PASS', domain, reason: '旧版缺失行业' });
      await assert.rejects(editorial.prefilterBatch([article], settings), error => error.budgetExceeded === true,
        '无效缓存不能放行；真实新调用受预算熔断，不会使用网络或真实密钥');
    }
  } finally {
    db.prepare('DELETE FROM model_receipts WHERE receipt_key=?').run(key);
    if (previous) db.prepare('UPDATE model_usage SET calls=? WHERE bucket=?').run(previous.calls, bucket);
    else db.prepare('DELETE FROM model_usage WHERE bucket=?').run(bucket);
  }
});

test('全部动态、领域筛选、词库计数和导出只显示完成判断的两行业资料，星标保留待判原文', async t => {
  const server = await startServer(t);
  const database = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
  const sourceId = database.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('通用媒体','rss','https://example.test/scope-feed','T2','lowaltitude')").run().lastInsertRowid;
  const insert = database.prepare(`INSERT INTO articles(source_id,title,url,summary_raw,published_at,fetched_at,relevant,analyzed,domain,starred,featured)
    VALUES(?,?,?,?,?,?,?,?,?,?,1)`);
  const cases = [
    ['商业航天已确认', 1, 1, 'aerospace', 0], ['低空经济已确认', 1, 3, 'lowaltitude', 0],
    ['商业航天待判混入通用新闻', null, 0, 'lowaltitude', 1], ['商业航天旧版预标相关', 1, 0, 'aerospace', 0],
    ['商业航天判断失败', null, 2, 'aerospace', 0], ['商业航天非法领域', 1, 1, 'other', 0],
    ['商业航天明确无关', 0, 1, 'aerospace', 0]
  ];
  for (const [index, [title, relevant, analyzed, domain, starred]] of cases.entries()) {
    const stamp = new Date(Date.now() + index).toISOString();
    const id = insert.run(sourceId, title, `https://example.test/visibility-${index}`, title, stamp, stamp,
      relevant, analyzed, domain, starred).lastInsertRowid;
    database.prepare('INSERT INTO articles_fts(rowid,title,summary) VALUES(?,?,?)').run(id, title, title);
  }
  database.close();
  const get = async pathname => {
    const response = await server.request({ pathname, headers: { [API_TOKEN_HEADER]: server.token } });
    assert.equal(response.status, 200);
    return JSON.parse(response.body);
  };
  assert.deepEqual((await get('/api/feed?view=all')).items.map(item => item.title), ['低空经济已确认', '商业航天已确认']);
  assert.deepEqual((await get('/api/feed?view=all&domain=aerospace')).items.map(item => item.title), ['商业航天已确认']);
  assert.deepEqual((await get('/api/feed?view=featured')).items.map(item => item.title), ['低空经济已确认', '商业航天已确认']);
  assert.deepEqual((await get('/api/feed?view=starred')).items.map(item => item.title), ['商业航天待判混入通用新闻']);
  const lexicon = await get('/api/lexicon');
  const term = lexicon.groups.flatMap(group => group.terms).find(item => item.term === '商业航天');
  assert.equal(term.count, 1);
  const exported = await get('/api/export?kind=feed&view=all&format=markdown');
  assert.match(exported.content, /商业航天已确认/);
  assert.doesNotMatch(exported.content, /待判|预标|失败|非法|明确无关/);
  const stats = await get('/api/stats');
  assert.equal(stats.relevantToday, 2);
  assert.equal(stats.featuredToday, 2);
});

test('升级复核仅撤回合集和错误启发式，保留星标、原文、有效模型结论并修复事件主条', () => {
  const { repairIndustryScope } = require('../server/ai/relevance-migration');
  const row = source();
  const stamp = new Date().toISOString();
  const add = (title, analyzed, domain, starred = 0) => Number(db.prepare(`INSERT INTO articles
    (source_id,title,url,summary_raw,ai_summary,fetched_at,published_at,relevant,analyzed,domain,starred,featured,quality_score,prefilter_label)
    VALUES(?,?,?,?,?,?,?,1,?,?,?,1,88,'PASS')`).run(row.id, title, `https://example.test/migration-${Math.random()}`,
    '商业航天可回收火箭的新进展', '保留原来的分析摘要', stamp, stamp, analyzed, domain, starred).lastInsertRowid);
  const blocked = add('假期重点速递 | A股回落；券商热议固态电池', 1, 'aerospace', 1);
  const kept = add('商业航天运载火箭完成试车', 1, 'aerospace');
  const heuristic = add('POPULAR NEWS ON DISEASES', 3, 'aerospace');
  const unknown = add('新公司的具体动态', 1, 'aerospace');
  const pending = add('低空经济待处理', 0, 'lowaltitude');
  const invalid = add('商业航天缺失领域', 1, 'other');
  const story = Number(db.prepare(`INSERT INTO clusters(main_article_id,size,updated_at,title,domain,digest,digest_hash,digest_size)
    VALUES(?,2,?,'旧主条','aerospace','旧合集综述','old',2)`).run(blocked, stamp).lastInsertRowid);
  db.prepare('UPDATE articles SET cluster_id=? WHERE id IN (?,?)').run(story, blocked, kept);
  db.prepare(`INSERT INTO story_signals(article_id,story_id,participant_key,observed_at) VALUES(?,?,'bad-publisher',?)`).run(blocked, story, stamp);
  const result = repairIndustryScope();
  assert.deepEqual(result, { blocked: 1, requeued: 3 });
  const withdrawn = db.prepare('SELECT * FROM articles WHERE id=?').get(blocked);
  assert.equal(withdrawn.relevant, 0); assert.equal(withdrawn.featured, 0); assert.equal(withdrawn.starred, 1);
  assert.equal(withdrawn.ai_summary, '保留原来的分析摘要'); assert.equal(withdrawn.summary_raw, '商业航天可回收火箭的新进展');
  assert.equal(withdrawn.cluster_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM story_signals WHERE article_id=?').get(blocked).n, 0);
  const cluster = db.prepare('SELECT * FROM clusters WHERE id=?').get(story);
  assert.equal(cluster.main_article_id, kept); assert.equal(cluster.size, 1); assert.equal(cluster.digest, null);
  for (const id of [heuristic, pending, invalid]) {
    const article = db.prepare('SELECT relevant,analyzed,featured FROM articles WHERE id=?').get(id);
    assert.deepEqual({ ...article }, { relevant: null, analyzed: 0, featured: 0 });
  }
  assert.equal(db.prepare('SELECT relevant FROM articles WHERE id=?').get(unknown).relevant, 1, '合法模型结论不因陌生标题而被词库推翻');
  assert.equal(db.prepare('SELECT relevant FROM articles WHERE id=?').get(kept).relevant, 1);
  assert.deepEqual(repairIndustryScope(), { skipped: true });
  assert.deepEqual(repairIndustryScope({ force: true }), { blocked: 0, requeued: 0 });
});

test('历史复核写入失败时回滚整批，不遗留一半撤回的数据或错误的完成标记', () => {
  const { repairIndustryScope } = require('../server/ai/relevance-migration');
  const row = source();
  const add = title => Number(db.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,relevant,analyzed,domain,featured)
    VALUES(?,?,?, ?,1,1,'aerospace',1)`).run(row.id, title, `https://example.test/rollback-${Math.random()}`, new Date().toISOString()).lastInsertRowid);
  const first = add('假期重点速递 | 固态电池');
  const second = add('周末重点速递 | 大盘观点');
  const marker = db.prepare("SELECT value FROM meta WHERE key='industryScopeV0225'").get().value;
  db.exec(`CREATE TRIGGER fail_scope_repair BEFORE UPDATE ON articles WHEN OLD.id=${second} BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
  try {
    assert.throws(() => repairIndustryScope({ force: true }), /fixture failure/);
    assert.equal(db.prepare('SELECT relevant FROM articles WHERE id=?').get(first).relevant, 1);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='industryScopeV0225'").get().value, marker);
  } finally { db.exec('DROP TRIGGER fail_scope_repair'); }
  assert.deepEqual(repairIndustryScope({ force: true }), { blocked: 2, requeued: 0 });
});
