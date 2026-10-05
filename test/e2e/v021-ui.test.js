'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron:electron}=require('playwright');
test('capital search and native options adapt to both themes; atmosphere off persists after reload',{timeout:60000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spp-v021-ui-'));
 fs.copyFileSync(path.join(__dirname,'fixtures/empty-settings.json'),path.join(dir,'settings.json'));
 const app=await electron.launch({args:['.','--hidden'],cwd:path.join(__dirname,'../..'),env:{...process.env,
 STAR_PICKING_PAVILION_TEST_DATA_DIR:dir,STAR_PICKING_PAVILION_NO_SCHEDULER:'1',STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE:'1'}});
 t.after(async()=>{await app.close().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true})});
 const page=await app.firstWindow();await page.waitForLoadState('load');await page.waitForSelector('.nav');
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(800,700);w.showInactive()});
 await page.locator('[data-view="capital"]').click();
 await page.locator('#capitalSearch').fill('追梦空天');
 await page.locator('[data-capital-tab="companies"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.company-card').length===1);
 assert.match(await page.locator('.company-card').textContent(),/追梦空天科技/);
 for(const theme of ['light','dark']){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#btnTheme').click();
   const colors=await page.locator('#capitalDays option').first().evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));
   assert.notEqual(colors.fg,colors.bg);assert.notEqual(colors.bg,'rgba(0, 0, 0, 0)');
   await page.locator('[data-capital-tab="deals"]').click();assert.equal(await page.locator('#capitalSearch').isVisible(),true);
   await page.locator('[data-capital-tab="activity"]').click();await page.waitForSelector('#capitalBody .empty-state');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.locator('[data-view="settings"]').click();
 const toggle=page.locator('#setAquaEnabled'),reset=page.locator('#btnAquaReset');
 const a=await toggle.boundingBox(),b=await reset.boundingBox();assert.ok(a.x<b.x);
 if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
 await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.aquaEnabled==='off');
 assert.equal(await page.locator('.atmosphere').isVisible(),false);
 await page.waitForTimeout(400);await page.reload();await page.waitForSelector('.nav');
 assert.equal(await page.locator('html').getAttribute('data-aqua-enabled'),'off');
 await page.locator('[data-view="settings"]').click();await reset.click();
 await page.waitForFunction(()=>document.documentElement.dataset.aquaEnabled==='off');
 assert.equal(await page.locator('.atmosphere').isVisible(),false);
 await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.aquaEnabled==='on');
 assert.equal(await page.locator('.atmosphere').isVisible(),true);
 if(process.env.SPP_LAYOUT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SPP_LAYOUT_SCREENSHOT_DIR,'v021-atmosphere.png')});
});
