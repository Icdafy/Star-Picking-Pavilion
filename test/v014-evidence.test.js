'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEventDate, eventTiming, verifyEvent, publisher, timingFields } = require('../server/ai/event-time');
const { normalizeEvents } = require('../server/ai/events');
const { modelFor, needsReasoning, VISION_MODEL, PRO_MODEL } = require('../server/ai/model-policy');
const { analyzeImages } = require('../server/ai/vision');
const { extractContent } = require('../server/collectors/article-content');
const { publicUrl, publicFetch, robotsAllowed, isPublicAddress } = require('../server/collectors/public-web');
const wechat = require('../server/collectors/wechat');

const settings = { ai: { baseUrl: 'https://api.deepseek.com', model: VISION_MODEL } };
test('official provider routes routine/image work to Vision and complex judgments to Pro', () => {
  assert.equal(modelFor(settings), VISION_MODEL);
  assert.equal(modelFor(settings, 'reasoning'), PRO_MODEL);
  assert.equal(needsReasoning({title:'某型号获颁适航证'}), true);
  assert.equal(needsReasoning({title:'某公司常规进展'}, {events:[{},{}]}), true);
  assert.equal(needsReasoning({title:'某公司例行动态'}), false);
  assert.equal(modelFor({ai:{baseUrl:'https://custom.example',model:'custom'}}, 'reasoning'), 'custom');
});
test('event dates resolve against publication including New Year, never collection', () => {
  assert.equal(resolveEventDate('昨日','2026-01-01T04:00:00Z'),'2025-12-31');
  assert.equal(resolveEventDate('12月30日','2026-01-02T04:00:00Z'),'2025-12-30');
  assert.equal(resolveEventDate('近日','2026-09-05T00:00:00Z'),null);
  assert.equal(resolveEventDate('2026-02-30',null),null);
  assert.equal(resolveEventDate('8月2日',null),null);
});
const quote='2026年8月1日，蓝箭航天完成朱雀三号首飞。';
const article={title:'蓝箭航天首飞回顾',summary_raw:quote,published_at:'2026-09-05T00:00:00Z'};
test('only a verbatim dated evidence quote can establish an event date', () => {
  assert.equal(eventTiming({w:'2026-08-01',evidence:quote},article).date,'2026-08-01');
  assert.equal(eventTiming({w:'2026-09-05',evidence:quote},article).date,null);
  assert.equal(eventTiming({w:'2026-08-01',evidence:'模型编造的2026年8月1日首飞成功'},article).date,null);
});
test('atomic event keys distinguish recurring dates and plans from completed actions', () => {
  const base={a:'蓝箭航天',v:'完成首飞',o:'朱雀三号',w:'2026-08-01',evidence:quote,status:'completed'};
  const actual=normalizeEvents([base],{article})[0];
  const plan=normalizeEvents([{...base,v:'计划首飞',status:'completed'}],{article})[0];
  assert.notEqual(actual.key,plan.key);
  assert.equal(plan.status,'planned');
  assert.match(actual.key,/2026-08-01/);
  const quote2=quote.replace('8月1日','8月2日');
  assert.notEqual(actual.key,normalizeEvents([{...base,w:'2026-08-02',evidence:quote2}],{article:{...article,summary_raw:quote2}})[0].key);
});
const report=(url, extra={})=>({url,source_url:url,source_name:url,tier:'T2',date:'2026-08-01',evidence:quote,...extra});
test('single media, same domain, aggregate duplicates and attributed reprints cannot confirm', () => {
  assert.equal(verifyEvent([report('https://one.example/a')]).status,'pending');
  assert.equal(verifyEvent([report('https://one.example/a'),report('https://news.one.example/b')]).status,'pending');
  assert.equal(verifyEvent([report('https://finance.eastmoney.com/a'),report('https://finance.eastmoney.com/b')]).status,'pending');
  const syndicated={summary_raw:'来源：新华社'};
  assert.equal(verifyEvent([report('https://one.example/a',syndicated),report('https://two.example/a',syndicated)]).status,'pending');
  assert.equal(publisher(report('https://mp.weixin.qq.com/s/a')),null);
});
test('official origin or two independent publishers can confirm, conflicting dates cannot', () => {
  assert.equal(verifyEvent([report('https://agency.gov.cn/a',{tier:'T1'})]).status,'official');
  assert.equal(verifyEvent([report('https://media.example/a',{tier:'T1',source_url:'https://agency.gov.cn/'})]).status,'pending');
  assert.equal(verifyEvent([report('https://one.example/a'),report('https://two.example/b')]).status,'corroborated');
  assert.equal(verifyEvent([report('https://one.example/a'),report('https://two.example/b',{date:'2026-08-02'})]).status,'conflict');
});
test('late reporting displays 35 days, unknown dates stay unknown', () => {
  const fields=timingFields({event_date:'2026-08-01',published_at:article.published_at,verification_json:'{"status":"corroborated"}'});
  assert.equal(fields.reportDelayDays,35);
  assert.equal(timingFields({event_date:'2026-08-01',published_at:article.published_at}).reportDelayDays,null);
});
test('article parser captures lazy-loaded engineering images and discards tracking/QR assets', () => {
  const content=extractContent('<article>卫星制造图纸<img data-src="/part.png" alt="零部件图纸"><img src="/qr.png" alt="二维码"><img src="/pixel.png" width="1"></article>', 'https://news.example/article');
  assert.equal(content.images.length,1);
  assert.equal(content.images[0].url,'https://news.example/part.png');
});
test('vision uses bounded locally verified image bytes, filters output and never sends images to Pro', async () => {
  let payload;
  const result=await analyzeImages({title:'卫星零部件',url:'https://news.example/a'},[{url:'https://news.example/p.png'}],settings,{
    fetchImage:async()=>({body:Buffer.from([137,80,78,71,13,10,26,10])}),
    call:async(messages,options)=>{payload={messages,options};return JSON.stringify({images:[{i:0,useful:true,caption:'零部件示意图',kind:'图纸'},{i:99,useful:true,caption:'伪造图片'}]});}
  });
  assert.equal(payload.options.model,VISION_MODEL);
  assert.match(payload.messages[0].content[1].image_url.url,/^data:image\/png;base64,/);
  assert.equal(result.images.length,1);
  assert.equal((await analyzeImages({},[],{ai:{baseUrl:'https://custom.example',model:'text-only'}})).status,'unsupported');
});
test('public crawler rejects private addresses, alternate numeric IPs and redirect SSRF', async () => {
  for(const url of ['http://127.0.0.1','http://2130706433','http://169.254.169.254','http://[::1]','http://10.1.1.1','http://name:pass@example.com','http://example.com:9000']) assert.throws(()=>publicUrl(url));
  assert.equal(isPublicAddress('::ffff:127.0.0.1'),false);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  await assert.rejects(publicFetch('https://public.example',{fetchImpl:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})}),/公开/);
});
test('crawler respects robots disallow and longest allow exceptions', () => {
  const robots='User-agent: *\nDisallow: /private\nAllow: /private/public';
  assert.equal(robotsAllowed(robots,'/private/x'),false);
  assert.equal(robotsAllowed(robots,'/private/public/x'),true);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /search','/search?q=test'),false);
});
test('wechat feed only accepts public article URLs and filters unrelated industries', async () => {
  const feed='<rss version="2.0"><channel><title>公开订阅</title><item><title>卫星</title><link>https://mp.weixin.qq.com/s/one</link></item><item><title>美食</title><link>https://mp.weixin.qq.com/s/two</link></item><item><link>http://127.0.0.1/private</link></item></channel></rss>';
  const seen=[];
  const items=await wechat.fetch({url:'https://feed.example/rss',domain:'aerospace'}, {collect:{}},{page:async url=>{
    seen.push(url);return url.includes('feed.example')?feed:url.endsWith('one')?'<h1 id="activity-name">商业航天卫星制造新进展</h1><div id="js_content">卫星互联网星座量产交付</div>':'<h1>周末美食推荐</h1><article>美食旅行</article>';
  }});
  assert.equal(items.length,1);
  assert.equal(seen.some(u=>u.includes('127.0.0.1')),false);
});
