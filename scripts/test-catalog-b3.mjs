/** Local-only browser regression, screenshot and accessibility checks. See docs/storefront-b3.md. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS||'/private/tmp/ege-storefront-browser'),'package.json'));
const {chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const catalog=JSON.parse(await readFile(process.env.EGE_STOREFRONT_CATALOG||'/private/tmp/ege-storefront-browser/catalog-readonly.json','utf8'));
const origin=new URL(process.env.EGE_CATALOG_ORIGIN||'http://127.0.0.1:4384');assert.ok(['127.0.0.1','localhost'].includes(origin.hostname));
const out=path.resolve('.scratch/b3');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const results=[];
async function pause(page){await page.waitForTimeout(240)}
async function rendered(page){await page.waitForFunction(()=>document.querySelector('[data-products]')?.getAttribute('aria-busy')==='false')}
async function snap(page,name){const h=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<h;y+=720){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(60)}await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.complete?null:new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,2000)}))));await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/${name}.png`,fullPage:true});await page.screenshot({path:`${out}/${name}-viewport.png`})}
try{
 for(const width of [320,375,768,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:960}});let state='ready',apiCalls=0;const writes=[];
  await context.route('**/api/**',async route=>{const request=route.request(),u=new URL(request.url());if(request.method()!=='GET'){writes.push(u.pathname);return route.fulfill({status:204})}if(u.pathname==='/api/products'){apiCalls++;if(state==='slow')await new Promise(resolve=>setTimeout(resolve,1200));return route.fulfill({status:state==='error'?503:200,json:state==='empty'?{products:[]}:catalog})}return route.fulfill({json:{posts:[],products:[],documents:[]}})});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('/catalog.html',origin).href);await rendered(page);await page.getByRole('button',{name:'Yalnızca gerekli',exact:true}).click();
  await snap(page,`after-${width}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'no horizontal overflow');
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`axe ${width}`);
  assert.equal(await page.locator('[data-catalog-filter=energy]').isDisabled(),!catalog.products.some(p=>p.energyClass));
  assert.equal(await page.locator('[data-newest-option]').evaluate(e=>e.disabled),new Set(catalog.products.map(p=>p.createdAt)).size<2);
  await page.locator('#catalog-search').focus();assert.equal(await page.locator('#catalog-search').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  await page.locator('#catalog-search').pressSequentially('12000 Airy',{delay:20});await pause(page);
  assert.equal(new URL(page.url()).searchParams.get('q'),'12000 Airy');
  assert.ok(await page.locator('[data-products] .product').count()>0);
  assert.equal(apiCalls,1,'typing must use cached catalog');
  const open=async()=>{if(width<=1000){await page.locator('[data-action=toggle-filters]').click();await page.locator('.catalog-filters.open').waitFor()}};
  const close=async()=>{if(width<=1000)await page.locator('[data-action=close-filters].primary').click()};
  await open();
  if(width<=1000){
   assert.equal(await page.locator('.catalog-results').evaluate(e=>e.inert),true);
   const closeButton=page.locator('.filters-close');await closeButton.focus();await page.keyboard.press('Shift+Tab');assert.ok(await page.evaluate(()=>!!document.activeElement.closest('.catalog-filters')));await page.keyboard.press('Tab');assert.ok(await closeButton.evaluate(e=>e===document.activeElement));
   const auditOpen=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(auditOpen.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
   await page.screenshot({path:`${out}/filters-${width}.png`});await page.keyboard.press('Escape');assert.ok(await page.locator('[data-action=toggle-filters]').evaluate(e=>e===document.activeElement));await open();
  }
  await page.locator('[data-catalog-filter=brand]').selectOption('gree');await page.locator('[data-catalog-filter=series]').selectOption('Airy');await page.locator('[data-btu="12000"]').click();await page.locator('[data-catalog-filter=stock]').selectOption('available');
  await page.locator('[data-catalog-filter=min]').fill('100');await page.locator('[data-catalog-filter=max]').fill('999999');await page.locator('[data-catalog-filter=max]').press('Tab');await close();await pause(page);
  assert.ok(await page.locator('[data-products] .product').count()>0);const filtered=new URL(page.url());for(const key of ['brand','series','btu','stock','min','max','q'])assert.ok(filtered.searchParams.has(key),key);
  await page.locator('[data-catalog-filter=sort]').selectOption('price-asc');const sorted=page.url();await page.goBack();await pause(page);assert.equal(new URL(page.url()).searchParams.get('sort'),null);await page.goForward();await pause(page);assert.equal(page.url(),sorted);
  const actualNames=await page.locator('[data-products] h3').allTextContents();const expected=catalog.products.filter(p=>p.series==='Airy'&&p.capacity==='12000 BTU/h'&&p.saleMode==='online'&&p.stock>0&&p.price>=100&&p.price<=999999).sort((a,b)=>a.price-b.price).map(p=>p.name);assert.deepEqual(actualNames,expected);
  await page.reload();await rendered(page);assert.deepEqual(await page.locator('[data-products] h3').allTextContents(),expected,'share URL reload');
  await page.locator('[data-active-filters] [data-action=clear-catalog]').click();await pause(page);assert.equal(new URL(page.url()).search,'');
  await page.locator('#catalog-search').fill('Ariy');await page.locator('#catalog-search').press('Enter');await page.getByRole('button',{name:'Airy',exact:true}).click();assert.equal(await page.locator('#catalog-search').inputValue(),'Airy');
  await page.locator('#catalog-search').fill('<img src=x onerror=alert(1)>');await page.locator('#catalog-search').press('Enter');assert.equal(await page.locator('[data-products] img[src=x]').count(),0);assert.equal(await page.locator('[data-products] .product').count(),0);
  await page.locator('[data-products] [data-action=clear-catalog]').click();
  // Invalid price bounds must explain the problem instead of silently broadening results.
  await open();await page.locator('[data-catalog-filter=min]').fill('90000');await page.locator('[data-catalog-filter=max]').fill('100');await page.locator('[data-catalog-filter=max]').press('Tab');await pause(page);assert.match(await page.locator('[data-price-error]').innerText(),/büyük olamaz/);await close();assert.equal(await page.locator('[data-products] .product').count(),0);
  await page.locator('[data-products] [data-action=clear-catalog]').click();
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-products] .product').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  state='error';await page.reload();await rendered(page);await page.getByRole('button',{name:'Yeniden dene',exact:true}).waitFor();assert.equal(await page.locator('[data-products] .price').count(),0);
  state='ready';await page.getByRole('button',{name:'Yeniden dene',exact:true}).click();await rendered(page);assert.ok(await page.locator('[data-products] .product').count()>0);
  state='empty';await page.reload();await rendered(page);assert.equal(await page.locator('[data-products] .product').count(),0);assert.ok(await page.getByRole('button',{name:'Filtreleri temizle',exact:true}).isVisible());
  state='slow';await page.goto(new URL('/catalog.html',origin).href,{waitUntil:'domcontentloaded'});assert.equal(await page.locator('[data-products]').getAttribute('aria-busy'),'true');assert.equal(await page.locator('.product-skeleton').count(),6);await rendered(page);
  assert.deepEqual(errors,[]);assert.ok(writes.every(p=>p==='/api/analytics/event'));
  results.push({width,status:'PASS',axe:0,keyboard:'PASS',searchAndHistory:'PASS',combinedFilters:'PASS',networkStates:'PASS'});console.log(`PASS ${width}`);await context.close();
 }
 await writeFile(`${out}/browser-results.json`,JSON.stringify(results,null,2));
}finally{await browser.close()}
