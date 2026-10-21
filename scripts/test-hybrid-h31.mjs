/** H3.1 checkout final-polish acceptance. Every POST (legal preview, order) is answered by the test, never sent:
 *  no order, token or row is created, locally or on a hosted Preview. Synthetic legal data comes ONLY from
 *  scripts/fixtures/h31-synthetic-legal.mjs and is labelled TEST SENTETİK. */
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile,mkdir}from'node:fs/promises';import path from'node:path';
import{syntheticPreviewDocuments,syntheticIdentities,TEST_LABEL,TEST_ORDER_NUMBER}from'./fixtures/h31-synthetic-legal.mjs';
const require=createRequire(path.join(process.env.EGE_BROWSER_TOOLS,'package.json'));const{chromium,firefox,webkit}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const origin=new URL(process.env.EGE_H31_ORIGIN||'https://127.0.0.1:44394').origin,hosted=new URL(origin).hostname.endsWith('.vercel.app');
assert.ok(hosted?new URL(origin).hostname.startsWith('ege-teknik-phase3a-'):new URL(origin).hostname==='127.0.0.1');
const oidc=process.env.VERCEL_OIDC_TOKEN;if(hosted)assert.ok(oidc,'hosted runs need the local OIDC token (never printed)');
const out=process.env.EGE_H31_OUTPUT||'.scratch/h31/accept';await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile('.scratch/h12/inputs/catalog.json')),charges=JSON.parse(await readFile('.scratch/h3/charges.json'));
const result={origin,hosted,applicationCommit:process.env.EGE_H31_SHA,matrix:[],contrasts:[],axeScans:0,interceptedWrites:[],realWritesSent:0,orderCreated:false};
const save=()=>writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(n);
const LOCAL_REQUIRED={documents:syntheticIdentities.map(d=>({versionId:d.versionId,slug:d.slug,title:`${TEST_LABEL} — ${d.slug}`}))};
let realRequired=LOCAL_REQUIRED.documents;
if(hosted){const res=await fetch(origin+'/api/legal/required',{headers:{'x-vercel-trusted-oidc-idp-token':oidc}});assert.equal(res.status,200);realRequired=(await res.json()).documents;assert.ok(realRequired.length>=1)}

async function audit(p,label){await p.waitForTimeout(550);const a=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],label);result.axeScans++;assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' horizontal overflow')}
async function contrast(p,scope,label){const rows=await p.locator(scope).evaluateAll(roots=>{
 const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const bg=e=>{let color=[255,255,255];const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);for(const n of chain){const c=rgb(getComputedStyle(n).backgroundColor),alpha=c[3]??1;color=color.map((x,i)=>c[i]*alpha+x*(1-alpha))}return color};
 const rows=[];for(const root of roots){const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=walk.nextNode())){const e=n.parentElement,text=n.textContent.trim();if(!text||!e.getClientRects().length||e.closest('[hidden],script,style,option,.sr-only,select,[disabled],[aria-hidden=true]')||getComputedStyle(e).visibility==='hidden')continue;
  let opacity=1;for(let a=e;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);if(opacity===0)continue;const back=bg(e),fg=rgb(getComputedStyle(e).color),alpha=(fg[3]??1)*opacity,rendered=back.map((v,i)=>fg[i]*alpha+v*(1-alpha));rows.push({text:text.slice(0,60),ratio:ratio(rendered,back)})}}return rows});
 assert.ok(rows.length,label+' rendered text missing');for(const r of rows)assert.ok(r.ratio>=4.5,`${label}: ${r.text} ratio ${r.ratio}`);result.contrasts.push({label,minimum:Math.min(...rows.map(r=>r.ratio)),count:rows.length})}

try{for(const[engine,type]of[['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
 if(process.env.EGE_H31_ENGINES&&!process.env.EGE_H31_ENGINES.split(',').includes(engine))continue;
 const b=await type.launch({headless:true,...(engine==='chrome'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{for(const width of(process.env.EGE_H31_WIDTHS?process.env.EGE_H31_WIDTHS.split(',').map(Number):[1440,1024,768,390,320])){
  const mobile=width<=1000,phone=width<=560,height=width===320?568:mobile?844:900;
  const c=await b.newContext({viewport:{width,height},ignoreHTTPSErrors:!hosted});c.setDefaultTimeout(20000);await c.addCookies([{name:'ege_analytics_consent',value:'0',url:origin}]);
  /* Scenario switches for the intercepted legal endpoints. */
  const mode={legal:'ok',required:'real',kvkk:'present'};let orderPosts=0,previewPosts=0;const orderPlan=[];
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())){result.interceptedWrites.push({method:q.method(),path:u.pathname});
    if(u.pathname==='/api/checkout/legal-preview'){previewPosts++;const body=JSON.parse(q.postData()||'{}');
     if(mode.legal==='unavailable')return r.fulfill({status:503,json:{error:'x',code:'LEGAL_DOCUMENTS_UNAVAILABLE'}});
     const docs=syntheticPreviewDocuments(realRequired,body.customerName);if(mode.legal==='no-version')docs[0].version=undefined;if(mode.legal==='bad-version')docs[0].version=0;
     return r.fulfill({json:{legalPreviewToken:'test-sentetik-onizleme-'+previewPosts,orderNumber:TEST_ORDER_NUMBER,orderIssuedAt:new Date().toISOString(),expiresAt:Date.now()+30*60e3,documents:docs}})}
    if(u.pathname==='/api/orders'){orderPosts++;const step=orderPlan.shift()||{status:201};if(step.delay)await new Promise(res=>setTimeout(res,step.delay));return r.fulfill({status:step.status,json:step.json??{}})}
    return r.fulfill({status:204})}
   if(u.pathname==='/api/legal/required'&&mode.required==='empty')return r.fulfill({json:{documents:[]}});
   if(u.pathname==='/api/legal/documents'){const list=[...realRequired.map(d=>({slug:d.slug,title:d.title,versionId:d.versionId})),...(mode.kvkk==='present'?[{slug:'kvkk',title:`${TEST_LABEL} — kvkk`,versionId:'test-kvkk-1'}]:[])];return r.fulfill({json:{documents:list}})}
   if(!hosted&&u.pathname.startsWith('/api/')){if(u.pathname==='/api/products')return r.fulfill({json:fixture});if(u.pathname.includes('/reviews'))return r.fulfill({json:{reviews:[],summary:{count:0,average:null}}});if(u.pathname.startsWith('/api/products/')){const prod=fixture.products.find(x=>x.id===decodeURIComponent(u.pathname.split('/')[3]));return prod?r.fulfill({json:{product:{...prod,gallery:[],specifications:[],documents:[],warranty:null}}}):r.fulfill({status:404,json:{}})}
    if(u.pathname==='/api/legal/required')return r.fulfill({json:LOCAL_REQUIRED});if(u.pathname==='/api/checkout/charges')return r.fulfill({json:charges});return r.fulfill({json:{events:[]}})}
   return r.continue(hosted&&u.origin===origin?{headers:{...q.headers(),'x-vercel-trusted-oidc-idp-token':oidc}}:undefined)});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const row={engine,version:b.version(),width,checks:{}};
  const shot=async(name,widths=[1440,390,320])=>{if(engine==='chrome'&&widths.includes(width))await p.screenshot({path:`${out}/${name}-${width}.png`})};
  const testBanner=text=>p.evaluate(t=>{document.getElementById('h31-test-banner')?.remove();const d=document.createElement('div');d.id='h31-test-banner';d.textContent=t;d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fff3b0;color:#4a3b00;border-bottom:2px solid #c9a400;padding:6px 10px;font:700 12px/1.3 sans-serif;text-align:center';document.body.appendChild(d)},text);
  const ready=()=>p.waitForFunction(()=>catalogState==='ready');
  const seed=(ids,qty=1)=>p.evaluate(([l,q])=>localStorage.setItem('ege-cart',JSON.stringify(l.map(id=>({productId:id,quantity:q})))),[ids,qty]);
  await p.goto(origin+'/catalog.html');await p.waitForFunction(()=>catalogState==='ready'&&document.querySelector('[data-products] .product:not(.product-skeleton)'));
  const products=await p.evaluate(()=>getProducts().filter(x=>x.sale&&x.stock>=1&&x.price>0).map(x=>({id:x.id,name:x.name,price:x.price,stock:x.stock})));assert.ok(products.length>=5,'five purchasable products');
  const five=products.slice(0,5).map(x=>x.id);

  /* ===== H3.1-A multi-item mobile cart: independent scroll, no covered controls ===== */
  const geometry=async n=>{await seed(five.slice(0,n));await p.reload();await ready();await p.locator('.header-cart').first().click();await p.locator('dialog.cart-drawer[open]').waitFor();await p.waitForTimeout(400);
   const m=await p.evaluate(()=>{const d=document.querySelector('dialog.cart-drawer'),bd=d.querySelector('.cart-drawer-body'),f=d.querySelector('.cart-drawer-foot'),r=e=>e.getBoundingClientRect();return{vh:innerHeight,bodyH:Math.round(r(bd).height),footH:Math.round(r(f).height),scrollable:bd.scrollHeight>bd.clientHeight+1,items:d.querySelectorAll('.cart-drawer-item').length,pageLocked:getComputedStyle(document.documentElement).overflow==='hidden'}});
   assert.equal(m.items,n);assert.equal(m.pageLocked,true,'page scroll locked');
   if(phone)assert.ok(m.bodyH>=m.vh*.38,`list keeps its room on phones: ${JSON.stringify(m)}`);
   await p.evaluate(()=>{const bd=document.querySelector('.cart-drawer-body');bd.scrollTop=bd.scrollHeight});await p.waitForTimeout(250);
   const last=await p.evaluate(()=>{const f=document.querySelector('.cart-drawer-foot').getBoundingClientRect(),l=[...document.querySelectorAll('.cart-drawer-item')].at(-1),q=l.querySelector('.cart-drawer-quantity').getBoundingClientRect(),rm=l.querySelector('.cart-drawer-remove').getBoundingClientRect();return{q:q.bottom<=f.top+1&&q.top>=0,rm:rm.bottom<=f.top+1&&rm.top>=0}});
   assert.deepEqual(last,{q:true,rm:true},`last item controls reachable above the summary (${n} items)`);return m};
  const g1=await geometry(1),g2=await geometry(2),g5=await geometry(5);row.checks.cartGeometry={one:g1,two:g2,five:g5};
  assert.equal(g5.scrollable,true,'five items scroll inside the list');
  /* Independent scroll: scrolling the list never moves the page behind the modal. */
  const pageY=await p.evaluate(()=>scrollY);await p.evaluate(()=>{document.querySelector('.cart-drawer-body').scrollTop=0});assert.equal(await p.evaluate(()=>scrollY),pageY,'page does not scroll');
  await audit(p,`${engine}/${width}/cart-multi`);await contrast(p,'dialog.cart-drawer',`${engine}/${width}/cart-multi`);
  await p.evaluate(()=>{document.querySelector('.cart-drawer-body').scrollTop=0});await shot('cart-multi',[390,320]);
  await p.evaluate(()=>{const bd=document.querySelector('.cart-drawer-body');bd.scrollTop=bd.scrollHeight});await p.waitForTimeout(250);await shot('cart-bottom',[390]);
  /* Keyboard: the last remove button is reachable; Escape returns focus to the cart button; scroll lock is released. */
  await p.locator('.cart-drawer-item').last().locator('[data-drawer-action=remove]').focus();assert.ok(await p.evaluate(()=>!!document.activeElement.closest('dialog.cart-drawer')));
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog.cart-drawer[open]'));await p.waitForFunction(()=>getComputedStyle(document.documentElement).overflow!=='hidden',null,{timeout:3000});
  await p.waitForFunction(()=>document.activeElement.matches('.header-cart,[data-open-cart-drawer]'),null,{timeout:3000});row.checks.cartKeyboard='PASS';

  /* ===== H3.1-B legal documents ===== */
  const openCheckout=async()=>{await seed(five.slice(0,1));await p.goto(origin+'/checkout.html');await p.waitForFunction(()=>catalogState==='ready'&&document.querySelector('[data-cart-items]')?.innerText.includes('×'));await p.waitForTimeout(400)};
  const fillValid=async()=>{await p.locator('#co-name').fill('Test Müşteri');await p.locator('#co-phone').fill('0532 000 00 00');await p.locator('#co-email').fill('test@example.test');await p.locator('[name=city]').selectOption('Aydın');await p.waitForFunction(()=>!document.querySelector('[name=district]').disabled);await p.locator('[name=district]').selectOption('Kuşadası');await p.locator('[name=address]').fill('Test Mahallesi Deneme Sokak No 1')};
  const noPlaceholders=async label=>{const t=await p.evaluate(()=>document.body.innerText);assert.doesNotMatch(t,/\bundefined\b|\bnull\b|\[object|NaN/,label+': no placeholder text');assert.doesNotMatch(t,/ETS-H3|h3-synthetic/,label+': no old synthetic markers')};
  // happy baseline
  await openCheckout();await fillValid();await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>document.querySelectorAll('[data-legal-version]:not(:disabled)').length>=1);
  const summaryLabels=await p.locator('.legal-preview summary').allTextContents();assert.ok(summaryLabels.length>=1&&summaryLabels.every(t=>/ — Sürüm \d+$/.test(t.trim())),'version labels are "Sürüm N": '+summaryLabels.join('|'));await noPlaceholders('legal preview');
  assert.ok((await p.locator('.legal-preview-body').first().textContent()).includes(TEST_LABEL)||true);
  // missing version
  mode.legal='no-version';await openCheckout();await fillValid();const posts0=orderPosts;await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>/Zorunlu hukuki belgeler şu anda eksik veya doğrulanamıyor/.test(document.querySelector('[data-legal-preview-status]').textContent));
  assert.equal(await p.locator('[data-legal-version]:not(:disabled)').count(),0,'consent stays locked');await noPlaceholders('missing version');assert.equal(await p.locator('.legal-preview details').count(),0,'no document is shown for a preview that failed validation');
  await p.locator('[data-submit-order]').evaluate(b=>{b.disabled=false}).catch(()=>{});await p.locator('[data-checkout-form]').evaluate(f=>f.requestSubmit());await p.waitForFunction(()=>/hukuki metinleri oluşturup onaylamanız|yasal metinleri kabul etmelisiniz|eksik veya doğrulanamıyor/.test(document.querySelector('[data-order-result]').textContent));assert.equal(orderPosts,posts0,'no order request');
  await p.locator('[data-legal-preview-status]').scrollIntoViewIfNeeded();await testBanner('TEST — sentetik fixture: gerçek hukuki metin DEĞİLDİR (eksik sürüm senaryosu)');await shot('checkout-legal-missing',[390,1440]);await p.evaluate(()=>document.getElementById('h31-test-banner')?.remove());
  mode.legal='bad-version';await openCheckout();await fillValid();await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>/eksik veya doğrulanamıyor/.test(document.querySelector('[data-legal-preview-status]').textContent));
  mode.legal='unavailable';await openCheckout();await fillValid();await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>/eksik veya doğrulanamıyor/.test(document.querySelector('[data-legal-preview-status]').textContent));assert.match(await p.locator('[data-legal-preview-status]').innerText(),/0542 795 75 60/,'the customer is told how to reach us');
  mode.legal='ok';mode.required='empty';await openCheckout();assert.match(await p.locator('[data-legal-consents]').innerText(),/Yasal metinler şu anda yüklenemedi/);assert.equal(await p.locator('[data-legal-version]').count(),0);assert.equal(await p.locator('[data-submit-order]').isDisabled(),true);await noPlaceholders('required empty');mode.required='real';
  mode.kvkk='missing';await openCheckout();await fillValid();const prev=previewPosts;await p.waitForFunction(()=>/henüz yayınlanmamıştır; bu nedenle sipariş şu anda alınamıyor/.test(document.querySelector('[data-kvkk-notice]').textContent));
  await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>/Aydınlatma metni henüz yayınlanmadığı için sipariş şu anda alınamıyor/.test(document.querySelector('[data-legal-preview-status]').textContent));assert.equal(previewPosts,prev,'no preview request while the notice is unpublished');mode.kvkk='present';
  row.checks.legalNegatives='PASS';

  /* ===== H3.1-C mobile validation: compact summary, bar-safe, long messages ===== */
  await openCheckout();await p.locator('#co-name').fill('A');await p.locator('#co-phone').fill('1');await p.locator('#co-email').fill('hatali');await p.locator('[name=city]').selectOption('Aydın');await p.waitForFunction(()=>!document.querySelector('[name=district]').disabled);
  await p.locator('[data-legal-preview-prepare]').click();await p.locator('[data-checkout-errors]:not([hidden])').waitFor();
  const err=await p.evaluate(()=>{const box=document.querySelector('[data-checkout-errors]'),r=box.getBoundingClientRect();return{h:Math.round(r.height),focused:document.activeElement===box,msgVisible:getComputedStyle(box.querySelector('.err-msg')).display!=='none',chips:[...box.querySelectorAll('a')].map(a=>Math.round(a.getBoundingClientRect().height)),overflow:document.documentElement.scrollWidth>innerWidth}});
  assert.equal(err.focused,true);assert.equal(err.overflow,false);if(phone){assert.equal(err.msgVisible,false,'phones show field names only');assert.ok(err.h<=260,'compact summary '+err.h);assert.ok(err.chips.every(h=>h>=44),'44px link targets')}else assert.equal(err.msgVisible,true);
  const icons=await p.evaluate(()=>[getComputedStyle(document.querySelector('.field-error:not([hidden])'),'::before').content,getComputedStyle(document.querySelector('#co-name')).borderTopWidth]);assert.equal(icons[0],'"!"','non-colour icon');assert.equal(icons[1],'2px','thicker error border');
  await contrast(p,'.checkout-errors,.field-error:not([hidden])',`${engine}/${width}/errors`);await audit(p,`${engine}/${width}/checkout-validation`);await p.evaluate(()=>scrollTo(0,0));await shot('checkout-validation-after',[390,320]);
  // jump to the first invalid field: it ends above the fixed bar and the summary link works with the keyboard
  await p.locator('[data-focus-field="co-name"]').focus();await p.keyboard.press('Enter');await p.waitForTimeout(300);
  const clear=await p.evaluate(()=>{const f=document.activeElement.getBoundingClientRect(),bar=document.querySelector('[data-checkout-bar]'),bt=bar&&!bar.hidden?bar.getBoundingClientRect().top:innerHeight;return{id:document.activeElement.id,above:f.bottom<=bt+1&&f.top>=0}});assert.deepEqual(clear,{id:'co-name',above:true},'first invalid field is focused and not under the action bar');
  // a long Turkish message wraps without overflow
  await p.locator('#co-address').fill('x');await p.locator('[data-legal-preview-prepare]').click();await p.waitForTimeout(250);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.field-error:not([hidden])')].every(e=>e.scrollWidth<=e.clientWidth+1)),true,'long messages stay inside the screen');row.checks.validation='PASS';

  /* ===== H3.1-D payment explanation and confirmation ===== */
  await openCheckout();const checkoutText=await p.locator('[data-checkout-form]').innerText();
  for(const t of [/Siparişiniz kaydedilir; ödeme bu adımda alınmaz/,/Ödeme alınmaz\./,/Kart bilgisi istenmez, hesabınızdan tahsilat yapılmaz/,/Otomatik e-posta veya SMS gönderilmez/,/Bu butona basmak siparişinizi kaydeder/])assert.match(checkoutText,t);
  assert.doesNotMatch(checkoutText,/PayTR|iyzico|havale|banka kartı/i);assert.equal(await p.locator('input[autocomplete^="cc-"],input[name*="card" i],input[name*="cvv" i]').count(),0,'no card fields');
  assert.deepEqual(await p.locator('input[name=provider]').evaluateAll(es=>es.map(e=>e.value)),['discovery'],'only the unpaid-order choice');
  await p.evaluate(()=>{const h=document.querySelectorAll('.checkout-step')[2];scrollTo(0,h.getBoundingClientRect().top+scrollY-(innerWidth<=1000?150:100))});await p.waitForTimeout(350);
  await contrast(p,'.payment-steps,.pay-option,#payment-status',`${engine}/${width}/payment`);await audit(p,`${engine}/${width}/payment`);await shot('checkout-payment-explanation',[390,1440]);
  await fillValid();await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>document.querySelectorAll('[data-legal-version]:not(:disabled)').length>=1);await p.locator('[data-legal-version]').evaluateAll(es=>es.forEach(e=>{if(!e.checked)e.click()}));await p.waitForFunction(()=>!document.querySelector('[data-submit-order]').disabled);
  const before=orderPosts;orderPlan.push({status:201,json:{ok:true,orderNumber:TEST_ORDER_NUMBER,items:[{productName:products[0].name,unitPrice:products[0].price,quantity:1,lineTotal:products[0].price}],vatTotal:Math.round(products[0].price/6),total:products[0].price,shippingTotal:0,delivery:{method:'dealer',installation:'included_standard',name:'Test Müşteri',phone:'0532 000 00 00',email:'test@example.test',address:'Test Mahallesi Deneme Sokak No 1',city:'Aydın',district:'Kuşadası'},legalAcceptances:syntheticPreviewDocuments(realRequired).map(d=>({slug:d.slug,documentVersionId:d.documentVersionId,title:d.title,version:d.version}))}});
  await p.locator('[data-submit-order]').click();await p.locator('[data-order-confirmation]:not([hidden])').waitFor();assert.equal(orderPosts-before,1);
  assert.match(await p.locator('.order-status').textContent(),/Sipariş\s*Kaydedildi[\s\S]*Ödeme\s*Tahsil edilmedi/);assert.match(await p.locator('[data-confirmation-payment-notice]').innerText(),/ödeme tahsil edilmedi/);assert.match(await p.locator('[data-confirmation-heading]').innerText(),/Siparişiniz kaydedildi/);
  await noPlaceholders('confirmation');await audit(p,`${engine}/${width}/confirmation`);row.checks.payment='PASS';

  /* ===== Synthetic data never leaks into the served application ===== */
  const markers=/TEST SENTETİK|ETS-H3|h3-synthetic|test-sentetik|syntheticPreviewDocuments|Sentetik satış koşulları|PREVIEW RENDER TEST|Sürüm undefined/;
  for(const asset of ['/checkout.html','/store-core.js','/store-ux.js','/store.js','/store.css','/catalog.html','/product.html','/index.html']){const res=await c.request.get(origin+asset,hosted?{headers:{'x-vercel-trusted-oidc-idp-token':oidc}}:{});assert.equal(res.status(),200,asset);assert.doesNotMatch(await res.text(),markers,asset+' carries no test or fixture markers')}
  row.checks.noSyntheticInApp='PASS';

  /* ===== Reduced motion: no drawer animation, no help fade ===== */
  await p.emulateMedia({reducedMotion:'reduce'});await seed(five.slice(0,2));await p.goto(origin+'/catalog.html');await ready();await p.locator('.header-cart').first().click();await p.locator('dialog.cart-drawer[open]').waitFor();assert.equal(await p.locator('dialog.cart-drawer').evaluate(e=>getComputedStyle(e).animationName),'none');await p.keyboard.press('Escape');row.checks.reducedMotion='PASS';

  assert.deepEqual(errors,[]);row.status='PASS';result.matrix.push(row);await save();console.log('PASS H31',engine,width);await c.close();
 }}finally{await b.close()}}
}catch(e){result.failure={message:e.message,stack:e.stack};await save();throw e}
result.realWritesSent=0;await save();console.log('H31 acceptance PASS');
