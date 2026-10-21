/** Local product/gallery/compare acceptance; read-only public snapshots, no database connection. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS||'/private/tmp/ege-storefront-browser'),'package.json'));
const {chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const base=path.resolve('.scratch/b4'),details=JSON.parse(await readFile(base+'/details-corrected.json','utf8')),original=JSON.parse(await readFile(base+'/details.json','utf8'));
const catalog=JSON.parse(await readFile(base+'/catalog.json','utf8')),beforeCatalog=JSON.parse(await readFile(base+'/b3-baseline/catalog.json','utf8'));
const origin=process.env.EGE_PRODUCT_ORIGIN||'http://127.0.0.1:4388',before=process.env.EGE_PRODUCT_BEFORE||'http://127.0.0.1:4387';
for(const url of [origin,before])assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
const browser=await chromium.launch({headless:true,executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[];
await mkdir(base+'/screenshots',{recursive:true});
const ids=['airy-12000-btu-h',...Object.keys(details).filter(id=>id.startsWith('versati')).slice(0,3)];
async function screenshot(page,name){await page.screenshot({path:`${base}/screenshots/${name}.png`,fullPage:true});await page.screenshot({path:`${base}/screenshots/${name}-viewport.png`})}
async function audit(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),await page.evaluate(()=>innerWidth),'no horizontal overflow');const a=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[])}
try{
 for(const width of [320,375,768,1024,1440]){
  let mode='ready',imageFailure=false;const calls=[],errors=[];
  const context=await browser.newContext({viewport:{width,height:960}});await context.addCookies([{name:'ege_analytics_consent',value:'0',url:origin},{name:'ege_analytics_consent',value:'0',url:before}]);
  await context.addInitScript(ids=>{if(localStorage.getItem('ege-compare')===null)localStorage.setItem('ege-compare',JSON.stringify(ids))},ids);
  await context.route('**/api/**',async route=>{const u=new URL(route.request().url()),isBefore=u.origin===before;calls.push({path:u.pathname,method:route.request().method()});if(route.request().method()!=='GET')return route.fulfill({status:204});
   if(u.pathname==='/api/products')return route.fulfill({json:mode==='empty'?{products:[]}:isBefore?beforeCatalog:catalog});
   if(u.pathname.endsWith('/reviews'))return route.fulfill({json:{reviews:[],summary:{count:0,average:null,distribution:{1:0,2:0,3:0,4:0,5:0}},nextCursor:null}});
   const id=decodeURIComponent(u.pathname.replace('/api/products/',''));if(mode==='slow')await new Promise(r=>setTimeout(r,1400));if(mode==='error')return route.fulfill({status:503,json:{error:'Unavailable'}});if(mode==='missing')return route.fulfill({status:404,json:{error:'Not found'}});
   if(details[id])return route.fulfill({status:details[id].status,json:isBefore?original[id]:details[id]});return route.fulfill({json:{products:[],posts:[]}});
  });
  await context.route(/^https:\/\//,route=>imageFailure?route.fulfill({status:404,body:''}):route.continue());
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  for(const [version,url] of [['before',before],['after',origin]]){
   await page.goto(url+'/product.html?id='+ids[0]);await page.locator('.pd-title h1').waitFor();await page.waitForFunction(()=>document.querySelector('.detail-image')?.complete);
   await screenshot(page,`product-${version}-${width}`);
   if(version==='after'){
    await audit(page);const main=page.locator('.detail-image'),src=await main.getAttribute('src');await page.locator('[data-product-quantity]').fill('2');
    await page.locator('.gallery-thumb').first().focus();await page.keyboard.press('ArrowRight');assert.notEqual(await main.getAttribute('src'),src);assert.equal(await page.locator('.gallery-thumb').nth(1).getAttribute('aria-pressed'),'true');assert.ok(await page.locator('.gallery-thumb').nth(1).evaluate(e=>e===document.activeElement));assert.equal(await page.locator('[data-product-quantity]').inputValue(),'2');
    await page.keyboard.press('End');assert.equal(await page.locator('.gallery-thumb').last().getAttribute('aria-pressed'),'true');await page.keyboard.press('Home');assert.equal(await main.getAttribute('src'),src);await page.keyboard.press('Escape');assert.ok(await page.locator('.gallery-thumb').first().evaluate(e=>e===document.activeElement));
    // A failed image preserves the gallery and recovers on the next valid selection.
    imageFailure=true;await main.evaluate(img=>{img.src=img.src+'?b4-failure-test=1'});await page.locator('.detail-visual .product-image-unavailable').waitFor();imageFailure=false;await page.keyboard.press('ArrowRight');await page.keyboard.press('Home');await page.waitForFunction(()=>{const i=document.querySelector('.detail-image');return i&&!i.hidden&&i.complete});assert.equal(await page.locator('.detail-visual .product-image-unavailable').count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await main.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    if(width<=1000){await page.locator('#yorumlar').scrollIntoViewIfNeeded();await page.locator('.pd-sticky.is-visible').waitFor();assert.equal(await page.locator('.pd-sticky').getAttribute('aria-hidden'),'false');assert.equal(await page.locator('.pd-sticky').evaluate(e=>e.inert),false);const action=page.locator('.pd-sticky .primary');await action.focus();await page.keyboard.press('Enter');assert.ok(await page.locator('[data-cart-count]').first().innerText()==='2');await audit(page);await screenshot(page,`sticky-after-${width}`)}
    await page.evaluate(()=>scrollTo(0,0));
   }
   await page.goto(url+'/compare.html');await page.locator('[data-compare] a[href*="product.html"]').first().waitFor();await page.waitForTimeout(250);await screenshot(page,`compare-${version}-${width}`);
  }
  await page.waitForFunction(()=>!document.querySelector('.compare-status')?.textContent.includes('yükleniyor'));await audit(page);assert.equal(await page.locator('.premium-compare thead th').count(),5);
  const differences=page.locator('[data-compare-differences]');await differences.focus();await page.keyboard.press('Enter');assert.equal(await differences.getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.premium-compare tbody tr:not(.is-different)').count(),0);assert.ok(await differences.evaluate(e=>e===document.activeElement));await page.keyboard.press('Enter');
  await page.locator('[data-compare] [data-action=toggle-compare]').first().focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.premium-compare thead th').count(),4);assert.ok(await page.evaluate(()=>document.activeElement.matches('[data-compare] [data-action=toggle-compare]')));
  mode='error';await page.reload();await page.locator('[data-action=retry-compare]').waitFor();assert.ok(await page.locator('.premium-compare').isVisible());mode='ready';await page.locator('[data-action=retry-compare]').click();await page.waitForFunction(()=>!document.querySelector('[data-action=retry-compare]'));
  mode='slow';await page.goto(origin+'/product.html?id='+ids[0],{waitUntil:'domcontentloaded'});await page.locator('.pd-skeleton').waitFor();await page.locator('.pd-title h1').waitFor();
  mode='error';await page.reload();await page.locator('[data-action=retry-product]').waitFor();mode='ready';await page.locator('[data-action=retry-product]').click();await page.locator('.pd-title h1').waitFor();
  mode='missing';await page.reload();await page.locator('.pd-empty-title').waitFor();assert.equal(await page.locator('.pd-buy').count(),0);
  mode='empty';await page.goto(origin+'/compare.html');await page.locator('[data-compare] .empty').waitFor();assert.equal(await page.locator('.premium-compare').count(),0);
  assert.deepEqual(errors,[]);assert.ok(calls.filter(c=>c.method!=='GET').every(c=>c.path==='/api/analytics/event'));
  results.push({width,status:'PASS',axe:0,gallery:'PASS',keyboard:'PASS',sticky:width<=1000?'PASS':'NOT_APPLICABLE',comparison:'PASS',networkStates:'PASS'});console.log('PASS',width);await context.close();
 }
 await writeFile(base+'/browser-results.json',JSON.stringify(results,null,2));
}finally{await browser.close()}
