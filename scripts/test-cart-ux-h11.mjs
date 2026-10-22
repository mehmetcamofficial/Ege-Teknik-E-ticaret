/** H1.1 local browser acceptance; all API writes stay intercepted. No hosted order creation. */
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile,mkdir}from'node:fs/promises';import path from'node:path';
assert.ok(process.env.EGE_BROWSER_TOOLS);const require=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS),'package.json'));const{chromium,firefox,webkit}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const origin=process.env.EGE_H11_ORIGIN||'https://127.0.0.1:44391';assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const input=process.env.EGE_H11_INPUT||'.scratch/h11/inputs',out=process.env.EGE_H11_OUTPUT||'.scratch/h11/browser';await mkdir(out,{recursive:true});
const real=JSON.parse(await readFile(`${input}/catalog.json`,'utf8')),detail=JSON.parse(await readFile(`${input}/airy-detail.json`,'utf8')),template=await readFile('public/product.html','utf8');
const black=real.products.find(p=>p.id==='airy-12000-btu-h-siyah-81'),white=real.products.find(p=>p.id==='airy-12000-btu-h');assert.ok(black&&white);
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(n);
const results={engines:[],matrix:[],negative:[],selector:[],writes:[],axeScans:0};
async function save(){await writeFile(`${out}/results.json`,JSON.stringify(results,null,2))}
async function audit(p,label){const r=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],label);results.axeScans++}
async function context(b,width){const c=await b.newContext({viewport:{width,height:960},ignoreHTTPSErrors:true}),state={mode:'ready',catalog:structuredClone(real)},errors=[];
 c.setDefaultTimeout(15000);c.setDefaultNavigationTimeout(45000);
 await c.route('**/api/**',async r=>{const q=r.request(),url=new URL(q.url());assert.equal(url.origin,origin);
  if(q.method()!=='GET'){results.writes.push({method:q.method(),path:url.pathname});return r.fulfill({status:204})}
  if(url.pathname==='/api/products'){if(state.mode==='slow')await new Promise(resolve=>setTimeout(resolve,1300));return r.fulfill({status:state.mode==='error'?503:200,json:state.catalog})}
  if(url.pathname===`/api/products/${black.id}`)return r.fulfill({json:detail});
  if(url.pathname.endsWith('/reviews'))return r.fulfill({json:{reviews:[],summary:{count:0,average:null}}});
  if(url.pathname==='/api/legal/required')return r.fulfill({json:{documents:[{slug:'distance-sales',title:'Sentetik test hukuk metni',versionId:'synthetic-legal-version'}]}});
  return r.fulfill({json:{products:[],posts:[],documents:[],shipping:{status:'pending'},serviceProvinces:['Aydın'],locations:{Aydın:['Kuşadası']},deliveryTraits:{}}});
 });
 await c.route(`${origin}/product.html?*`,r=>r.fulfill({contentType:'text/html',body:template}));const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));return{c,p,state,errors};}
async function home(p){await p.goto(origin,{waitUntil:'networkidle'});const reject=p.locator('[data-cookie-reject]');if(await reject.count())await reject.click();const pause=p.locator('[data-hc-pause]');if(await pause.getAttribute('aria-label')==='Otomatik geçişi durdur')await pause.click()}
async function readyDrawer(p){await p.locator('dialog[open] [data-drawer-checkout]:visible').waitFor()}
async function selector(p){await p.goto(`${origin}/selector.html`,{waitUntil:'networkidle'});await p.locator('[name=area]').fill('35');await p.locator('[name=city]').fill('Aydın');await p.locator('[name=district]').fill('Kuşadası');await p.getByRole('button',{name:'Devam et',exact:true}).click()}
try{
for(const[engine,type]of[['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
 if(process.env.EGE_H11_ENGINES&&!process.env.EGE_H11_ENGINES.split(',').includes(engine))continue;
 const b=await type.launch({headless:true,...(engine==='chrome'?{executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',ignoreDefaultArgs:['--disable-back-forward-cache']}:{})});results.engines.push({engine,version:b.version()});
 try{
  for(const width of(process.env.EGE_H11_NEGATIVE_ONLY?[]:[1440,1024,768,390,320])){
   const{p,c,errors}=await context(b,width);await home(p);await p.locator('[data-hero-cart]:not([disabled])').click();await readyDrawer(p);console.log('CHECK',engine,width,'drawer ready');
   assert.equal(await p.getByRole('dialog').count(),1);assert.equal(await p.locator('dialog').getAttribute('aria-modal'),'true');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('data-drawer-close')!==null),true);
   await p.keyboard.press('Shift+Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('dialog')),true);await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('dialog')),true);
   assert.equal(await p.locator('[data-cart-count]').first().textContent(),'1');assert.equal(await p.locator('[data-drawer-subtotal]').textContent(),money(black.price));
   await p.locator('[data-drawer-action=step][data-step="1"]').click();assert.equal(await p.locator('[data-drawer-action=quantity]').inputValue(),'2');assert.equal(await p.locator('[data-drawer-subtotal]').textContent(),money(black.price*2));
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);
   await audit(p,`${engine} ${width} drawer`);await p.screenshot({path:`${out}/drawer-${engine}-${width}.png`});
   await p.keyboard.press('Escape');assert.equal(await p.locator('dialog').isVisible(),false);await p.waitForFunction(()=>document.activeElement.matches('[data-hero-cart]'));assert.equal(await p.locator('[data-hero-cart]').evaluate(e=>e===document.activeElement),true);
   await p.locator('[data-action=hero-tone][data-tone=beyaz]').click();await p.locator('[data-hero-cart]').click();await readyDrawer(p);assert.equal(await p.locator('.cart-drawer-item').count(),2);assert.equal(await p.locator('[data-drawer-subtotal]').textContent(),money(black.price*2+white.price));
   await p.locator('[data-drawer-checkout]').click();await p.waitForURL('**/checkout.html');assert.ok((await p.locator('[data-cart-items]').innerText()).includes(black.name));assert.equal(await p.locator('[data-submit-order]').isDisabled(),true);
   // Exercise the actual legal invalidation boundary on a checked browser control; no signed/order POST fixture.
   await p.locator('[data-legal-version]').evaluateAll(nodes=>nodes.forEach(e=>{e.disabled=false;e.checked=true}));
   await p.locator('.header-cart,[data-open-cart-drawer]').first().click();await readyDrawer(p);await p.locator(`[data-drawer-action=step][data-step="1"][data-cart-id="${white.id}"]`).click();await p.keyboard.press('Escape');
   assert.equal(await p.locator('[data-legal-version]:checked').count(),0);assert.equal(await p.locator('[data-legal-version]:not([disabled])').count(),0);
   await p.locator('.header-cart,[data-open-cart-drawer]').first().click();await readyDrawer(p);await p.locator(`[data-drawer-action=remove][data-cart-id="${white.id}"]`).click();assert.equal(await p.locator('.cart-drawer-item').count(),1);await p.keyboard.press('Escape');
   await p.locator('[name=customerName]').fill('Sentetik Örnek');await p.locator('[name=address]').fill('Sentetik test adresi');
   if(engine==='chrome')await p.screenshot({path:`${out}/checkout-${width}.png`});await p.locator('.brand').first().click();await p.waitForURL(origin+'/');await p.goBack({waitUntil:'commit'});await p.waitForFunction(()=>document.querySelector('[name=customerName]')?.value==='Sentetik Örnek');assert.equal(await p.locator('[name=customerName]').inputValue(),'Sentetik Örnek','native history restores form');
   assert.equal(await p.locator('[name=address]').inputValue(),'Sentetik test adresi');console.log('CHECK',engine,width,'form history restored');
   await p.goto(`${origin}/catalog.html?q=Airy&stock=in&sort=price-asc`,{waitUntil:'networkidle'});await p.locator('.brand').first().click();await p.goBack({waitUntil:'commit'});assert.equal(new URL(p.url()).searchParams.get('q'),'Airy');await p.waitForFunction(()=>document.querySelector('#catalog-search')?.value==='Airy');assert.equal(await p.locator('#catalog-search').inputValue(),'Airy');
   await p.emulateMedia({reducedMotion:'reduce'});await p.locator('.header-cart,[data-open-cart-drawer]').first().click();await readyDrawer(p);assert.equal(await p.locator('dialog').evaluate(e=>getComputedStyle(e).animationName),'none');await p.keyboard.press('Escape');
   await selector(p);await audit(p,`${engine} ${width} selector step 2`);if(engine==='chrome')await p.screenshot({path:`${out}/selector-${width}.png`});
   await p.getByRole('button',{name:'Devam et',exact:true}).click();await p.getByRole('button',{name:'Ön değerlendirmeyi gör',exact:true}).click();await p.locator('[data-climate-result].show').waitFor();await audit(p,`${engine} ${width} selector results`);if(engine==='chrome')await p.screenshot({path:`${out}/recommendation-${width}.png`,fullPage:true});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);assert.deepEqual(errors,[]);
   results.matrix.push({engine,width,status:'PASS',axe:'PASS',cartDrawerQuantityRemove:'PASS',checkoutUiAndLegalInvalidation:'PASS',cartAcrossPages:'PASS',nativeFormHistory:'PASS',filterHistory:'PASS',focusTrapEscape:'PASS',reducedMotion:'PASS',selectorContrast:'PASS'});await save();console.log('PASS matrix',engine,width);await c.close();
  }
  // Negative scenarios use local copies of public catalog data; never mutate a database or shipped price.
  const{p,c,state}=await context(b,390);await home(p);assert.equal(await p.evaluate(()=>window.addCart('fabricated-variant')),false);assert.equal(await p.locator('dialog').isVisible(),false);
  state.mode='error';await p.reload({waitUntil:'networkidle'});assert.equal(await p.evaluate(id=>window.addCart(id),black.id),false);assert.equal(await p.locator('dialog').isVisible(),false);
  state.mode='ready';await home(p);await p.locator('[data-hero-cart]:not([disabled])').click();await readyDrawer(p);
  const updated=state.catalog.products.find(x=>x.id===black.id);updated.price=black.price+100;updated.stock=2;updated.sku='';
  await p.keyboard.press('Escape');await p.locator('.header-cart,[data-open-cart-drawer]').first().click();await readyDrawer(p);assert.equal(await p.locator('[data-drawer-subtotal]').textContent(),money(black.price+100));assert.match(await p.locator('.cart-drawer-info').innerText(),/varyant kodu paylaşılmamış/);
  await p.locator('[data-drawer-action=step][data-step="1"]').click();assert.equal(await p.locator('[data-drawer-action=step][data-step="1"]').isDisabled(),true);
  await p.locator('[data-drawer-action=quantity]').fill('3');await p.locator('[data-drawer-action=quantity]').press('Enter');await p.locator('[data-drawer-close]').first().focus();assert.equal(await p.locator('[data-drawer-action=quantity]').inputValue(),'2');
  await p.keyboard.press('Escape');updated.stock=0;await p.locator('.header-cart,[data-open-cart-drawer]').first().click();await p.locator('.cart-drawer-warning').waitFor();assert.equal(await p.locator('[data-drawer-checkout]').isVisible(),false);await p.locator('[data-drawer-action=remove]').click();assert.equal(await p.locator('.cart-drawer-item').count(),0);await p.keyboard.press('Escape');
  updated.stock=2;await home(p);await p.locator('[data-hero-cart]:not([disabled])').click();await readyDrawer(p);await p.keyboard.press('Escape');
  state.mode='slow';await p.locator('.header-cart').click();await p.locator('.cart-drawer-body[aria-busy="true"]').waitFor();assert.equal(await p.locator('[data-drawer-checkout]').isVisible(),false);await readyDrawer(p);await p.keyboard.press('Escape');
  state.mode='error';await p.locator('.header-cart').click();await p.locator('[data-drawer-retry]').waitFor();assert.equal(await p.locator('.cart-drawer-body').getAttribute('aria-busy'),'false');assert.equal(await p.locator('[data-drawer-subtotal]').textContent(),'—');await audit(p,`${engine} API error`);
  state.mode='ready';await p.locator('[data-drawer-retry]').click();await readyDrawer(p);await p.keyboard.press('Escape');
  await p.goto(`${origin}/checkout.html`,{waitUntil:'networkidle'});await p.locator('[name=customerName]').fill('Sentetik Örnek');const timeOrigin=await p.evaluate(()=>performance.timeOrigin);await p.locator('[data-open-cart-drawer]').click();await readyDrawer(p);await p.locator('[data-drawer-checkout]').click();assert.equal(await p.evaluate(()=>performance.timeOrigin),timeOrigin);assert.equal(await p.locator('[name=customerName]').inputValue(),'Sentetik Örnek');await p.locator('[data-legal-version]').evaluateAll(nodes=>nodes.forEach(e=>{e.disabled=false;e.checked=true}));
  const other=await c.newPage();await other.goto(`${origin}/catalog.html`,{waitUntil:'networkidle'});assert.equal(await other.evaluate(id=>window.changeCartQuantity(id,2),black.id),true);await p.waitForFunction(()=>document.querySelectorAll('[data-legal-version]:checked').length===0);assert.equal(await p.locator('[data-legal-version]:not([disabled])').count(),0);assert.equal(await other.locator('[data-cart-count]').first().textContent(),'2');await other.close();
  await home(p);assert.equal(await p.evaluate(id=>window.changeCartQuantity(id,1),black.id),true);await p.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='ege-cart')throw new Error('Synthetic blocked storage');return original.call(this,k,v)}});assert.equal(await p.evaluate(id=>window.addCart(id),black.id),false);assert.equal(await p.locator('dialog').isVisible(),false);
  results.negative.push({engine,status:'PASS',unknownVariant:'PASS',apiFailure:'PASS',freshPrice:'PASS',missingVariantLabel:'PASS',stockReduction:'PASS',overstock:'PASS',storageFailureNoSuccess:'PASS',loadingAndRetry:'PASS',crossTabLegalInvalidation:'PASS',sameCheckoutFormPreservation:'PASS'});await save();await c.close();
 }finally{await b.close()}
}
assert.ok(results.writes.every(x=>x.path==='/api/analytics/event'&&x.method==='DELETE'),'no order/payment/service POST or consentless analytics');await save();console.log('H1.1 browser acceptance PASS');
}catch(e){results.failure=String(e);await save();throw e}
