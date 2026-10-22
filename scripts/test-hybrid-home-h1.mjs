/** H1 browser acceptance. Local app + unmodified public GET catalog snapshot; no remote writes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const origin=process.env.EGE_H1_ORIGIN||'http://127.0.0.1:4387';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
assert.ok(process.env.EGE_BROWSER_TOOLS,'Set EGE_BROWSER_TOOLS to the external Playwright/axe tools directory');
const require=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS),'package.json'));
const {chromium,firefox,webkit}=require('playwright');const AxeBuilder=require('@axe-core/playwright').default;
const input=path.resolve(process.env.EGE_H1_INPUT||'.scratch/h1/inputs');
const catalogText=await readFile(`${input}/catalog.json`,'utf8'),catalog=JSON.parse(catalogText);
assert.ok(catalog.products.length>0,'Use an unmodified public /api/products snapshot');
const out=path.resolve(process.env.EGE_H1_OUTPUT||'.scratch/h1/browser');await mkdir(out,{recursive:true});
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(n);
const results={catalogSha256:createHash('sha256').update(catalogText).digest('hex'),catalogProducts:catalog.products.length,engines:[],screenshots:[],matrix:[]};
const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
const widths=[320,375,768,1024,1440];
async function prepare(browser,width,mode='ready',baseline=null){
 const ctx=await browser.newContext({viewport:{width,height:960},ignoreHTTPSErrors:new URL(origin).protocol==='https:'});const state={mode};const writes=[];const errors=[];ctx.setDefaultTimeout(15000);ctx.setDefaultNavigationTimeout(45000);
 await ctx.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());
  assert.equal(u.origin,origin,'API requests stay on localhost');
  if(q.method()!=='GET'){writes.push({method:q.method(),path:u.pathname});return r.fulfill({status:204})}
  if(u.pathname==='/api/products'){
   if(state.mode==='slow')await new Promise(resolve=>setTimeout(resolve,1600));
   return r.fulfill({status:state.mode==='error'?503:200,json:state.mode==='empty'?{products:[]}:catalog});
  }
  if(u.pathname.startsWith('/api/products/')){const id=decodeURIComponent(u.pathname.split('/')[3]);if(u.pathname.endsWith('/reviews'))return r.fulfill({json:{reviews:[],summary:{count:0,average:null},nextCursor:null}});return r.fulfill({json:{product:catalog.products.find(p=>p.id===id)}})}
  return r.fulfill({json:{products:[],posts:[],documents:[]}});
 });
 if(baseline)await ctx.route(`${origin}/`,r=>r.fulfill({contentType:'text/html',body:baseline}));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 return {ctx,p,state,writes,errors};
}
async function settle(p){await p.goto(origin,{waitUntil:'networkidle'});await p.locator('[data-cookie-reject]').click();if(await p.locator('[data-hc-pause]').count())await p.locator('[data-hc-pause]').click();await p.evaluate(()=>document.fonts.ready)}
async function audit(p,label){const a=await new AxeBuilder({page:p}).withTags(tags).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],label);return a.violations.length}
async function screenshot(p,name,fullPage=false){await p.screenshot({path:`${out}/${name}.png`,fullPage});results.screenshots.push(`${name}.png`)}
try{
 for(const [engine,type] of [['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
  if(process.env.EGE_H1_ENGINES&&!process.env.EGE_H1_ENGINES.split(',').includes(engine))continue;
  const browser=await type.launch({headless:true,...(engine==='chrome'?{executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  results.engines.push({engine,version:browser.version()});
  try{
   if(engine==='chrome')for(const width of [375,768,1440])for(const baseline of ['live','premium']){
    const {p,ctx}=await prepare(browser,width,'ready',await readFile(`${input}/${baseline}.html`,'utf8'));
    await settle(p);await screenshot(p,`${baseline}-${width}`);await ctx.close();
   }
   for(const width of widths){
    const {p,ctx,state,writes,errors}=await prepare(browser,width);await settle(p);console.log('CHECK',engine,width,'loaded');
    await p.locator('.featured-grid .product:not(.product-skeleton)').first().waitFor();
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width,'horizontal overflow');
    assert.equal(await p.locator('.hero-card [data-product-field="price"]').textContent(),money(catalog.products.find(p=>p.id==='airy-12000-btu-h-siyah-81').price));
    await audit(p,`${engine} ${width} initial`);
    console.log('CHECK',engine,width,'initial axe');
    // Each color chooses a real, independent product; no copied price or stock.
    for(const tone of ['beyaz','siyah']){
     const b=p.locator(`[data-action="hero-tone"][data-tone="${tone}"]`),id=await b.getAttribute('data-product'),product=catalog.products.find(p=>p.id===id);assert.ok(product);
     await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true');
     assert.equal(await p.locator('.hero-card').getAttribute('data-featured-product'),id);
     assert.equal(await p.locator('.hero-card [data-product-field="name"]').textContent(),product.name);
     assert.equal(await p.locator('.hero-card [data-product-field="price"]').textContent(),money(product.price));
     assert.equal(await p.locator('.hero-card [data-product-field="stock"]').textContent(),`Stok: ${product.stock}`);
     assert.equal(await p.locator('[data-hero-link]').getAttribute('href'),`product.html?id=${encodeURIComponent(id)}`);
     assert.equal(await p.locator('[data-hero-cart]').getAttribute('data-id'),id);
     await p.locator('[data-hero-cart]').click();
     const cart=await p.evaluate(()=>JSON.parse(localStorage.getItem('ege-cart')));assert.ok(cart.some(x=>x.productId===id&&x.quantity===1));
    }
    assert.equal(await p.locator('[data-cart-count]').first().textContent(),'2');
    console.log('CHECK',engine,width,'color and cart');
    // Real carousel implementation: roving keyboard tabs, slide inertness, pause, arrows.
    await p.locator('#hc-tab-1').focus();await p.keyboard.press('ArrowRight');
    assert.equal(await p.locator('#hc-tab-2').getAttribute('aria-selected'),'true');
    assert.equal(await p.evaluate(()=>document.activeElement.id),'hc-tab-2');
    assert.equal(await p.locator('#hc-slide-1').evaluate(e=>e.inert),true);
    await audit(p,`${engine} ${width} fairy`);
    const height=await p.locator('.hc-viewport').evaluate(e=>e.getBoundingClientRect().height);
    await p.keyboard.press('ArrowRight');await audit(p,`${engine} ${width} pular`);
    await p.keyboard.press('End');await audit(p,`${engine} ${width} selector`);
    assert.ok(Math.abs(await p.locator('.hc-viewport').evaluate(e=>e.getBoundingClientRect().height)-height)<1,'slide change reserves height');
    await p.keyboard.press('Home');assert.equal(await p.locator('#hc-tab-1').getAttribute('aria-selected'),'true');
    console.log('CHECK',engine,width,'all slide axe');
    await p.locator('.skip-link').focus();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>document.activeElement.id),'main');
    assert.notEqual(await p.locator('#site-search').evaluate(e=>{e.focus();return getComputedStyle(e).outlineStyle}),'none');
    if(width<1024){
     const menu=p.locator('.store-nav > .menu-toggle');await menu.click();assert.equal(await p.locator('main').evaluate(e=>e.inert),true);
     await audit(p,`${engine} ${width} menu`);await p.keyboard.press('Escape');assert.equal(await menu.evaluate(e=>e===document.activeElement),true);
    }
    console.log('CHECK',engine,width,'keyboard and menu');
    const selector=p.locator('[data-btu-selector]');
    await selector.locator('[name="area"]').fill('24');await selector.locator('[name="city"]').fill('Aydın');await selector.locator('[name="district"]').fill('Kuşadası');
    await selector.getByRole('button',{name:'Devam et',exact:true}).click();await p.keyboard.press('Escape');
    assert.equal(await selector.locator('[name="area"]').inputValue(),'24');
    await selector.getByRole('button',{name:'Devam et',exact:true}).click();await selector.getByRole('button',{name:'Devam et',exact:true}).click();
    await selector.getByRole('button',{name:'Ön değerlendirmeyi gör',exact:true}).click();
    await selector.locator('[data-climate-result].show').waitFor();assert.match(await selector.locator('[data-climate-result]').innerText(),/BTU\/h/);
    assert.equal(await selector.locator('[data-climate-result]').evaluate(e=>e===document.activeElement),true);
    await p.locator('.need[href="catalog.html?btu=9000"]').click();await p.waitForURL('**/catalog.html?btu=9000');await p.goBack();
    await p.locator('#hc-tab-2').click();await p.locator('#hc-slide-2 .hc-actions a').first().click();await p.waitForURL('**/catalog.html?*series=Fairy');
    assert.equal(new URL(p.url()).searchParams.get('series'),'Fairy');await p.goBack();await p.goForward();assert.equal(new URL(p.url()).searchParams.get('series'),'Fairy');await p.goBack();
    await p.locator('#hc-tab-1').click();
    // Cart action is local UI state only; no checkout POST or customer data.
    assert.ok(writes.every(x=>x.path==='/api/analytics/event'&&x.method==='DELETE'),'no analytics event without consent, no order/service writes');
    await p.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await p.mouse.move(0,0);
    if(engine==='chrome'){
     if(await p.locator('[data-hc-pause]').getAttribute('aria-label')==='Otomatik geçişi durdur')await p.locator('[data-hc-pause]').click();
     await screenshot(p,`hybrid-${width}`);
     if([375,1440].includes(width)){
      const h=await p.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<h;y+=800){await p.evaluate(y=>scrollTo(0,y),y);await p.waitForTimeout(70)}await p.evaluate(()=>scrollTo(0,0));await screenshot(p,`hybrid-full-${width}`,true);
     }
    }
    if(engine!=='chrome')await screenshot(p,`${engine}-hybrid-${width}`);
    await p.emulateMedia({reducedMotion:'reduce'});await p.reload();await p.locator('.hc-ready.hc-stopped').waitFor();
    assert.equal(await p.locator('.hc-slide').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    await p.locator('#hc-tab-2').click();assert.equal(await p.locator('#hc-tab-2').getAttribute('aria-selected'),'true');
    console.log('CHECK',engine,width,'reduced');
    state.mode='slow';await p.goto(origin,{waitUntil:'domcontentloaded'});assert.equal(await p.locator('[data-hero-cart]').isDisabled(),true);await p.waitForFunction(()=>!document.querySelector('[data-hero-cart]').disabled);
    for(const mode of ['error','empty']){state.mode=mode;await p.reload({waitUntil:'networkidle'});await p.locator('[data-premium-catalog-recovery]:not([hidden])').waitFor();assert.equal(await p.locator('[data-hero-cart]').isDisabled(),true);assert.equal(await p.locator('.featured-grid').isVisible(),false);assert.doesNotMatch(await p.locator('.hero-card [data-product-field="price"]').innerText(),/₺/)}
    assert.deepEqual(errors,[],`${engine} ${width} runtime errors`);
    results.matrix.push({engine,width,status:'PASS',axeViolations:0,colors:'PASS',catalogPriceStock:'PASS',cart:'PASS',sliderKeyboard:'PASS',slideLayoutStability:'PASS',selectorAndSeriesNavigation:'PASS',backForward:'PASS',focusAndSkipLink:'PASS',reducedMotion:'PASS',slowErrorEmpty:'PASS',consentNoEvent:'PASS'});
    console.log(`PASS ${engine} ${width}`);await ctx.close();await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
   }
  }finally{await browser.close()}
 }
 console.log('H1 browser acceptance PASS');
}catch(e){results.failure=String(e);await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));throw e}
