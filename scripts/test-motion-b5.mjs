/** Local B4/B5 motion acceptance; API snapshots only, no remote writes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const require=createRequire(path.join(process.env.EGE_BROWSER_TOOLS||'/private/tmp/ege-storefront-browser','package.json'));
const {chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const out=path.resolve('.scratch/b5'),catalog=JSON.parse(await readFile(out+'/catalog.json')),details=JSON.parse(await readFile(out+'/details-corrected.json'));
const before=process.env.EGE_MOTION_BEFORE||'http://127.0.0.1:4390',after=process.env.EGE_MOTION_ORIGIN||'http://127.0.0.1:4391';
for(const url of [before,after])assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
await mkdir(out+'/screenshots',{recursive:true});
const images=new Map();for(const url of [...new Set([...catalog.products.map(p=>p.imageUrl),...Object.values(details).flatMap(d=>d.product?.gallery?.map(g=>g.url)||[])].filter(Boolean))]){const file=out+'/image-cache/'+createHash('sha256').update(url).digest('hex');try{images.set(url,{body:await readFile(file),...JSON.parse(await readFile(file+'.json'))})}catch{/* unknown assets use their actual read-only URL */}}
const browser=await chromium.launch({headless:true,executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[];
const productId='airy-12000-btu-h',ids=[productId,...Object.keys(details).filter(id=>id!==productId).slice(0,3)];
const pages=[['home','/'],['catalog','/catalog.html'],['product','/product.html?id='+productId],['compare','/compare.html']];
async function ready(page,kind){await page.waitForFunction(()=>document.querySelector('header'));if(kind==='home')await page.waitForFunction(()=>document.querySelector('.premium-product-grid .product:not(.product-skeleton)'));if(kind==='catalog')await page.waitForFunction(()=>document.querySelector('[data-products]')?.getAttribute('aria-busy')==='false');if(kind==='product')await page.locator('.pd-title h1').waitFor();if(kind==='compare')await page.waitForFunction(()=>document.querySelector('.premium-compare')&&!document.querySelector('.compare-status')?.textContent.includes('yükleniyor'));await page.evaluate(()=>document.fonts.ready)}
async function audit(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),await page.evaluate(()=>innerWidth));const a=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[])}
try{
 for(const width of (process.env.EGE_MOTION_WIDTHS?process.env.EGE_MOTION_WIDTHS.split(',').map(Number):[320,375,768,1024,1440])){
  const context=await browser.newContext({viewport:{width,height:960}});await context.addCookies([{name:'ege_analytics_consent',value:'0',url:after}]);
  await context.addInitScript(ids=>{if(localStorage.getItem('ege-compare')===null)localStorage.setItem('ege-compare',JSON.stringify(ids));},ids);
  let broken=false,phase='initial';const errors=[],writes=[];
  await context.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());if(req.method()!=='GET'){writes.push(u.pathname);return route.fulfill({status:204})}if(u.pathname==='/api/products')return route.fulfill({json:catalog});if(u.pathname.endsWith('/reviews'))return route.fulfill({json:{reviews:[],summary:{count:0,average:null,distribution:{1:0,2:0,3:0,4:0,5:0}},nextCursor:null}});const detail=details[decodeURIComponent(u.pathname.replace('/api/products/',''))];return route.fulfill({json:detail||{products:[],posts:[],documents:[]}})});
  await context.route(/^https:\/\//,route=>broken?route.fulfill({status:404,body:''}):images.has(route.request().url())?route.fulfill(images.get(route.request().url())):route.continue());
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',phase,page.url(),e.message)});
  for(const [version,origin] of [['before',before],['after',after]])for(const [kind,url] of pages){
   phase='screenshot-'+version+'-'+kind;await page.goto(origin+url);await ready(page,kind);await page.waitForTimeout(220);
   if(version==='after')await audit(page);
   await page.screenshot({path:`${out}/screenshots/${kind}-${version}-${width}.png`,fullPage:true});await page.screenshot({path:`${out}/screenshots/${kind}-${version}-${width}-viewport.png`});
  }
  phase='catalog-actions';await page.goto(after+'/catalog.html');await ready(page,'catalog');
  // Hover changes visual position, never the grid's layout or the following card's geometry.
  const cards=page.locator('[data-products] .product'),card=cards.first(),next=cards.nth(1);assert.ok(await card.evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(t=>Math.abs(parseFloat(t)-.16)<.001)));assert.ok(await card.locator('.icon-toggle').first().evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(t=>Math.abs(parseFloat(t)-.12)<.001)));const old=await next.boundingBox();await card.hover();await page.waitForTimeout(180);const now=await next.boundingBox();assert.ok(Math.abs(old.y-now.y)<1&&Math.abs(old.height-now.height)<1);
  const toggle=card.locator('[data-action=toggle-compare]');await toggle.focus();const pressed=await toggle.getAttribute('aria-pressed');await page.keyboard.press('Enter');assert.notEqual(await toggle.getAttribute('aria-pressed'),pressed);await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-pressed'),pressed);assert.ok(await page.locator('.toast.show').isVisible());assert.equal(await page.locator('.toast').getAttribute('role'),'status');
  if(width<=1000){const open=page.locator('[data-action=toggle-filters]');await open.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.equal(await open.getAttribute('aria-expanded'),'false');assert.ok(await open.evaluate(e=>e===document.activeElement));assert.equal(await page.locator('.catalog-filters').evaluate(e=>getComputedStyle(e).visibility),'hidden')}
  if(width<1024){const open=page.locator('.store-nav > .menu-toggle');await open.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.equal(await open.getAttribute('aria-expanded'),'false');assert.ok(await open.evaluate(e=>e===document.activeElement));assert.equal(await page.locator('.nav-bar').evaluate(e=>getComputedStyle(e).visibility),'hidden')}
  // Cross-document navigation and back/forward preserve the URL and restored scroll position.
  await page.evaluate(()=>{history.scrollRestoration='auto';scrollTo(0,700)});await card.locator('h3 a').scrollIntoViewIfNeeded();const saved=await page.evaluate(()=>scrollY);const href=await card.locator('h3 a').getAttribute('href');
  phase='product-navigation';await card.locator('h3 a').click();await page.waitForURL('**/product.html?id=*');await ready(page,'product');const nativeTransition=await page.evaluate(()=>document.getAnimations().some(animation=>String(animation.effect?.pseudoElement||'').includes('view-transition')));
  phase='back';await page.goBack();await ready(page,'catalog');await page.waitForTimeout(250);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-saved)<3,'back restores scroll');phase='forward';await page.goForward();await ready(page,'product');assert.ok(page.url().endsWith(href));
  phase='compare-navigation';await page.getByRole('link',{name:'Karşılaştırma listesi',exact:true}).click();await page.waitForURL('**/compare.html');await ready(page,'compare');
  // Disabling native transitions still follows ordinary links; no JS navigation layer.
  await page.waitForTimeout(160);phase='fallback';await page.addStyleTag({content:'@view-transition{navigation:none}'});await page.locator('.brand').first().click();await page.waitForURL(after+'/');await ready(page,'home');
  await page.waitForTimeout(160);phase='reduced-motion';await page.emulateMedia({reducedMotion:'reduce'});await page.goto(after+'/catalog.html');await ready(page,'catalog');await card.hover();assert.equal(await card.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');assert.equal(await card.evaluate(e=>getComputedStyle(e).transform),'none');
  await page.goto(after+'/product.html?id='+productId);await ready(page,'product');await page.locator('.gallery-thumb').first().focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.gallery-thumb').nth(1).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.detail-image').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  if(width===375){broken=true;for(const id of Object.keys(details).filter(id=>id!==productId)){await page.goto(after+'/product.html?id='+encodeURIComponent(id));await page.locator('.detail-visual .product-image-unavailable').waitFor();assert.equal(await page.locator('.detail-image').isVisible(),false);assert.match(await page.locator('.detail-visual').innerText(),/Doğrulanmış ürün görseli mevcut değil/)}broken=false}
  assert.deepEqual(errors,[]);assert.ok(writes.every(url=>url==='/api/analytics/event'));
  results.push({width,status:'PASS',axe:0,keyboard:'PASS',motion:'PASS',reducedMotion:'PASS',historyAndScroll:'PASS',fallbackNavigation:'PASS',nativeTransitionObserved:nativeTransition,officialImageFailures:width===375?11:'NOT_APPLICABLE'});console.log('PASS',width);await context.close();
 }
 await writeFile(out+(process.env.EGE_MOTION_WIDTHS?'/motion-subset-results.json':'/motion-results.json'),JSON.stringify(results,null,2));
}finally{await browser.close()}
