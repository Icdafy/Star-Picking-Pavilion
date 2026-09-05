'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { fetchPage, publicFetch } = require('../server/collectors/public-web');
const { normalizeEvents } = require('../server/ai/events');
const { timingFields, resolveEventDate } = require('../server/ai/event-time');
const { repairTiming } = require('../server/ai/timing-repair');
const { extractContent, isAccessChallenge } = require('../server/collectors/article-content');

test('comment captcha scripts do not block a readable article; real verification still stops', () => {
  const html='<title>卫星新闻</title><nav>旧闻9月1日</nav><div id="ContentBody"><p>9月4日，宣布正式授权运营。</p><p>新的安排。</p></div><script src="/captcha/scripts/em_capt.js"></script>';
  assert.equal(isAccessChallenge(html),false);
  const content=extractContent(html,'https://news.example/a');
  assert.doesNotMatch(content.text,/旧闻/);
  assert.match(content.text,/安排/);
  assert.match(content.text,/\n/);
  for(const body of ['请完成验证','环境异常','Verify you are human']) assert.equal(isAccessChallenge(`<body>${body}</body>`),true);
});

function timing(quote, raw = {}, article = {}) {
  const row = {title:'蓝箭航天朱雀三号发射',summary_raw:quote,published_at:'2026-09-05T00:00:00Z',...article};
  const events = normalizeEvents([{a:'蓝箭航天',v:'发射成功',o:'朱雀三号',evidence:quote,...raw}],{article:row});
  return {events, ...timingFields({...row,events_json:JSON.stringify(events)})};
}
test('date missing and completion known remain independent of publication', () => {
  const fields = timing('近日，蓝箭航天朱雀三号发射成功。');
  assert.equal(fields.eventStatus,'completed');
  assert.equal(fields.timingReason,'imprecise-date');
  assert.ok(fields.reportedAt);
  assert.equal(fields.reportDelayDays,null);
  assert.equal(timingFields({published_at:'2026-09-05',events_json:'[]'}).timingReason,'missing-event');
  assert.equal(timing('蓝箭航天朱雀三号发射成功。',{}, {content_status:'正文跳转失败',content_text:''}).timingReason,'content-unavailable');
});
test('unique original date can be recovered when the model omits its time field', () => {
  assert.equal(timing('2026年9月1日，蓝箭航天朱雀三号发射成功。').reportDelayDays,4);
  const f=timing('2026年9月1日，蓝箭航天朱雀三号发射成功。',{}, {published_at:null});
  assert.equal(f.eventDate,'2026-09-01');
  assert.equal(f.timingReason,'missing-publication');
  assert.equal(f.reportDelayDays,null);
});
test('adjacent date-only context is accepted but a background event cannot lend its date', () => {
  assert.equal(timing('2026年9月1日。蓝箭航天朱雀三号发射成功。').reportDelayDays,4);
  const wrong=timing('2026年9月1日，另一家公司完成试验。蓝箭航天朱雀三号发射成功。');
  assert.equal(wrong.reportDelayDays,null);
  assert.equal(wrong.timingReason,'event-mismatch');
  assert.equal(timing('2026年9月1日，蓝箭航天朱雀二号发射成功；近日，蓝箭航天朱雀三号发射成功。').timingReason,'event-mismatch');
  assert.equal(timing('2026年9月1日，蓝箭航天朱雀三号发射成功；2026年9月3日再次发射成功。').timingReason,'ambiguous-date');
});
test('future month-day is not silently moved back a year; new-year rollover still works', () => {
  assert.equal(resolveEventDate('9月9日','2026-09-05T00:00:00Z'),'2026-09-09');
  assert.equal(timing('9月9日，蓝箭航天朱雀三号发射成功。').timingReason,'future-date');
  assert.equal(resolveEventDate('12月30日','2026-01-02T00:00:00Z'),'2025-12-30');
});
test('postponement is distinct from a plan and never becomes a completed launch', () => {
  assert.equal(timing('蓝箭航天朱雀三号发射延期。',{v:'发射延期'}).timingStatus,'postponed');
  assert.equal(timing('蓝箭航天计划发射朱雀三号。',{v:'计划发射'}).timingStatus,'planned');
  assert.equal(timing('蓝箭航天朱雀三号发射失败，后续试验延期。',{v:'发射失败'}).eventStatus,'failed');
});
test('whitespace normalization does not accept rewritten or stitched evidence', () => {
  assert.equal(timing('2026年9月1日，蓝箭航天\n朱雀三号发射成功。',{evidence:'2026年9月1日，蓝箭航天 朱雀三号发射成功。'}).reportDelayDays,4);
  assert.equal(timing('2026年9月1日，蓝箭航天朱雀三号发射成功。',{evidence:'2026年9月1日，蓝箭航天朱雀三号圆满发射成功。'}).timingReason,'missing-evidence');
});

test('HTTP to HTTPS and cross-host redirects check each destination robots before fetching content', async () => {
  const seen=[];
  const pages={
    'http://news.example/robots.txt':new Response('User-agent: *\nDisallow: /private'),
    'http://news.example/a':new Response('',{status:301,headers:{location:'https://www.example/a'}}),
    'https://www.example/robots.txt':new Response('User-agent: *\nDisallow: /private'),
    'https://www.example/a':new Response('<article>完成首飞</article>')
  };
  const result=await fetchPage('http://news.example/a',{cache:new Map(),withUrl:true,fetchImpl:async url=>{seen.push(url);return pages[url];}});
  assert.equal(result.url,'https://www.example/a');
  assert.match(result.html,/完成首飞/);
  assert.deepEqual(seen,Object.keys(pages));
});
test('redirect target disallow and robots failures stop before target content', async () => {
  for (const status of [200,403,500]) {
    const seen=[];
    await assert.rejects(fetchPage('https://a.example/a',{cache:new Map(),fetchImpl:async url=>{
      seen.push(url);
      if(url==='https://a.example/robots.txt') return new Response('');
      if(url==='https://a.example/a') return new Response('',{status:302,headers:{location:'https://b.example/private'}});
      if(url==='https://b.example/robots.txt') return new Response('User-agent: *\nDisallow: /private',{status});
      throw Error('must not fetch target');
    }}),/抓取规则|HTTP/);
    assert.ok(!seen.includes('https://b.example/private'));
  }
});
test('an asynchronous redirect denial is awaited and private targets remain blocked', async () => {
  let calls=0;
  await assert.rejects(publicFetch('https://a.example/a',{allowRedirect:async()=>false,fetchImpl:async()=>{
    calls++;return new Response('',{status:302,headers:{location:'https://b.example/a'}});
  }}),/抓取规则/);
  assert.equal(calls,1);
  await assert.rejects(fetchPage('https://a.example/a',{cache:new Map(),fetchImpl:async url=>url.endsWith('/robots.txt')?new Response(''):new Response('',{status:302,headers:{location:'http://127.0.0.1/'}})}),/公开/);
});

function repairDb() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE articles(id INTEGER PRIMARY KEY,title TEXT,summary_raw TEXT,content_text TEXT,content_status TEXT,
    published_at TEXT,fetched_at TEXT,events_json TEXT,event_key TEXT,event_date TEXT,event_schema_version INTEGER DEFAULT 2,
    analyzed INTEGER DEFAULT 1,relevant INTEGER DEFAULT 1,starred INTEGER DEFAULT 0,featured INTEGER DEFAULT 0,
    quality_score INTEGER DEFAULT 88,ai_summary TEXT DEFAULT '保留摘要',
    timing_repair_version INTEGER DEFAULT 0,timing_repair_attempts INTEGER DEFAULT 0,timing_repair_at TEXT,timing_repair_error TEXT)`);
  return db;
}
const evidence='2026年9月1日，蓝箭航天朱雀三号发射成功。';
const raw=[{a:'蓝箭航天',v:'发射成功',o:'朱雀三号',evidence}];
test('bounded repair prefers stars, fetches missing content, keeps judgments and is idempotent', async () => {
  const db=repairDb();
  try {
    db.exec(`INSERT INTO articles(id,title,fetched_at,starred) VALUES(1,'蓝箭航天朱雀三号发射',datetime('now'),1),(2,'蓝箭航天朱雀三号发射',datetime('now'),0)`);
    const seen=[];
    const opts={hasKey:true,limit:1,enrich:async r=>{seen.push(r.id);return {text:evidence,status:'ok',publishedAt:'2026-09-05T00:00:00Z'};},extract:async()=>raw};
    assert.equal((await repairTiming(db,opts)).repaired,1);
    const row=db.prepare('SELECT * FROM articles WHERE id=1').get();
    assert.deepEqual(seen,[1]);
    assert.equal(row.event_date,'2026-09-01');
    assert.equal(row.starred,1);assert.equal(row.quality_score,88);assert.equal(row.ai_summary,'保留摘要');assert.equal(row.analyzed,1);
    await repairTiming(db,opts);await repairTiming(db,opts);
    assert.deepEqual(seen,[1,2]);
    assert.equal(db.prepare('SELECT timing_repair_attempts n FROM articles WHERE id=1').get().n,1);
  } finally {db.close();}
});
test('repair does not call external services without a key and caps persistent failures at two', async () => {
  const db=repairDb();
  try {
    db.prepare("INSERT INTO articles(id,content_text,content_status,published_at,fetched_at,events_json) VALUES(1,?,'ok','2026-09-05',datetime('now'),?)").run(evidence,JSON.stringify(raw));
    let calls=0;
    const options={hasKey:false,extract:async()=>{calls++;throw Error('sensitive provider payload');}};
    await repairTiming(db,options);assert.equal(calls,0);
    options.hasKey=true;
    await repairTiming(db,options);await repairTiming(db,options);assert.equal(calls,1);
    db.exec("UPDATE articles SET timing_repair_at=datetime('now','-2 hours')");
    await repairTiming(db,options);
    db.exec("UPDATE articles SET timing_repair_at=datetime('now','-2 hours')");
    await repairTiming(db,options);assert.equal(calls,2);
    const row=db.prepare('SELECT * FROM articles').get();
    assert.equal(row.events_json,JSON.stringify(raw));assert.doesNotMatch(row.timing_repair_error,/sensitive/);
  } finally {db.close();}
});

test('overlapping repair rounds claim each historical row once', async () => {
  const db=repairDb();
  try {
    for(const id of [1,2]) db.prepare("INSERT INTO articles(id,title,content_text,content_status,published_at,fetched_at) VALUES(?,'蓝箭航天朱雀三号发射',?,'ok','2026-09-05',datetime('now'))").run(id,evidence);
    let calls=0;
    const options={hasKey:true,extract:async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return raw;}};
    await Promise.all([repairTiming(db,options),repairTiming(db,options)]);
    assert.equal(calls,2);
    assert.equal(db.prepare('SELECT sum(timing_repair_attempts) n FROM articles').get().n,2);
  } finally {db.close();}
});
