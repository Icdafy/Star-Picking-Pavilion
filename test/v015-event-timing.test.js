'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeEvents } = require('../server/ai/events');
const { timingFields, resolveEventDate } = require('../server/ai/event-time');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'spp-v015-time-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR=dataDir;
const {db,closeDatabase}=require('../server/db');
const {refreshEventTiming}=require('../server/ai/event-timing-migration');
test.after(()=>{closeDatabase();fs.rmSync(dataDir,{recursive:true,force:true});});

function event(quote,raw={}) {
  const article={title:'蓝箭航天朱雀三号发射',summary_raw:quote,published_at:'2026-09-05T00:00:00Z'};
  const events=normalizeEvents([{a:'蓝箭航天',v:'发射成功',o:'朱雀三号',w:'2026-09-01',evidence:quote,...raw}],{article});
  return {article,events,fields:timingFields({...article,events_json:JSON.stringify(events)})};
}
test('completed launch delayed four days gets a delay from a single original report',()=>{
  const {fields}=event('2026年9月1日，蓝箭航天朱雀三号发射成功。');
  assert.equal(fields.reportDelayDays,4);
  assert.equal(fields.eventDate,'2026-09-01');
  assert.equal(fields.verification,undefined);
});
test('planned, postponed, undated and hallucinated dates never masquerade as actual events',()=>{
  for(const [quote,raw] of [
    ['2026年9月1日，蓝箭航天计划发射朱雀三号。',{v:'计划发射',status:'completed'}],
    ['2026年9月1日，蓝箭航天朱雀三号发射延期。',{v:'发射延期'}],
    ['近日，蓝箭航天朱雀三号发射成功。',{}],
    ['蓝箭航天朱雀三号发射成功。', {evidence:'2026年9月1日，蓝箭航天朱雀三号发射成功。'}]
  ]) assert.equal(event(quote,raw).fields.reportDelayDays,null,quote);
});
test('time extraction keeps separate dates and does not borrow a background event date',()=>{
  const quote='2026年9月1日，蓝箭航天朱雀三号发射成功。';
  const {events}=event(quote,{a:'另一家公司',o:'另一枚火箭'});
  assert.equal(events[0].date,null);
  assert.equal(event('2026年9月1日，蓝箭航天朱雀三号完成试验；2026年9月3日，蓝箭航天朱雀三号发射成功。').fields.reportDelayDays,null);
  assert.equal(resolveEventDate('3天前','2026-01-02T00:00:00Z'),'2025-12-30');
  assert.equal(resolveEventDate('昨日','2026-09-04T18:00:00Z'),'2026-09-04');
  const {eventTiming}=require('../server/ai/event-time');
  const tomorrow='2026年9月2日，蓝箭航天朱雀三号发射成功。';
  assert.equal(eventTiming({w:'2026-09-02',evidence:tomorrow},{summary_raw:tomorrow,published_at:'2026-09-01T08:00:00Z'}).date,null);
  const alias='2026年9月1日，蓝箭发射成功。';
  assert.equal(event(alias,{o:''}).fields.reportDelayDays,4);
});
test('ownership is not recovery and different product models retain separate keys',()=>{
  const [ownership]=normalizeEvents([{a:'阿里巴巴',v:'成为股东',o:'垣信卫星'}],{fallbackText:'可回收火箭 千帆星座'});
  assert.equal(ownership.actionClass,'ownership');
  const [a,b]=normalizeEvents([{a:'沃飞长空',v:'完成首飞',o:'AE200'},{a:'沃飞长空',v:'完成首飞',o:'AE100'}]);
  assert.equal(a.object,'AE200');
  assert.notEqual(a.key,b.key);
});
test('existing single-source events migrate once and retain original evidence and stars',()=>{
  const {article,events}=event('2026年9月1日，蓝箭航天朱雀三号发射成功。');
  events[0].verification={status:'pending',sources:[]};
  const source=db.prepare("INSERT INTO sources(name,type,url,tier) VALUES('测试','rss','https://fixture.example/feed','T2')").run().lastInsertRowid;
  const id=db.prepare(`INSERT INTO articles(source_id,title,url,summary_raw,published_at,fetched_at,events_json,starred,relevant)
    VALUES(?,?,'https://fixture.example/article',?,?,'2026-09-05',?,1,1)`).run(source,article.title,article.summary_raw,article.published_at,JSON.stringify(events)).lastInsertRowid;
  assert.equal(refreshEventTiming(),1);
  assert.equal(refreshEventTiming(),0);
  const row=db.prepare('SELECT * FROM articles WHERE id=?').get(id);
  assert.equal(row.event_date,'2026-09-01');
  assert.equal(row.starred,1);
  assert.equal(timingFields(row).reportDelayDays,4);
  assert.equal(JSON.parse(row.events_json)[0].verification,undefined);
});
test('v0.1.4 database column is removed on upgrade without losing articles',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spp-v015-upgrade-'));
  try {
    const first=spawnSync(process.execPath,['-e',`const {db}=require('./server/db'); db.exec("ALTER TABLE articles ADD COLUMN verification_json TEXT; DELETE FROM meta WHERE key='v015RemovedVerification'"); db.close();`],{cwd:path.join(__dirname,'..'),env:{...process.env,STAR_PICKING_PAVILION_DATA_DIR:dir},encoding:'utf8'});
    assert.equal(first.status,0,first.stderr);
    const second=spawnSync(process.execPath,['-e',`const {db}=require('./server/db'); console.log(JSON.stringify(db.prepare('PRAGMA table_info(articles)').all().map(r=>r.name))); db.close();`],{cwd:path.join(__dirname,'..'),env:{...process.env,STAR_PICKING_PAVILION_DATA_DIR:dir},encoding:'utf8'});
    assert.equal(second.status,0,second.stderr);
    assert.ok(!JSON.parse(second.stdout).includes('verification_json'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
