/** H1 link-to-detail/cart regression with captured public GET responses; no database writes. */
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile,mkdir}from'node:fs/promises';import path from'node:path';
assert.ok(process.env.EGE_BROWSER_TOOLS);const require=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS),'package.json'));const{chromium,firefox,webkit}=require('playwright');
const input=process.env.EGE_H1_INPUT||'.scratch/h1/inputs',out=process.env.EGE_H1_OUTPUT||'.scratch/h1/browser';await mkdir(out,{recursive:true});
const catalog=JSON.parse(await readFile(`${input}/catalog.json`,'utf8')),detail=JSON.parse(await readFile(`${input}/airy-detail.json`,'utf8'));const template=await readFile('public/product.html','utf8');
const origin=process.env.EGE_H1_ORIGIN||'http://127.0.0.1:4387';assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));const results=[];
for(const[engine,type]of[['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
const b=await type.launch({headless:true,...(engine==='chrome'?{executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});try{for(const width of[375,1440]){
const c=await b.newContext({viewport:{width,height:960},ignoreHTTPSErrors:new URL(origin).protocol==='https:'});c.setDefaultTimeout(15000);const writes=[];
await c.route('**/api/**',r=>{const q=r.request(),p=new URL(q.url()).pathname;if(q.method()!=='GET'){writes.push(p);return r.fulfill({status:204})}return r.fulfill({json:p==='/api/products'?catalog:p===`/api/products/${detail.product.id}`?detail:p.endsWith('/reviews')?{reviews:[],summary:{count:0,average:null}}:{products:[],documents:[],posts:[]}})});
// SSR SEO endpoint needs a DB. This UI-only test serves the unchanged product template and public detail response.
await c.route(`${origin}/product.html?*`,r=>r.fulfill({contentType:'text/html',body:template}));
const p=await c.newPage();await p.goto(origin,{waitUntil:'networkidle'});await p.locator('[data-cookie-reject]').click();await p.locator('[data-hc-pause]').click();await p.locator('[data-hero-cart]:not([disabled])').click();
await p.locator('[data-hero-link]').click();await p.waitForURL(`**/product.html?id=${detail.product.id}`);await p.locator('[data-product-page] h1').waitFor();assert.equal(await p.locator('[data-product-page] h1').textContent(),detail.product.name);await p.goBack();
await p.locator('.header-cart').click();await p.waitForURL('**/checkout.html');await p.locator('[data-cart-items]').waitFor();assert.match(await p.locator('[data-cart-items]').innerText(),new RegExp(detail.product.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(await p.locator('[data-submit-order]').isDisabled(),true,'no legal preview/order submission in UI-only fixture');
await p.goBack();await p.locator('#site-search').fill('Airy 12000');await p.locator('#site-search').press('Enter');await p.waitForURL('**/catalog.html?q=*');assert.equal(new URL(p.url()).searchParams.get('q'),'Airy 12000');
assert.ok(writes.every(x=>x==='/api/analytics/event'));results.push({engine,width,status:'PASS',detailLinkAndRendering:'PASS',cartCheckoutSummary:'PASS',search:'PASS',orderSubmitted:false,scope:'UI with public GET fixtures; SSR product SEO and backend checkout not tested'});console.log('PASS journey',engine,width);await writeFile(`${out}/journeys.json`,JSON.stringify(results,null,2));await c.close();
}}finally{await b.close()}}
await writeFile(`${out}/journeys.json`,JSON.stringify(results,null,2));
