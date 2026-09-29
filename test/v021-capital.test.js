'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spp-v021-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR=dir;
const {db,insertArticle,closeDatabase}=require('../server/db');
const companies=require('../server/ai/companies'),deals=require('../server/ai/deals');
const {migrateCapital}=require('../server/ai/capital-migration');
test.after(()=>{closeDatabase();fs.rmSync(dir,{recursive:true,force:true})});
let seq=0;
function article(title,publishedAt=new Date().toISOString()){
 const n=++seq,url=`https://example.org/v021/${n}`;
 const source=Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES(?,'html',?,'T2','lowaltitude')").run('原始媒体'+n,url).lastInsertRowid);
 insertArticle({sourceId:source,title,url,canonicalUrl:url,summaryRaw:'融资原文'});
 const id=db.prepare('SELECT id FROM articles WHERE url=?').get(url).id;
 db.prepare("UPDATE articles SET relevant=1,published_at=?,domain='lowaltitude',subjects_json=? WHERE id=?").run(publishedAt,JSON.stringify([{name:'追梦空天',role:'primary'}]),id);
 return {id};
}
test('names resolve conservatively and separate financing rounds retain meaning',()=>{
 companies.syncCompanySeed();
 assert.equal(companies.resolveName('追梦空天').id,companies.resolveName('追梦空天科技').id);
 assert.equal(companies.resolveName('蓝箭航天的供应商星际零件科技'),null);
 assert.equal(companies.resolveName('蓝箭航空'),null);
 assert.throws(()=>companies.addCompany({name:'追梦空天'}),/已有/);
 companies.updateCompany('dream-aerospace',{aliases:['追梦空天','用户自定别名']});
 companies.syncCompanySeed({force:true});
 assert.ok(companies.getCompany('dream-aerospace').aliases.includes('用户自定别名'));
 for(const name of ['A++轮','A++++轮','B1轮','Pre-IPO','天使+轮','Pre-A+轮'])assert.equal(deals.normalizeRound(name),name);
 assert.equal(deals.normalizeDeal({company:'追梦空天',amount:'约3亿元',amountCny:300000000}).amountCny,null);
 assert.equal(deals.normalizeDeal({company:'追梦空天',amount:'1亿美元',amountCny:100000000}).amountCny,null);
 assert.equal(deals.heuristicDeal({title:'追梦空天完成A++++轮融资'}).round,'A++++轮');
 assert.equal(deals.heuristicDeal({title:'深蓝航天完成两轮近20亿元融资'}),null);
});
test('aliases merge historical deals transactionally, retain evidence and are idempotent',()=>{
 const a=article('追梦空天完成数亿元A+轮融资'),b=article('追梦空天科技完成A+轮融资');
 const deal=deals.normalizeDeal({company:'追梦空天',round:'A+轮',amount:'数亿元',investors:['航投基金'],status:'completed'});
 const id1=deals.recordDeal(a,deal,{domain:'lowaltitude'});
 // Recreate an older version's duplicate row with the unregistered alias key.
 db.prepare('UPDATE deals SET company_id=NULL,company_name=?,deal_key=? WHERE id=?').run('追梦空天','name:追梦空天|A+轮',id1);
 deals.recordDeal(b,{...deal,company:'追梦空天科技'},{domain:'lowaltitude'});
 assert.equal(migrateCapital(),true);
 const found=deals.listDeals({q:'追梦',days:30});
 assert.equal(found.length,1);assert.equal(found[0].sourceCount,2);assert.equal(found[0].companyId,'dream-aerospace');
 assert.equal(found[0].dateBasis,'published');
 assert.equal(companies.activityFeed({q:'DF600',days:30}).length,2);
 assert.equal(migrateCapital(),false);
 assert.equal(deals.listDeals({q:'追梦%',days:30}).length,0);
 assert.equal(deals.discoveredCompanies({domain:'aerospace',q:'追梦'}).length,0);
});
test('old articles cannot masquerade as recent funding; search filters investors and watch scope',()=>{
 const a=article('追梦空天完成B轮融资','2020-01-01T00:00:00.000Z');
 deals.recordDeal(a,deals.normalizeDeal({company:'追梦空天',round:'B轮'}),{domain:'lowaltitude'});
 assert.equal(deals.listDeals({q:'追梦',days:30}).some(d=>d.round==='B轮'),false);
 assert.equal(deals.investorBoard({q:'不存在'}).length,0);
 companies.setWatch('dream-aerospace',1);
 assert.equal(deals.listDeals({q:'DF600',watchedOnly:true,days:30}).length,1);
 assert.equal(deals.discoveredCompanies({watchedOnly:true}).length,0);
});
test('WeChat challenge pages cannot become collected articles; valid feeds collect full text',async()=>{
 const wechat=require('../server/collectors/wechat');
 const url='https://mp.weixin.qq.com/s/example';
 await assert.rejects(wechat.fetch({url,domain:'both'},{},{page:async()=>'<body>环境异常，请完成验证</body>'}),/验证/);
 const html='<h1 id="activity-name">商业航天企业完成融资</h1><span id="js_name">商业航天发展</span><div id="js_content">商业航天火箭公司完成A轮融资，金额3亿元。</div>';
 const rows=await wechat.fetch({url,domain:'both'},{},{page:async()=>html});
 assert.equal(rows.length,1);assert.equal(rows[0].publisherId,'商业航天发展');
 assert.match(rows[0].contentText,/3亿元/);
});
test('migration preserves disabled-company deal and article references',()=>{
 const a=article('追梦空天科技完成C轮融资');
 companies.writeArticleCompanies(a.id,[{id:'dream-aerospace',name:'追梦空天科技',role:'primary'}]);
 deals.recordDeal(a,deals.normalizeDeal({company:'追梦空天科技',round:'C轮'}),{domain:'lowaltitude'});
 companies.updateCompany('dream-aerospace',{enabled:false});
 db.prepare("DELETE FROM meta WHERE key='capitalIdentityV021'").run();
 migrateCapital();
 assert.equal(db.prepare("SELECT company_id FROM deals WHERE round='C轮'").get().company_id,'dream-aerospace');
 assert.equal(db.prepare('SELECT company_id FROM article_companies WHERE article_id=?').get(a.id).company_id,'dream-aerospace');
});
