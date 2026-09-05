'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v014-evidence-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase } = require('../server/db');
const { normalizeEvents } = require('../server/ai/events');
const { reconcileEvents } = require('../server/ai/verification');
const { clusterRecent } = require('../server/ai/cluster');
const { timingFields } = require('../server/ai/event-time');
const { heatScore } = require('../server/ai/scoring');
const { loadScoring } = require('../server/config');
test.after(() => {closeDatabase();fs.rmSync(dataDir,{recursive:true,force:true});});

function insert(host, date, fetchedAt = new Date().toISOString(), status = 'completed') {
  const url=`https://${host}/${date}/${status}`;
  const source=db.prepare("INSERT OR IGNORE INTO sources(name,type,url,tier,domain) VALUES(?,'rss',?,'T2','aerospace')").run(host,`https://${host}/feed`);
  const sourceId=source.changes?source.lastInsertRowid:db.prepare('SELECT id FROM sources WHERE url=?').get(`https://${host}/feed`).id;
  const summary_raw=`${date}，蓝箭航天完成朱雀三号首飞。`;
  const published_at='2026-09-05T00:00:00Z';
  const events=normalizeEvents([{a:'蓝箭航天',v:'完成首飞',o:'朱雀三号',w:date,status,evidence:summary_raw}],{article:{summary_raw,published_at}});
  return Number(db.prepare(`INSERT INTO articles(source_id,title,url,summary_raw,published_at,fetched_at,relevant,analyzed,domain,events_json,event_key)
    VALUES(?,?,?,?,?,?,1,1,'aerospace',?,?)`).run(sourceId,'蓝箭航天朱雀三号完成首飞',url,summary_raw,published_at,fetchedAt,JSON.stringify(events),events[0].key).lastInsertRowid);
}
test('late reporting reconciles with retained history outside display-cluster window and decays from event date',()=>{
  const first=insert('one.example','2026-08-01',new Date(Date.now()-20*86400000).toISOString());
  reconcileEvents();
  assert.equal(timingFields(db.prepare('SELECT * FROM articles WHERE id=?').get(first)).eventDate,null);
  const second=insert('two.example','2026-08-01');
  reconcileEvents();
  const late=db.prepare('SELECT * FROM articles WHERE id=?').get(second);
  const fields=timingFields(late);
  assert.equal(fields.verification.status,'corroborated');
  assert.equal(fields.verification.sources.length,2);
  assert.equal(fields.eventDate,'2026-08-01');
  assert.equal(fields.reportDelayDays,35);
  const scoring=loadScoring();
  assert.ok(heatScore(90,fields.eventDate,scoring,Date.parse('2026-09-05'))<1);
  assert.equal(reconcileEvents(),0,'repeated reconciliation must not rewrite unchanged rows');
});
test('same title across different event dates and states cannot merge through any cluster path',()=>{
  const third=insert('three.example','2026-08-02');
  const fourth=insert('four.example','2026-08-02',new Date().toISOString(),'planned');
  clusterRecent();
  const a=db.prepare('SELECT cluster_id FROM articles WHERE id=?').get(third);
  const b=db.prepare('SELECT cluster_id FROM articles WHERE id=?').get(fourth);
  assert.ok(a.cluster_id===null || a.cluster_id!==b.cluster_id);
  reconcileEvents();
  assert.equal(timingFields(db.prepare('SELECT * FROM articles WHERE id=?').get(third)).verification.status,'conflict');
  assert.equal(timingFields(db.prepare('SELECT * FROM articles WHERE id=?').get(fourth)).eventDate,null);
});
