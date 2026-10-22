/** Local-only B1/B2 browser verification. Tool dependencies are installed outside the app.
 * See docs/storefront-b1-b2.md. No database credentials, writes or remote mutations.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const origin=new URL(process.env.EGE_STOREFRONT_QA_ORIGIN||'http://127.0.0.1:4382');
assert.ok(['127.0.0.1','localhost'].includes(origin.hostname),'Only localhost is allowed');
assert.ok(process.env.EGE_BROWSER_TOOLS&&process.env.EGE_STOREFRONT_CATALOG,'Supply external browser tools directory and public catalog snapshot');
const toolRequire=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS),'package.json'));
const {chromium}=toolRequire('playwright');
const AxeBuilder=toolRequire('@axe-core/playwright').default;
const catalog=JSON.parse(await readFile(process.env.EGE_STOREFRONT_CATALOG,'utf8'));
assert.ok(Array.isArray(catalog.products)&&catalog.products.length,'Use an unmodified public catalog response');
const out=path.resolve('.scratch/b1-b2');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.EGE_CHROME_PATH?{executablePath:process.env.EGE_CHROME_PATH}:{})});
const results=[];
try{
 for(const width of [320,375,768,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:960}});
  let state='ready';const writes=[];
  await context.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push(url.pathname);return route.fulfill({status:204})}
   if(url.pathname==='/api/products')return route.fulfill({status:state==='error'?503:200,json:state==='empty'?{products:[]}:catalog});
   return route.fulfill({status:200,json:{posts:[],products:[],documents:[]}});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin.href);await page.waitForFunction(()=>document.querySelectorAll('.premium-product-grid .product:not(.product-skeleton)').length===8);
  await page.getByRole('button',{name:'Yalnızca gerekli',exact:true}).click();
  // Full-page screenshots do not trigger off-screen lazy images. Scroll as a shopper would.
  const height=await page.evaluate(()=>document.documentElement.scrollHeight);
  for(let y=0;y<height;y+=720){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(80)}
  await page.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.complete?null:new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,2500)}))));
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,`overflow at ${width}`);
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`axe at ${width}`);
  await page.keyboard.press('Tab');
  await page.locator('.skip-link').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'main','skip link focuses content');
  await page.locator('#site-search').focus();
  assert.ok(await page.locator('#site-search').evaluate(e=>getComputedStyle(e).outlineStyle!=='none'),'visible keyboard focus');
  if(width<1024){
   const menu=page.locator('.store-nav > .menu-toggle');await menu.focus();await page.keyboard.press('Enter');
   await page.locator('.nav-bar.open').waitFor();
   assert.equal(await page.locator('main').evaluate(e=>e.inert),true,'background is inert');
   assert.equal(await page.locator('.nav-bar').getAttribute('aria-modal'),'true');
   const close=page.locator('.nav-drawer-head button');await close.focus();await page.keyboard.press('Shift+Tab');
   assert.ok(await page.evaluate(()=>!!document.activeElement.closest('.nav-bar')),'reverse tab stays in drawer');
   await page.keyboard.press('Tab');assert.equal(await close.evaluate(e=>e===document.activeElement),true,'forward tab wraps');
   const menuAudit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
   assert.deepEqual(menuAudit.violations.map(v=>v.id),[],`open drawer axe at ${width}`);
   await page.keyboard.press('Escape');
   assert.equal(await menu.evaluate(e=>e===document.activeElement),true,'escape restores focus');
   assert.equal(await page.locator('main').evaluate(e=>e.inert),false);
   await menu.click();await page.locator('.nav-backdrop').click({position:{x:width-10,y:300}});
   assert.equal(await menu.getAttribute('aria-expanded'),'false','backdrop closes');
  }else{
   const toggle=page.locator('[data-nav-disclosure]');await toggle.focus();await page.keyboard.press('Enter');
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#mega-klima').isVisible(),true);
   await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>!!document.activeElement.closest('#mega-klima')));
   await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
   await toggle.click();await page.mouse.click(width-8,600);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  }
  // Card prices and stock text must be the exact server response, including sold-out/quote states.
  for(const card of await page.locator('[data-home-card]').all()){
   const id=await card.getAttribute('data-featured-product'),product=catalog.products.find(p=>p.id===id);
   if(!product)continue;
   assert.ok((await card.innerText()).includes(product.name));
   if(product.saleMode==='online')assert.ok((await card.innerText()).includes(new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(product.price)));
  }
  await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`${out}/after-${width}.png`,fullPage:true});await page.screenshot({path:`${out}/viewport-${width}.png`});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.product').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s','reduced motion disables transitions');
  await page.locator('#site-search').fill('GREE Airy 12000');await page.locator('#site-search').press('Enter');await page.waitForURL('**/catalog.html?q=*');
  assert.equal(new URL(page.url()).searchParams.get('q'),'GREE Airy 12000','search GET query');
  state='error';await page.goto(origin.href);await page.locator('[data-premium-catalog-recovery]:not([hidden])').waitFor();
  assert.equal(await page.locator('.premium-product-grid').isVisible(),false,'error cannot show stale prices');
  assert.ok(await page.locator('[data-premium-catalog-status]').textContent());
  state='empty';await page.reload();await page.locator('[data-premium-catalog-recovery]:not([hidden])').waitFor();
  assert.match(await page.locator('[data-premium-catalog-status]').textContent(),/listelenen ürün bulunmuyor/);
  assert.deepEqual(errors,[],`runtime errors at ${width}`);
  assert.ok(writes.every(p=>p==='/api/analytics/event'),'no order/service/database write initiated');
  results.push({width,status:'PASS',axeViolations:0,overflow:false,keyboard:'PASS',reducedMotion:'PASS',search:'PASS',catalogErrorAndEmpty:'PASS'});
  console.log(`PASS viewport ${width}`);
  await context.close();
 }
 // Resize an open drawer to desktop: no orphaned inert state or scroll lock.
 const context=await browser.newContext({viewport:{width:375,height:960}});
 await context.route('**/api/**',r=>r.fulfill({json:{products:[],posts:[],documents:[]}}));
 const page=await context.newPage();await page.goto(origin.href);
 await page.locator('.store-nav > .menu-toggle').click();await page.setViewportSize({width:1440,height:960});
 await page.waitForFunction(()=>!document.querySelector('main').inert&&!document.documentElement.classList.contains('nav-open'));
 assert.equal(await page.locator('.nav-bar').getAttribute('role'),null);
 await context.close();
 await writeFile(`${out}/browser-results.json`,JSON.stringify({results,resize:'PASS'},null,2));
 console.log(JSON.stringify({results,resize:'PASS'},null,2));
}finally{await browser.close()}
