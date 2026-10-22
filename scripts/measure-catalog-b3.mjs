/** Controlled local comparison, not a field/CrUX certification. No production writes. */
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const tools=path.resolve(process.env.EGE_BROWSER_TOOLS||'/private/tmp/ege-storefront-browser');const require=createRequire(path.join(tools,'package.json'));
const {chromium}=require('playwright');
const vitals=await readFile(path.join(tools,'node_modules/web-vitals/dist/web-vitals.iife.js'),'utf8');
const catalog=JSON.parse(await readFile(process.env.EGE_STOREFRONT_CATALOG||path.join(tools,'catalog-readonly.json'),'utf8'));
const out=path.resolve('.scratch/b3'),cache=path.join(out,'image-cache');await mkdir(cache,{recursive:true});
const before=process.env.EGE_CATALOG_BEFORE||'http://127.0.0.1:4383',after=process.env.EGE_CATALOG_AFTER||'http://127.0.0.1:4385';
for(const value of [before,after])assert.ok(['localhost','127.0.0.1'].includes(new URL(value).hostname),'Local origins only');
const browser=await chromium.launch({headless:true,executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
// Replay the exact public images for BOTH versions. Cache preparation is outside measured sessions.
const urls=[...new Set(catalog.products.map(p=>p.imageUrl).filter(Boolean))];
const images=new Map(),failedImages=[];
try{
 for(const url of urls){
  const key=createHash('sha256').update(url).digest('hex'),file=path.join(cache,key),metaFile=file+'.json';
  let body,meta;
  try{body=await readFile(file);meta=JSON.parse(await readFile(metaFile,'utf8'))}catch{
    try{body=await readFile(file);meta={status:200,contentType:body[0]===255?'image/jpeg':body.toString('ascii',0,4)==='RIFF'?'image/webp':'image/png'}}catch{
      const context=await browser.newContext();
      try{const result=await context.request.get(url,{timeout:20000});body=await result.body();meta={status:result.status(),contentType:result.headers()['content-type']||'application/octet-stream'};await writeFile(file,body)}finally{await context.close()}
    }
    await writeFile(metaFile,JSON.stringify(meta));
  }
  if(meta.status!==200)failedImages.push({url,status:meta.status});
  images.set(url,{body,...meta});
 }
 const runs=[];
 for(const width of [375,1440])for(const [version,origin] of [['before',before],['after',after]])for(let run=1;run<=5;run++){
  const context=await browser.newContext({viewport:{width,height:960}});await context.addCookies([{name:'ege_analytics_consent',value:'0',url:origin}]);
  const metrics={},calls=[];let renderCount=0;
  const page=await context.newPage();await page.exposeFunction('recordVital',metric=>{metrics[metric.name]=metric.value});
  await page.addInitScript({content:vitals+`;webVitals.onLCP(recordVital,{reportAllChanges:true});webVitals.onCLS(recordVital,{reportAllChanges:true});webVitals.onINP(recordVital,{reportAllChanges:true});`});
  await context.route('**/api/**',async route=>{const request=route.request(),u=new URL(request.url());calls.push(u.pathname);if(request.method()!=='GET')return route.fulfill({status:204});if(u.pathname==='/api/products'){await new Promise(resolve=>setTimeout(resolve,600));return route.fulfill({json:catalog})}return route.fulfill({json:{posts:[],products:[],documents:[]}})});
  await context.route('https://**',route=>{const response=images.get(route.request().url());return response?route.fulfill(response):route.abort()});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(origin+'/catalog.html');await page.waitForFunction(()=>document.querySelector('[data-products] .product:not(.product-skeleton)'));await page.waitForTimeout(600);
  if(run===1){await page.screenshot({path:`${out}/performance-${version}-${width}.png`})}
  await page.evaluate(()=>{window.catalogRenders=0;new MutationObserver(records=>{window.catalogRenders+=records.filter(r=>r.type==='childList'&&r.target.matches?.('[data-products]')).length}).observe(document.querySelector('[data-products]'),{childList:true})});
  // Real, trusted keyboard events; exactly the same four-character query in both versions.
  await page.locator('#catalog-search').focus();await page.locator('#catalog-search').pressSequentially('Airy',{delay:25});await page.waitForTimeout(500);
  renderCount=await page.evaluate(()=>window.catalogRenders);
  await page.keyboard.press('Tab');await page.waitForTimeout(250);
  await page.goto('about:blank');await page.waitForTimeout(100);
  assert.ok(Number.isFinite(metrics.LCP)&&Number.isFinite(metrics.CLS)&&Number.isFinite(metrics.INP),`Missing actual metric: ${JSON.stringify(metrics)}`);
  runs.push({version,width,run,LCP:metrics.LCP,INP:metrics.INP,CLS:metrics.CLS,typingRenders:renderCount,apiRequests:calls.filter(p=>p!=='/api/analytics/event').length});
  console.log(JSON.stringify(runs.at(-1)));await context.close();
 }
 const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
 const summary=[];
 for(const width of [375,1440])for(const version of ['before','after']){
  const rows=runs.filter(r=>r.width===width&&r.version===version);const row={width,version,n:rows.length};
  for(const key of ['LCP','INP','CLS','typingRenders','apiRequests'])row[key]=percentile(rows.map(r=>r[key]),.75);
  row.localTargets=row.LCP<=2500&&row.INP<=200&&row.CLS<=.1?'PASS':'FAIL';summary.push(row);
 }
 const report={failedImages,method:'Local static servers; cold browser contexts; Chrome CPU 4x; exact public catalog/images replayed; product API delay 600ms; five runs per version/width; p75. web-vitals reference implementation; synthetic interaction INP, not real-user field data.',summary,runs};
 await writeFile(path.join(out,'performance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser.close()}
