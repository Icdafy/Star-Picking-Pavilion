'use strict';
// v027 protocol 2: native foreground/visibility, real HTTP/database/IPC; no route interception.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const net = require('node:net');
const { chromium } = require('playwright');
const root = path.resolve(process.env.SPP_V027_ROOT || path.join(__dirname, '../..'));
async function launchNative(root, profile) {
  const port = await new Promise(resolve => { const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
  const wrapper = path.join(profile, 'native-launch.cjs');
  fs.writeFileSync(wrapper, `'use strict';
const electron=require('electron');
const {app,BrowserWindow,screen}=electron;
process.on('uncaughtException',e=>{console.error(e);app.exit(1)});
process.on('message',async message=>{
  try {
    const result=await eval('('+message.expression+')')(electron,message.arg);
    process.send({id:message.id,result});
  } catch(e){process.send({id:message.id,error:e.stack||String(e)})}
});
require(${JSON.stringify(path.join(root,'electron/main.js'))});
app.whenReady().then(()=>process.send({ready:true}));
`);
  // The wrapper is inside the fresh fixture profile; the application is unchanged.
  const child=spawn(require('electron'),[wrapper,'--hidden',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:root,env:{...process.env,STAR_PICKING_PAVILION_TEST_DATA_DIR:profile,STAR_PICKING_PAVILION_NO_SCHEDULER:'1',STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE:'1'},stdio:['ignore','pipe','pipe','ipc']});
  let log='',sequence=0;const pending=new Map();
  child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  child.on('message',m=>{if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}}});
  const evaluate=(fn,arg)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native IPC timeout'))},15000);pending.set(id,{resolve,reject,timer});child.send({id,expression:fn.toString(),arg});});
  let browser;
  async function close(){
    if(browser)await browser.close().catch(()=>{});
    if(child.exitCode===null&&child.connected){await evaluate(({app})=>{setTimeout(()=>app.quit(),30);return true}).catch(()=>{});await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{if(child.exitCode===null)child.kill();resolve()},5000).unref()});}
    fs.writeFileSync(path.join(profile,'native-launch.log'),log);
  }
  try {
    const start=Date.now();
    while(Date.now()-start<20000){if(child.exitCode!==null)throw new Error('Native launch failed: '+log);try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
    const context=browser.contexts()[0];let page=context.pages()[0];
    if(!page)page=await context.waitForEvent('page');
    return {evaluate,firstWindow:async()=>page,context:()=>context,close,process:()=>child};
  }catch(e){await close();throw e;}
}

function seed(profile, anchor, count = 90, start = 0) {
  const script = `const {db,closeDatabase}=require(${JSON.stringify(path.join(root,'server/db.js'))});
    let source=db.prepare("SELECT id FROM sources WHERE name='v027 隔离样本'").get()?.id;
    if(!source)source=Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('v027 隔离样本','rss','https://motion-fixture.example/feed','T2','aerospace')").run().lastInsertRowid);
    const insert=db.prepare('INSERT INTO articles(source_id,title,url,fetched_at,published_at,relevant,featured,analyzed,domain,quality_score,ai_summary) VALUES(?,?,?,?,?,1,1,1,?,88,?)');
    db.exec('BEGIN');for(let i=${start};i<${start+count};i++){const date=new Date(${anchor}-i*60000).toISOString();
    const title='基线样本 '+(i+1)+'：航天产业技术进展与商业航天观察',summary='用于测试动效的隔离样本：火箭运载能力、低空经济与产业投资进展。所有内容均为虚构样本。';
    const id=Number(insert.run(source,title,'https://motion-fixture.example/v027/'+i,date,date,'aerospace',summary).lastInsertRowid);
    db.prepare('INSERT INTO articles_fts(rowid,title,summary) VALUES(?,?,?)').run(id,title,summary);}db.exec('COMMIT');closeDatabase();`;
  const r = spawnSync(process.execPath, ['-e',script], { cwd:root,env:{...process.env,STAR_PICKING_PAVILION_DATA_DIR:profile},encoding:'utf8' });
  assert.equal(r.status,0,r.stderr);
}
async function open(t) {
  const base = path.join(root,'work','v027','e2e');fs.mkdirSync(base,{recursive:true});
  const profile = fs.mkdtempSync(path.join(base,'profile-')); const anchor=Date.now();
  fs.writeFileSync(path.join(profile,'settings.json'),'{}');seed(profile,anchor);
  const app=await launchNative(root,profile);
  t.after(async()=>{await app.close();});
  const page=await app.firstWindow(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('#feedList .card[data-id]');
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,920);w.setAlwaysOnTop(true);w.show();w.focus();w.webContents.focus();});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.hasFocus()&&!document.hidden);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused()),true);await page.waitForTimeout(800);
  return {app,page,profile,anchor,errors};
}
const finite = () => document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity&&a.playState!=='finished'&&a.playState!=='idle').length;

test('v027 Electron: synchronous theme parity, latest intent, native and persisted theme', {timeout:90_000}, async t=>{
  const {app,page,profile,errors}=await open(t);
  for(const clicks of [20,21,30]) {
    const r=await page.evaluate(count=>{const before=document.documentElement.dataset.theme;for(let i=0;i<count;i++)document.querySelector('#btnTheme').click();return{before,immediate:document.documentElement.dataset.theme};},clicks);
    const expected=clicks%2?(r.before==='dark'?'light':'dark'):r.before;
    assert.equal(r.immediate,expected,`${clicks} clicks must apply the intended theme immediately`);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),expected,`${clicks} clicks must keep parity after stale callbacks settle`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'ui-preferences.json'),'utf8')).theme,expected);
    const background=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBackgroundColor());
    assert.equal(background.slice(0,7).toLowerCase(),expected==='dark'?'#151517':'#ffffff');
    assert.deepEqual(await page.evaluate(()=>({reveal:document.documentElement.classList.contains('theme-reveal'),transition:document.body.classList.contains('theme-transition')})),{reveal:false,transition:false});
  }
  assert.deepEqual(errors,[]);
});
test('v027 Electron: 30 interrupted navigations, modal/lexicon Esc focus and confirmation cancellation', {timeout:90_000},async t=>{
  const {page,errors}=await open(t);
  const max=await page.evaluate(()=>{const views=['featured','links','hot','capital','daily','settings'];let max=0;for(let i=0;i<30;i++){document.querySelector(`.tab[data-view="${views[i%views.length]}"]`).click();for(const panel of document.querySelectorAll('.view'))max=Math.max(max,panel.getAnimations().filter(a=>a.constructor.name==='Animation'&&a.playState==='running').length);}return max;});
  assert.ok(max<=1,`a panel retained ${max} simultaneous entry animations`);
  await page.waitForTimeout(800);
  assert.deepEqual(await page.evaluate(()=>({active:document.querySelector('.tab.active').dataset.view,visible:[...document.querySelectorAll('.view')].filter(e=>!e.hidden).map(e=>e.id)})),{active:'settings',visible:['viewSettings']});
  const alignment=await page.evaluate(()=>{const a=document.querySelector('.tab.active').getBoundingClientRect(),b=document.querySelector('.tab-indicator').getBoundingClientRect();return Math.max(Math.abs(a.left-b.left),Math.abs(a.top-b.top),Math.abs(a.width-b.width),Math.abs(a.height-b.height));});
  assert.ok(alignment<=2,`indicator is ${alignment}px from the selected tab`);
  await page.locator('#btnPalette').focus();await page.keyboard.press('Control+k');await page.waitForSelector('#commandPalette[open]');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='btnPalette');
  await page.locator('#btnLexicon').click();await page.waitForFunction(()=>document.activeElement.id==='lexiconFilter');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='btnLexicon');
  await page.locator('#btnPalette').focus();
  await page.evaluate(()=>{window.__v027Confirm=null;confirmGlass('仅确认隔离样本').then(value=>window.__v027Confirm=value);});
  await page.locator('#confirmDialogOk').click();await page.waitForFunction(()=>window.__v027Confirm===true);
  await page.evaluate(()=>{window.__v027Confirm=null;confirmGlass('第二次确认应可取消').then(value=>window.__v027Confirm=value);});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#confirmDialog').open);
  assert.equal(await page.evaluate(()=>window.__v027Confirm),false,'Esc after a previous OK must cancel');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'btnPalette');assert.deepEqual(errors,[]);
});
test('v027 Electron: filter/search/page, star/copy, incremental identity and reading position', {timeout:120_000},async t=>{
  const {page,profile,anchor,errors}=await open(t);
  await page.locator('.domain-pills [data-domain="aerospace"]').click();await page.waitForFunction(()=>!state.loading&&document.querySelectorAll('#feedList .card[data-id]').length===30);
  await page.locator('#searchInput').fill('基线样本 2');
  assert.equal(await page.locator('#searchBox').getAttribute('class').then(x=>x.includes('has-value')),true);
  await page.waitForFunction(()=>!state.loading&&state.q==='基线样本 2');
  const titles=await page.locator('#feedList .card-title').allTextContents();assert.ok(titles.length>0&&titles.every(title=>title.includes('基线样本 2')));
  await page.locator('#searchClear').click();await page.waitForFunction(()=>!state.loading&&state.q===''&&document.querySelectorAll('#feedList .card[data-id]').length===30);
  await page.evaluate(()=>{window.__v027First=document.querySelector('#feedList .card');document.querySelector('#btnMore').click();});
  await page.waitForFunction(()=>!state.loading&&document.querySelectorAll('#feedList .card[data-id]').length>=60);
  assert.equal(await page.evaluate(()=>window.__v027First===document.querySelector('#feedList .card')),true,'pagination must retain existing cards');
  assert.equal(await page.evaluate(()=>new Set([...document.querySelectorAll('#feedList .card')].map(e=>e.dataset.id)).size===document.querySelectorAll('#feedList .card').length),true);
  const star=page.locator('#feedList .card [data-act="star"]').first();await star.click();await page.waitForFunction(()=>document.querySelector('#feedList .card [data-act="star"]').getAttribute('aria-pressed')==='true');
  assert.match(await page.locator('#toast').textContent(),/^已星标/);
  await page.locator('#feedList .card [data-act="copy"]').first().click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='已复制标题与链接');
  await page.evaluate(async()=>{window.scrollTo({top:0,behavior:'instant'});await realtimePoller.pollRealtime();window.__v027First=document.querySelector('#feedList .card');document.querySelector('#searchInput').focus();});
  seed(profile,anchor,5,-5);
  // A real star write invalidates the server's five-second stats cache.
  await page.evaluate(async()=>{await api('/api/articles/'+document.querySelector('#feedList .card').dataset.id+'/star',{body:{starred:false}});await realtimePoller.pollRealtime();});
  assert.equal(await page.evaluate(()=>window.__v027First.isConnected),true,'incremental prepend must keep existing card identity');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'searchInput');
  const animated=await page.evaluate(()=>[...document.querySelectorAll('#feedList .tl-row')].filter(e=>e.getAnimations().some(a=>a.constructor.name==='Animation'&&a.playState==='running')).map(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,visible:r.top<innerHeight&&r.bottom>0};}));
  assert.ok(animated.every(e=>e.visible),`offscreen new rows were animated: ${JSON.stringify(animated)}`);
  await page.evaluate(()=>{window.scrollTo({top:600,behavior:'instant'});document.querySelectorAll('#feedList .card [data-act="star"]')[2].focus({preventScroll:true});window.__v027Reading={scroll:scrollY,focus:document.activeElement};});
  seed(profile,anchor,1,-6);
  await page.evaluate(async()=>{await api('/api/articles/'+document.querySelector('#feedList .card').dataset.id+'/star',{body:{starred:true}});await realtimePoller.pollRealtime();});
  const reading=await page.evaluate(()=>({delta:Math.abs(scrollY-window.__v027Reading.scroll),sameFocus:document.activeElement===window.__v027Reading.focus,banner:!document.querySelector('#newFlash').hidden}));
  assert.ok(reading.delta<=2);assert.equal(reading.sameFocus,true);assert.equal(reading.banner,true);assert.deepEqual(errors,[]);
});
test('v027 Electron: runtime reduced-motion, static terminal state, hidden/resume and appearance off', {timeout:90_000},async t=>{
  const {app,page,errors}=await open(t);
  await page.evaluate(()=>{document.querySelector('.tab[data-view="links"]').click();document.querySelector('#btnTheme').click();});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.documentElement.dataset.fxTier==='static');await page.waitForTimeout(100);
  assert.equal(await page.evaluate(finite),0,'running reduced-motion must settle ongoing entry and theme motion');
  const before=await page.evaluate(()=>document.documentElement.dataset.theme);
  await page.evaluate(()=>{for(let i=0;i<21;i++)document.querySelector('#btnTheme').click();document.querySelector('.tab[data-view="featured"]').click();});await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),before==='dark'?'light':'dark');assert.equal(await page.evaluate(finite),0);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>document.querySelector('.tab[data-view="links"]').click());
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());await page.waitForFunction(()=>document.hidden&&!document.hasFocus());
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {visible:w.isVisible(),focused:w.isFocused()};}),{visible:false,focused:false});
  assert.equal(await page.evaluate(finite),0,'hidden app must release finite motion');
  assert.equal(await page.evaluate(()=>document.body.classList.contains('is-idle')),true);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(false);w.show();w.focus();w.webContents.focus();});
  await page.waitForTimeout(150);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(true);w.focus();w.webContents.focus();});
  await page.waitForFunction(()=>!document.hidden&&document.hasFocus()&&!document.body.classList.contains('is-idle'));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused()),true);
  assert.ok(await page.evaluate(()=>{document.querySelector('.tab[data-view=featured]').click();return document.querySelector('#viewFeed').getAnimations().some(a=>a.constructor.name==='Animation'&&a.playState==='running');}),'full foreground must admit motion after restore');
  await page.locator('.tab[data-view="settings"]').click();await page.locator('#setAquaEnabled').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.aquaEnabled),'off');
  await page.reload();await page.waitForSelector('.nav');assert.equal(await page.locator('#setAquaEnabled').getAttribute('aria-pressed'),'false');assert.deepEqual(errors,[]);
});
