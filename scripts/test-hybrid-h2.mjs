/** H2 premium catalog + product detail acceptance. GET-only: every non-GET request is answered by the test, never sent. */
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile,mkdir}from'node:fs/promises';import path from'node:path';
const require=createRequire(path.join(process.env.EGE_BROWSER_TOOLS,'package.json'));const{chromium,firefox,webkit}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const origin=new URL(process.env.EGE_H2_ORIGIN||'https://127.0.0.1:44394').origin,hosted=new URL(origin).hostname.endsWith('.vercel.app');
assert.ok(hosted?new URL(origin).hostname.startsWith('ege-teknik-phase3a-'):new URL(origin).hostname==='127.0.0.1');
const oidc=process.env.VERCEL_OIDC_TOKEN;if(hosted)assert.ok(oidc,'hosted runs need the local OIDC token (never printed)');
const out=process.env.EGE_H2_OUTPUT||'.scratch/h2/accept';await mkdir(out,{recursive:true});
// Local runs use the recorded catalog with two synthetic stock edits so out-of-stock and low-stock states are exercised.
const fixture=JSON.parse(await readFile('.scratch/h12/inputs/catalog.json')),detail=JSON.parse(await readFile('.scratch/h12/inputs/airy-detail.json'));
const OUT_ID='airy-18000-btu-h',LOW_ID='airy-9000-btu-h',DETAIL_ID=detail.product.id;
const localCatalog={products:fixture.products.map(p=>p.id===OUT_ID?{...p,stock:0}:p.id===LOW_ID?{...p,stock:2}:p)};
const localDetail=id=>id===DETAIL_ID?detail:(p=>p?{product:{...p,gallery:[],specifications:[],documents:[],warranty:null}}:null)(localCatalog.products.find(p=>p.id===id));
const result={origin,hosted,applicationCommit:process.env.EGE_H2_SHA,matrix:[],contrasts:[],axeScans:0,writesBlocked:[],orderCreated:false};
const save=()=>writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(n);

async function audit(p,label){const a=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],label);result.axeScans++;assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' horizontal overflow')}
async function contrast(p,scope,label){const rows=await p.locator(scope).evaluateAll(roots=>{
 const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const bg=e=>{let color=[255,255,255];const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);for(const n of chain){const c=rgb(getComputedStyle(n).backgroundColor),alpha=c[3]??1;color=color.map((x,i)=>c[i]*alpha+x*(1-alpha))}return color};
 const rows=[];for(const root of roots){const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=walk.nextNode())){const e=n.parentElement,text=n.textContent.trim();if(!text||!e.getClientRects().length||e.closest('[hidden],script,style,option,.sr-only,select,[disabled]')||getComputedStyle(e).visibility==='hidden')continue;
  let opacity=1;for(let a=e;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);if(opacity===0)continue;const back=bg(e),fg=rgb(getComputedStyle(e).color),alpha=(fg[3]??1)*opacity,rendered=back.map((v,i)=>fg[i]*alpha+v*(1-alpha));rows.push({text:text.slice(0,60),ratio:ratio(rendered,back)})}}return rows});
 assert.ok(rows.length,label+' rendered text missing');for(const r of rows)assert.ok(r.ratio>=4.5,`${label}: ${r.text} ratio ${r.ratio}`);result.contrasts.push({label,minimum:Math.min(...rows.map(r=>r.ratio)),count:rows.length})}
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))).then(()=>p.waitForTimeout(60));

try{for(const[engine,type]of[['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
 if(process.env.EGE_H2_ENGINES&&!process.env.EGE_H2_ENGINES.split(',').includes(engine))continue;
 const b=await type.launch({headless:true,...(engine==='chrome'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{for(const width of(process.env.EGE_H2_WIDTHS?process.env.EGE_H2_WIDTHS.split(',').map(Number):[1440,1024,768,390,320])){
  const mobile=width<=1000,c=await b.newContext({viewport:{width,height:mobile?844:900},ignoreHTTPSErrors:!hosted});c.setDefaultTimeout(20000);
  await c.addCookies([{name:'ege_analytics_consent',value:'0',url:origin}]);
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())){result.writesBlocked.push({method:q.method(),path:u.pathname});return r.fulfill({status:204})}
   if(!hosted&&u.pathname.startsWith('/api/')){if(u.pathname==='/api/products')return r.fulfill({json:localCatalog});if(u.pathname.startsWith('/api/products/')&&!u.pathname.includes('/reviews')){const d=localDetail(decodeURIComponent(u.pathname.split('/')[3]));return d?r.fulfill({json:d}):r.fulfill({status:404,json:{error:'not found'}})}
    if(u.pathname==='/api/legal/required')return r.fulfill({json:{documents:[{versionId:'h2-terms',title:'Sentetik koşullar',slug:'terms',version:'test'},{versionId:'h2-distance',title:'Sentetik sözleşme',slug:'distance',version:'test'}]}});
    if(u.pathname.includes('/reviews'))return r.fulfill({json:{reviews:[],summary:{count:0,average:null}}});return r.fulfill({json:{events:[],business:{serviceProvinces:['Aydın'],locations:{Aydın:['Kuşadası']}}}})}
   return r.continue(hosted&&u.origin===origin?{headers:{...q.headers(),'x-vercel-trusted-oidc-idp-token':oidc}}:undefined)});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const row={engine,version:b.version(),width,checks:{}};
  const shot=async name=>{if(engine==='chrome'&&[1440,390].includes(width))await p.screenshot({path:`${out}/${name}-${width}.png`})};

  /* ---- Catalog: real data, cards, availability ---- */
  await p.goto(origin+'/catalog.html',{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('[data-products] .product h3 a'));await settle(p);
  const products=await p.evaluate(()=>getProducts().map(x=>({id:x.id,name:x.name,sale:x.sale,stock:x.stock,price:x.price,series:x.series,category:x.category})));
  assert.ok(products.length>=10,'real catalog loaded');assert.equal(await p.locator('[data-result-count]').textContent(),products.length+' ürün');
  const cardFacts=await p.locator('[data-products] .product').evaluateAll(cs=>cs.map(c=>({href:c.querySelector('h3 a').getAttribute('href'),availability:c.querySelector('.product-media').dataset.availability,button:c.querySelector('.actions button')?.textContent,disabled:c.querySelector('.actions button')?.disabled,text:c.textContent})));
  for(const f of cardFacts){const id=new URLSearchParams(f.href.split('?')[1]).get('id'),prod=products.find(x=>x.id===id);assert.ok(prod,id);
   const expected=!prod.sale?'quote':prod.stock>0?(prod.stock<=3?'low':'in'):'out';assert.equal(f.availability,expected,id);
   if(!prod.sale){assert.equal(f.button,'Teklif Al');assert.doesNotMatch(f.text,/Stokta ·/)}else if(prod.stock<=0){assert.equal(f.disabled,true);assert.equal(f.button,'Tükendi')}else{assert.equal(f.button,'Sepete Ekle');assert.ok(f.text.includes(money(prod.price)),id+' price')}
   assert.doesNotMatch(f.text,/paylaşılmamış/i)}
  row.checks.cards={count:cardFacts.length,out:cardFacts.filter(f=>f.availability==='out').length,low:cardFacts.filter(f=>f.availability==='low').length,quote:cardFacts.filter(f=>f.availability==='quote').length};
  if(!hosted)assert.ok(row.checks.cards.out>=1&&row.checks.cards.low>=1,'synthetic stock edits rendered');
  const ratios=await p.locator('[data-products] .product-visual').evaluateAll(es=>es.slice(0,6).map(e=>{const r=e.getBoundingClientRect();return Math.round(r.width/r.height*100)/100}));
  if(width>560)assert.ok(ratios.every(x=>Math.abs(x-4/3)<.03),'consistent 4:3 media '+ratios);
  await contrast(p,'.catalog-results',`${engine}/${width}/catalog`);await audit(p,`${engine}/${width}/catalog`);
  await p.locator('[data-products]').scrollIntoViewIfNeeded();await shot('catalog');

  /* ---- Filters: URL sync without reload, colour, relaxations, history ---- */
  await p.evaluate(()=>{window.__h2Marker='kept'});
  const colourOf=n=>(/\b(Siyah|Beyaz)\b/i.exec(n)||[])[1];const siyah=products.filter(x=>colourOf(x.name)==='Siyah').length;
  const openFilters=async()=>{if(mobile){await p.locator('.catalog-toolbar [data-action=toggle-filters]').click();await p.locator('.catalog-filters.open').waitFor()}};
  const applyFilters=async()=>{if(mobile){await p.locator('.filters-foot [data-apply-count]').click();await p.waitForFunction(()=>!document.querySelector('.catalog-filters.open'))}};
  if(siyah){await openFilters();
   if(mobile){assert.equal(await p.evaluate(()=>document.activeElement.matches('.filters-close')),true,'focus moves into the drawer');for(let i=0;i<40;i++)await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.catalog-filters')),true,'Tab stays inside the drawer');await contrast(p,'.catalog-filters',`${engine}/${width}/drawer`);await audit(p,`${engine}/${width}/drawer`);await shot('filter-drawer')}
   await p.locator('[data-catalog-filter=colour]').selectOption('Siyah');await applyFilters();await p.waitForURL(/colour=Siyah/);
   assert.equal(await p.locator('[data-result-count]').textContent(),siyah+' ürün');assert.ok((await p.locator('[data-products] .product h3').allTextContents()).every(t=>/siyah/i.test(t)));
   assert.equal(await p.evaluate(()=>window.__h2Marker),'kept','filter change must not reload the page');row.checks.colour=siyah}
  const brandHidden=await p.locator('[data-catalog-filter=brand]').evaluate(e=>e.closest('.filter-group').hidden);if(new Set(products.map(()=> 'gree')).size===1)row.checks.singleBrandHidden=brandHidden;
  // An impossible combination built from real values: an online-only series with the quote filter.
  const onlineSeries=[...new Set(products.filter(x=>x.sale).map(x=>x.series))].find(s=>s&&!products.some(x=>x.series===s&&!x.sale));
  if(onlineSeries){await p.goto(origin+'/catalog.html?series='+encodeURIComponent(onlineSeries)+'&stock=quote');await p.waitForFunction(()=>document.querySelector('.catalog-empty'));await settle(p);
   await p.evaluate(()=>{window.__h2Marker='kept'});
   const relax=await p.locator('.catalog-relax button').allTextContents();assert.ok(relax.length>=1,'relaxations offered');
   const quoteCount=products.filter(x=>!x.sale).length,seriesCount=products.filter(x=>x.series===onlineSeries).length;
   assert.ok(relax.some(t=>t.includes(`Uygunluk: Teklif / keşif kaldır${seriesCount} ürün`)),relax.join('|'));assert.ok(relax.some(t=>t.includes(`Seri: ${onlineSeries} kaldır${quoteCount} ürün`)),relax.join('|'));
   await contrast(p,'.catalog-results',`${engine}/${width}/empty`);await audit(p,`${engine}/${width}/empty`);await p.locator('.catalog-empty').scrollIntoViewIfNeeded();await shot('empty-results');
   await p.locator('.catalog-relax button[data-key=stock]').click();await p.waitForURL(u=>!u.search.includes('stock='));assert.equal(await p.locator('[data-result-count]').textContent(),seriesCount+' ürün');
   await p.goBack();await p.waitForFunction(()=>document.querySelector('.catalog-empty'));assert.match(p.url(),/stock=quote/);assert.equal(await p.evaluate(()=>window.__h2Marker),'kept','history uses pushState/popstate');
   await p.locator('.catalog-empty-actions [data-action=clear-catalog]').click();await p.waitForURL(origin+'/catalog.html');assert.equal(await p.locator('[data-result-count]').textContent(),products.length+' ürün');row.checks.emptyRelax=relax}

  /* ---- Product detail: variants keep their own price; gallery; sticky buy ---- */
  const detailId=hosted?(products.find(x=>x.sale&&x.stock>0&&products.filter(y=>y.series===x.series&&y.category===x.category).length>=2)||products.find(x=>x.sale&&x.stock>0)).id:DETAIL_ID;
  await p.goto(origin+'/catalog.html');await p.waitForFunction(()=>document.querySelector('[data-products] .product h3 a'));
  const cardLink=p.locator(`[data-products] .product h3 a[href="product.html?id=${detailId}"]`);
  if(await cardLink.count()){await cardLink.first().click()}else await p.goto(origin+'/product.html?id='+encodeURIComponent(detailId));
  await p.waitForURL('**/product.html?id=*');await p.locator('.pd-amount').waitFor();await settle(p);
  const detailPrice=await p.evaluate(()=>productDetail.price);assert.equal((await p.locator('.pd-amount').textContent()).trim(),money(detailPrice));
  const variants=p.locator('.pd-variant');row.checks.variants=await variants.count();
  if(row.checks.variants){assert.equal(await p.locator('.pd-variant[aria-current=page]').count(),1);assert.equal((await p.locator('.pd-variant[aria-current=page] small').textContent()).trim(),money(detailPrice));
   const other=p.locator('.pd-variant:not(.is-current):not(.is-out)').first(),href=await other.getAttribute('href'),otherId=new URLSearchParams(href.split('?')[1]).get('id'),listed=products.find(x=>x.id===otherId);
   await other.click();await p.waitForURL('**/product.html?id='+encodeURIComponent(otherId));await p.waitForFunction(id=>productDetail?.id===id,otherId);await p.locator('.pd-amount').waitFor();
   const shown=await p.evaluate(()=>({id:productDetail.id,name:productDetail.name,price:productDetail.price,amount:document.querySelector('.pd-amount').textContent.trim(),h1:document.querySelector('h1').textContent}));
   assert.equal(shown.id,otherId);assert.equal(shown.amount,money(shown.price),'shown price is the detail endpoint price');if(listed?.sale)assert.equal(shown.price,listed.price,'list and detail agree for '+otherId);assert.equal(shown.h1,shown.name);
   await p.goBack();await p.waitForFunction(id=>productDetail?.id===id,detailId);await p.locator('.pd-amount').waitFor()}
  if(await p.locator('.pd-gallery-nav.is-next').count()){const total=await p.locator('.gallery-thumb').count();await p.locator('.pd-gallery-nav.is-next').click();assert.equal((await p.locator('[data-gallery-count]').textContent()).trim(),`2 / ${total}`);await p.locator('.pd-gallery-nav.is-prev').click();await p.locator('.pd-gallery-nav.is-prev').click();assert.equal((await p.locator('[data-gallery-count]').textContent()).trim(),`${total} / ${total}`);row.checks.gallery=total}
  await contrast(p,'.pd-info',`${engine}/${width}/product`);await audit(p,`${engine}/${width}/product`);await p.evaluate(()=>scrollTo(0,0));await shot('product');
  if(mobile){await p.evaluate(()=>{const box=document.querySelector('.pd-buy');scrollTo(0,box.getBoundingClientRect().bottom+scrollY+200)});await p.waitForFunction(()=>document.querySelector('.pd-sticky')?.classList.contains('is-visible'));await settle(p);
   assert.equal(await p.locator('.pd-sticky b').textContent(),money(detailPrice));await contrast(p,'.pd-sticky',`${engine}/${width}/sticky`);await shot('sticky-buy');
   await p.locator('.pd-sticky [data-action=add-product-cart]').click()}
  else await p.locator('.pd-buy [data-action=add-product-cart]').click();
  await p.locator('[data-drawer-checkout]:visible').waitFor();await settle(p);await audit(p,`${engine}/${width}/drawer-cart`);await shot('cart-drawer');
  await p.locator('[data-drawer-checkout]').click();await p.waitForURL('**/checkout.html');await p.waitForFunction(()=>document.querySelector('[data-cart-items]')?.innerText.includes('×'));await settle(p);
  const line=await p.evaluate(()=>({items:document.querySelector('[data-cart-items]').innerText,payload:orderItemsPayload(normalizeCartEntries(readCartRaw(),null),getProducts())}));
  assert.ok(line.items.includes(money(detailPrice)),'checkout shows the catalog price');assert.deepEqual(line.payload,[{productId:detailId,quantity:1}],'order payload carries id and quantity only');
  assert.equal(await p.locator('[data-submit-order]').isDisabled(),true,'no order without legal consent');await audit(p,`${engine}/${width}/checkout`);

  /* ---- Negative: tampered cart price/quantity and unknown ids never reach the order ---- */
  const outId=products.find(x=>x.sale&&x.stock<=0)?.id;
  await p.evaluate(([id,out])=>localStorage.setItem('ege-cart',JSON.stringify([{productId:id,quantity:999,price:1,total:1},{productId:'not-a-real-product',quantity:3},...(out?[{productId:out,quantity:1}]:[])])),[detailId,outId]);
  await p.reload();await p.waitForFunction(()=>document.querySelector('[data-cart-items]')?.innerText.includes('×'));await settle(p);
  const tampered=await p.evaluate(()=>({raw:JSON.parse(localStorage.getItem('ege-cart')),payload:orderItemsPayload(normalizeCartEntries(readCartRaw(),null),getProducts()),items:document.querySelector('[data-cart-items]').innerText}));
  assert.ok(!tampered.raw.some(e=>e.productId==='not-a-real-product'),'unknown ids are pruned from ege-cart');
  assert.ok(tampered.payload.every(e=>Object.keys(e).sort().join()==='productId,quantity'),'no client price is ever sent');
  const mine=tampered.payload.find(e=>e.productId===detailId);assert.ok(mine.quantity<=10,'quantity capped');assert.ok(!tampered.items.includes(money(1)),'tampered price is never shown');
  row.checks.negative={payload:tampered.payload,unknownPruned:true,outOfStockInCart:outId?tampered.payload.some(e=>e.productId===outId):null};

  /* ---- Reduced motion: no card lift, no transition ---- */
  await p.emulateMedia({reducedMotion:'reduce'});await p.goto(origin+'/catalog.html');await p.waitForFunction(()=>document.querySelector('[data-products] .product'));
  assert.equal(await p.locator('[data-products]>.product').first().evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(d=>d==='0s')),true);
  assert.equal(await p.locator('main').evaluate(e=>getComputedStyle(e).animationName),'none');
  if(!mobile){await p.locator('[data-products]>.product').first().hover();assert.equal(await p.locator('[data-products]>.product').first().evaluate(e=>getComputedStyle(e).transform),'none')}
  row.checks.reducedMotion='PASS';

  /* ---- Keyboard: card actions reachable, focus ring visible ---- */
  // macOS WebKit tabs only to form controls by default; Option+Tab is Safari's full keyboard navigation.
  await p.locator('[data-products] .product h3 a').first().focus();await p.keyboard.press(engine==='webkit'?'Alt+Tab':'Tab');
  assert.ok(await p.evaluate(()=>!!document.activeElement.closest('.product')),'next Tab stays on the card controls');
  assert.notEqual(await p.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none','visible focus');

  assert.deepEqual(errors,[]);row.status='PASS';result.matrix.push(row);await save();console.log('PASS H2',engine,width);await c.close();
 }}finally{await b.close()}}
}catch(e){result.failure={message:e.message,stack:e.stack};await save();throw e}
result.orderCreated=false;await save();console.log('H2 acceptance PASS');
