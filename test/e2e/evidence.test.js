'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { _electron: electron } = require('playwright');

test('event timing, cross-source evidence and image gallery render safely at narrow and wide sizes', {timeout:60000}, async t => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'spp-evidence-ui-'));
  fs.copyFileSync(path.join(__dirname,'fixtures/empty-settings.json'),path.join(dataDir,'settings.json'));
  const app=await electron.launch({args:['.','--hidden'],cwd:path.join(__dirname,'../..'),env:{...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR:dataDir,STAR_PICKING_PAVILION_NO_SCHEDULER:'1',STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE:'1'}});
  t.after(async()=>{await app.close().catch(()=>{});fs.rmSync(dataDir,{recursive:true,force:true});});
  const page=await app.firstWindow();
  await page.waitForSelector('.nav');
  await page.route('https://fixture.example/rocket.png',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#132738"/><path d="M220 165V65L240 25 260 65V165Z" fill="#dae9ed"/><path d="M220 145L190 195 220 178M260 145L290 195 260 178" fill="#40b9bb"/><path d="M228 170L240 220 252 170" fill="#ffa659"/></svg>'}));
  const database=new DatabaseSync(path.join(dataDir,'star-picking-pavilion.db'));
  const source=database.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('核验测试','rss','https://fixture.example/feed','T2','aerospace')").run().lastInsertRowid;
  const verification={status:'corroborated',date:'2026-08-01',sources:[{name:'媒体甲',url:'https://one.example/a',date:'2026-08-01',evidence:'2026年8月1日完成首飞。'},{name:'媒体乙',url:'https://two.example/b',date:'2026-08-01',evidence:'2026年8月1日首飞成功。'}]};
  database.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,published_at,event_date,relevant,featured,analyzed,domain,quality_score,ai_summary,verification_json,events_json,vision_json)
    VALUES(?, '火箭首飞事件图文核验', 'https://fixture.example/article', ?, '2026-09-05T00:00:00Z', '2026-08-01',1,1,1,'aerospace',85,'迟报消息应按真实事件日期理解。',?,?,?)`).run(source,new Date().toISOString(),JSON.stringify(verification),JSON.stringify([{actor:'测试火箭',action:'完成首飞',date:'2026-08-01',status:'completed',evidence:'2026年8月1日完成首飞。'}]),JSON.stringify({status:'analyzed',images:[{url:'https://fixture.example/rocket.png',caption:'火箭示意图，不证明任务结果',kind:'示意图',sourceUrl:'https://fixture.example/article'}]}));
  database.close();
  await page.reload();
  await page.waitForSelector('.event-time-badge');
  assert.match(await page.locator('.event-time-badge').first().textContent(),/迟报 35 天.*独立多源确认/);
  await page.locator('.event-verification summary').first().click();
  assert.equal(await page.locator('.event-verification a').count(),2);
  await page.waitForFunction(()=>document.querySelector('.card-image-evidence img')?.naturalWidth>0);
  assert.match(await page.locator('.card-image-evidence').textContent(),/AI 图片解读/);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  for(const width of [800,1440]) {
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
    await page.waitForFunction(width=>innerWidth===width,width);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'evidence must not cause horizontal overflow');
    await page.locator('.card[data-id]').first().screenshot({path:path.join(__dirname,`../../build/v014-evidence-${width}.png`)});
  }
});
