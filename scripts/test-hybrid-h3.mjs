/** H3 premium cart & checkout acceptance. Every POST (legal preview, order) is answered by the test, never sent:
 *  no order, token or row is ever created, locally or on a hosted Preview. */
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile,mkdir}from'node:fs/promises';import path from'node:path';
const require=createRequire(path.join(process.env.EGE_BROWSER_TOOLS,'package.json'));const{chromium,firefox,webkit}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const origin=new URL(process.env.EGE_H3_ORIGIN||'https://127.0.0.1:44394').origin,hosted=new URL(origin).hostname.endsWith('.vercel.app');
assert.ok(hosted?new URL(origin).hostname.startsWith('ege-teknik-phase3a-'):new URL(origin).hostname==='127.0.0.1');
const oidc=process.env.VERCEL_OIDC_TOKEN;if(hosted)assert.ok(oidc,'hosted runs need the local OIDC token (never printed)');
const out=process.env.EGE_H3_OUTPUT||'.scratch/h3/accept';await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile('.scratch/h12/inputs/catalog.json')),charges=JSON.parse(await readFile('.scratch/h3/charges.json'));
const LOW_ID='airy-9000-btu-h',localCatalog={products:fixture.products.map(p=>p.id===LOW_ID?{...p,stock:2}:p)};
const LEGAL_REQUIRED={documents:[{versionId:'h3-terms',title:'Sentetik satış koşulları',slug:'terms',version:'test-1'},{versionId:'h3-distance',title:'Sentetik mesafeli satış sözleşmesi',slug:'distance',version:'test-1'}]};
// Hosted: the page renders its consent boxes from the real required documents, so the synthetic preview must carry the same version ids (read with GET only).
let previewDocs=LEGAL_REQUIRED.documents;
if(hosted){const res=await fetch(origin+'/api/legal/required',{headers:{'x-vercel-trusted-oidc-idp-token':oidc}});assert.equal(res.status,200,'required legal documents readable');previewDocs=(await res.json()).documents;assert.ok(previewDocs.length>=1)}
const result={origin,hosted,applicationCommit:process.env.EGE_H3_SHA,matrix:[],contrasts:[],axeScans:0,interceptedWrites:[],realWritesSent:0,orderCreated:false};
const save=()=>writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(n);

async function audit(p,label){await p.waitForTimeout(550);const a=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],label);result.axeScans++;assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' horizontal overflow')}
async function contrast(p,scope,label){const rows=await p.locator(scope).evaluateAll(roots=>{
 const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const bg=e=>{let color=[255,255,255];const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);for(const n of chain){const c=rgb(getComputedStyle(n).backgroundColor),alpha=c[3]??1;color=color.map((x,i)=>c[i]*alpha+x*(1-alpha))}return color};
 const rows=[];for(const root of roots){const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=walk.nextNode())){const e=n.parentElement,text=n.textContent.trim();if(!text||!e.getClientRects().length||e.closest('[hidden],script,style,option,.sr-only,select,[disabled],[aria-hidden=true]')||getComputedStyle(e).visibility==='hidden')continue;
  let opacity=1;for(let a=e;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);if(opacity===0)continue;const back=bg(e),fg=rgb(getComputedStyle(e).color),alpha=(fg[3]??1)*opacity,rendered=back.map((v,i)=>fg[i]*alpha+v*(1-alpha));rows.push({text:text.slice(0,60),ratio:ratio(rendered,back)})}}return rows});
 assert.ok(rows.length,label+' rendered text missing');for(const r of rows)assert.ok(r.ratio>=4.5,`${label}: ${r.text} ratio ${r.ratio}`);result.contrasts.push({label,minimum:Math.min(...rows.map(r=>r.ratio)),count:rows.length})}

try{for(const[engine,type]of[['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
 if(process.env.EGE_H3_ENGINES&&!process.env.EGE_H3_ENGINES.split(',').includes(engine))continue;
 const b=await type.launch({headless:true,...(engine==='chrome'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{for(const width of(process.env.EGE_H3_WIDTHS?process.env.EGE_H3_WIDTHS.split(',').map(Number):[1440,1024,768,390,320])){
  const mobile=width<=1000,c=await b.newContext({viewport:{width,height:mobile?844:900},ignoreHTTPSErrors:!hosted});c.setDefaultTimeout(20000);
  await c.addCookies([{name:'ege_analytics_consent',value:'0',url:origin}]);
  // Order endpoint behaviour is scripted per scenario; nothing reaches a server.
  const orderPlan=[];let orderPosts=0,previewPosts=0;
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())){result.interceptedWrites.push({method:q.method(),path:u.pathname});
    if(u.pathname==='/api/checkout/legal-preview'){previewPosts++;const body=JSON.parse(q.postData()||'{}');return r.fulfill({json:{legalPreviewToken:'h3-synthetic-preview-token-'+previewPosts,orderNumber:'ETS-H3-SYNTH',orderIssuedAt:new Date().toISOString(),expiresAt:Date.now()+30*60e3,documents:previewDocs.map(d=>({documentVersionId:d.versionId,title:d.title,slug:d.slug,version:d.version,renderedBody:`${d.title}\nAlıcı: ${body.customerName}\nSentetik önizleme.`}))}})}
    if(u.pathname==='/api/orders'){orderPosts++;const step=orderPlan.shift()||{status:201};if(step.delay)await new Promise(res=>setTimeout(res,step.delay));if(step.abort)return r.abort('failed');return r.fulfill({status:step.status,json:step.json??{}})}
    return r.fulfill({status:204})}
   if(!hosted&&u.pathname.startsWith('/api/')){if(u.pathname==='/api/products')return r.fulfill({json:localCatalog});if(u.pathname.includes('/reviews'))return r.fulfill({json:{reviews:[],summary:{count:0,average:null}}});if(u.pathname.startsWith('/api/products/')){const prod=localCatalog.products.find(x=>x.id===decodeURIComponent(u.pathname.split('/')[3]));return prod?r.fulfill({json:{product:{...prod,gallery:[],specifications:[],documents:[],warranty:null}}}):r.fulfill({status:404,json:{}})}if(u.pathname==='/api/legal/required')return r.fulfill({json:LEGAL_REQUIRED});if(u.pathname==='/api/checkout/charges')return r.fulfill({json:charges});return r.fulfill({json:{events:[]}})}
   return r.continue(hosted&&u.origin===origin?{headers:{...q.headers(),'x-vercel-trusted-oidc-idp-token':oidc}}:undefined)});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const row={engine,version:b.version(),width,checks:{}};
  const shot=async name=>{if(engine==='chrome'&&[1440,390].includes(width))await p.screenshot({path:`${out}/${name}-${width}.png`})};
  const addFromProduct=async id=>{await p.goto(origin+'/product.html?id='+encodeURIComponent(id));await p.waitForFunction(()=>catalogState==='ready'&&productDetailState==='ready');await p.locator('.pd-buy [data-action=add-product-cart]').click();await p.locator('dialog.cart-drawer[open]').waitFor()};
  const drawerOpen=async()=>{await p.locator('.header-cart').first().click();await p.locator('dialog.cart-drawer[open]').waitFor();await p.waitForTimeout(250)};

  /* 1. Empty cart */
  await p.goto(origin+'/catalog.html');await p.waitForFunction(()=>catalogState==='ready'&&document.querySelector('[data-products] .product:not(.product-skeleton)'));
  const products=await p.evaluate(()=>getProducts().filter(x=>x.sale&&x.stock>0&&x.price>0).map(x=>({id:x.id,name:x.name,price:x.price,stock:x.stock})));
  assert.ok(products.length>=2,'two purchasable products');const [A,B2]=products;
  await drawerOpen();assert.match(await p.locator('.cart-drawer-empty').innerText(),/Konfor seçiminiz burada görünecek/);assert.equal(await p.locator('[data-drawer-foot]').isHidden(),true,'no totals for an empty cart');
  assert.equal(await p.evaluate(()=>document.activeElement.matches('[data-drawer-close]')),true,'focus starts on close');
  assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).overflow),'hidden','page scroll locked behind the drawer');
  await audit(p,`${engine}/${width}/cart-empty`);await shot('cart-empty');await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog.cart-drawer[open]'));

  /* 2-3. One then two products; quantity and removal; legal invalidation trigger; focus trap */
  await addFromProduct(A.id);
  // Opening re-validates the catalog first (H1.1); the add message follows once prices are authoritative.
  await p.waitForFunction(()=>/sepete eklendi/.test(document.querySelector('.cart-drawer-status').textContent));assert.equal(await p.locator('[data-drawer-count]').innerText(),'1 ürün · 1 adet');
  await p.keyboard.press('Escape');await addFromProduct(B2.id);
  await p.waitForFunction(()=>document.querySelector('[data-drawer-count]').textContent==='2 ürün · 2 adet');
  for(let i=0;i<30;i++)await p.keyboard.press(engine==='webkit'?'Alt+Tab':'Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('dialog.cart-drawer')),true,'focus trapped in the drawer');
  await p.locator(`[data-drawer-action=step][data-step="1"][data-cart-id="${A.id}"]`).click();await p.waitForFunction(id=>document.querySelector(`#drawer-quantity-${CSS.escape(id)}`)?.value==='2',A.id);
  assert.equal(await p.locator('[data-drawer-subtotal]').innerText(),money(A.price*2+B2.price));assert.ok(await p.evaluate(()=>!!document.activeElement.closest('dialog.cart-drawer')),'focus stays in the drawer after a quantity change');
  await contrast(p,'dialog.cart-drawer',`${engine}/${width}/cart-filled`);await audit(p,`${engine}/${width}/cart-filled`);await shot('cart-filled');
  await p.locator(`[data-drawer-action=remove][data-cart-id="${B2.id}"]`).click();await p.waitForFunction(()=>document.querySelector('[data-drawer-count]').textContent==='1 ürün · 2 adet');
  assert.ok(await p.evaluate(()=>!!document.activeElement.closest('dialog.cart-drawer')),'focus stays in the drawer after removal');
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog.cart-drawer[open]'));

  /* 4. Stock shortage: the cart holds more than stock; the drawer explains and fixes it (local stock edit; hosted uses cart > stock) */
  const short=hosted?products.find(x=>x.stock<10):products.find(x=>x.id===LOW_ID);
  if(short){await p.evaluate(([a,s])=>localStorage.setItem('ege-cart',JSON.stringify([{productId:a,quantity:1},{productId:s.id,quantity:Math.min(10,s.stock+1)}])),[A.id,short]);await p.reload();await p.waitForFunction(()=>catalogState==='ready');await drawerOpen();
   assert.match(await p.locator('.cart-drawer-warning').innerText(),new RegExp(`Stokta ${short.stock} adet var`));assert.equal(await p.locator('[data-drawer-checkout]').isHidden(),true,'checkout blocked while a line is over stock');assert.match(await p.locator('.cart-drawer-status').innerText(),/1 üründe düzeltme gerekiyor/);
   await p.locator('.cart-drawer-fix').click();await p.waitForFunction(()=>!document.querySelector('.cart-drawer-warning'));assert.equal(await p.locator('[data-drawer-checkout]').isVisible(),true);row.checks.stockFix='PASS';await p.keyboard.press('Escape')}
  else row.checks.stockFix='no product with stock below the cart limit on this catalog';

  /* 5. Tampered client price never reaches the order or the display */
  await p.evaluate(a=>localStorage.setItem('ege-cart',JSON.stringify([{productId:a,quantity:2,price:1,unitPrice:1,total:2}])),A.id);
  await p.goto(origin+'/checkout.html');await p.waitForFunction(()=>document.querySelector('[data-cart-items]')?.innerText.includes('×'));await p.waitForTimeout(300);
  assert.ok((await p.locator('[data-cart-items]').innerText()).includes(money(A.price*2)),'checkout shows the catalog price');assert.doesNotMatch(await p.locator('[data-checkout-form]').innerText(),/₺1(?![\d.,])/,'tampered price never shown');
  await contrast(p,'.checkout-grid',`${engine}/${width}/checkout`);await audit(p,`${engine}/${width}/checkout`);await p.evaluate(()=>scrollTo(0,0));await shot('checkout');

  /* 6. Validation: errors gate the legal preview; summary takes focus; fields are described */
  await p.locator('[data-legal-preview-prepare]').click();await p.locator('[data-checkout-errors]:not([hidden])').waitFor();
  assert.equal(await p.evaluate(()=>document.activeElement.matches('[data-checkout-errors]')),true,'error summary focused');assert.equal(previewPosts,0,'no preview request with invalid fields');
  const invalid=await p.evaluate(()=>[...document.querySelectorAll('[aria-invalid=true]')].map(e=>[e.name,e.getAttribute('aria-describedby')]));for(const n of ['customerName','phone','email'])assert.ok(invalid.some(([x,d])=>x===n&&d.includes(`co-${n==='customerName'?'name':n}-error`)),n+' described');
  await audit(p,`${engine}/${width}/checkout-validation`);await p.evaluate(()=>document.querySelector('[data-checkout-errors]').scrollIntoView({block:'start'}));await shot('checkout-validation');
  await p.locator('[data-focus-field="co-email"]').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'co-email','summary link moves focus to the field');
  await p.locator('#co-name').fill('Sentetik Müşteri');await p.locator('#co-phone').fill('0532 000 00 00');await p.locator('#co-email').fill('h3@example.test');
  await p.locator('[name=city]').selectOption('Aydın');await p.waitForFunction(()=>!document.querySelector('[name=district]').disabled);await p.locator('[name=district]').selectOption('Kuşadası');await p.locator('[name=address]').fill('Sentetik Mahallesi Test Sokak No 1');
  await p.waitForFunction(()=>!document.querySelector('[data-checkout-errors]:not([hidden])'));

  /* 7. Legal preview, then a cart change invalidates it */
  await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>document.querySelectorAll('[data-legal-version]:not(:disabled)').length>=1);
  await p.locator('[data-legal-version]').evaluateAll(es=>es.forEach(e=>e.click()));
  await p.locator('[data-open-cart-drawer]').click();await p.locator('dialog.cart-drawer[open]').waitFor();await p.locator(`[data-drawer-action=step][data-step="-1"][data-cart-id="${A.id}"]`).click();await p.keyboard.press('Escape');
  assert.equal(await p.locator('[data-legal-version]:checked').count(),0,'cart change unchecks legal consent');const posts=orderPosts;await p.locator('[data-submit-order]').click();await p.waitForFunction(()=>/yasal metinleri kabul etmelisiniz|hukuki metinleri oluşturup onaylamanız/.test(document.querySelector("[data-order-result]").textContent));assert.equal(orderPosts,posts,'no order request after the cart changed the legal context');row.checks.legalInvalidation='PASS';
  const prepareAndAccept=async()=>{await p.locator('[data-legal-preview-prepare]').click();await p.waitForFunction(()=>document.querySelectorAll('[data-legal-version]:not(:disabled)').length>=1);await p.locator('[data-legal-version]').evaluateAll(es=>es.forEach(e=>{if(!e.checked)e.click()}));await p.waitForFunction(()=>!document.querySelector('[data-submit-order]').disabled)};

  /* 10. Server error then retry; inputs and cart kept; same attempt key reused */
  await prepareAndAccept();const keys=[];p.on('request',q=>{if(q.url().endsWith('/api/orders'))keys.push(q.headers()['idempotency-key'])});
  orderPlan.push({status:503,json:{}});await p.locator('[data-submit-order]').click();await p.waitForFunction(()=>document.querySelector('[data-order-result]').classList.contains('is-error'));
  assert.match(await p.locator('[data-order-result]').innerText(),/Sunucuda geçici bir sorun oluştu; sipariş kaydedilmedi\. Bilgileriniz ve sepetiniz korunuyor/);assert.equal(await p.locator('#co-name').inputValue(),'Sentetik Müşteri');assert.equal(await p.locator('[data-submit-order]').innerText(),'Tekrar Dene');
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('ege-cart')).length),1,'cart kept after a failed order');
  // Floating help and cookie-settings buttons never sit on the error message.
  await p.locator('[data-order-result]').scrollIntoViewIfNeeded();await p.waitForTimeout(500);
  const covered=await p.evaluate(()=>{const err=document.querySelector('[data-order-result]').getBoundingClientRect();return [...document.querySelectorAll('.help-toggle,.cookie-settings-trigger')].filter(b=>{const w=b.closest('[data-help]')||b,cs=getComputedStyle(w);if(cs.visibility==='hidden'||cs.opacity==='0')return false;const r=b.getBoundingClientRect();return r.left<err.right&&r.right>err.left&&r.top<err.bottom&&r.bottom>err.top}).map(b=>b.className)});
  assert.deepEqual(covered,[],'floating buttons cover the order error');
  await audit(p,`${engine}/${width}/checkout-error`);await p.locator('[data-order-result]').scrollIntoViewIfNeeded();await shot('checkout-error');
  orderPlan.push({abort:true});await p.locator('[data-submit-order]').click();await p.waitForFunction(()=>/Bağlantı kurulamadı/.test(document.querySelector('[data-order-result]').textContent));row.checks.networkError='PASS';

  /* 4b. Server stock refusal is shown as sent */
  orderPlan.push({status:409,json:{error:`${A.name} için yeterli stok yok.`}});await p.locator('[data-submit-order]').click();await p.waitForFunction(n=>document.querySelector('[data-order-result]').textContent.includes(n+' için yeterli stok yok.'),A.name);row.checks.serverStock='PASS';
  // A stock refusal re-reads the catalog; retrying while it loads gets an honest 'updating' message, not 'refresh the page'.
  await p.waitForFunction(()=>catalogState==='ready');

  /* 8-9. Duplicate submit then success: one POST, confirmation only after 2xx, cart cleared, honest payment copy */
  const before=orderPosts;orderPlan.push({status:201,delay:3000,json:{ok:true,orderNumber:'ETS-H3-SYNTH',items:[{productName:A.name,unitPrice:A.price,quantity:1,lineTotal:A.price}],vatTotal:Math.round(A.price/6),total:A.price,shippingTotal:0,delivery:{method:'dealer',installation:'included_standard',name:'Sentetik Müşteri',phone:'0532 000 00 00',email:'h3@example.test',address:'Sentetik Mahallesi Test Sokak No 1',city:'Aydın',district:'Kuşadası'},legalAcceptances:previewDocs.map(d=>({slug:d.slug,documentVersionId:d.versionId,title:d.title,version:d.version}))}});
  await p.locator('[data-submit-order]').evaluate(btn=>{btn.click();btn.click();btn.form.requestSubmit(btn)});
  assert.equal(await p.locator('[data-submit-order]').isDisabled(),true,'submit disabled while in flight: '+JSON.stringify(await p.evaluate(()=>({result:document.querySelector('[data-order-result]').textContent,checked:document.querySelectorAll('[data-legal-version]:checked').length,boxes:document.querySelectorAll('[data-legal-version]').length,preview:!!legalPreview}))));assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('ege-cart')).length),1,'cart untouched before the server answers');
  await p.locator('[data-order-confirmation]:not([hidden])').waitFor();assert.equal(orderPosts-before,1,'exactly one order request for a triple submit');
  assert.equal(await p.evaluate(()=>localStorage.getItem('ege-cart')),'[]','cart cleared only after the confirmed order');
  assert.match(await p.locator('[data-confirmation-payment-notice]').innerText(),/ödeme tahsil edilmedi/);assert.equal(await p.evaluate(()=>document.activeElement.matches('[data-confirmation-heading]')),true,'focus on the confirmation heading');
  assert.equal(new Set(keys.slice(0,3)).size,1,'retries of the same order reuse one idempotency key');
  await audit(p,`${engine}/${width}/confirmation`);row.checks.duplicateSubmit='PASS';row.checks.success='PASS';

  /* 12. Reduced motion: drawer opens without animation */
  await p.emulateMedia({reducedMotion:'reduce'});await p.goto(origin+'/catalog.html');await p.waitForFunction(()=>catalogState==='ready');await drawerOpen();
  assert.equal(await p.locator('dialog.cart-drawer').evaluate(e=>getComputedStyle(e).animationName),'none');await p.keyboard.press('Escape');row.checks.reducedMotion='PASS';

  /* 11b. Phone action bar: visible with total while submit is off screen, absent on desktop */
  await p.evaluate(a=>localStorage.setItem('ege-cart',JSON.stringify([{productId:a,quantity:1}])),A.id);await p.goto(origin+'/checkout.html');await p.waitForFunction(()=>document.querySelector('[data-cart-items]')?.innerText.includes('×'));await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(400);
  const bar=await p.locator('[data-checkout-bar]').evaluate(e=>({hidden:e.hidden,display:getComputedStyle(e).display}));
  if(mobile){assert.equal(bar.hidden,false,'phone bar visible');await p.locator('[data-checkout-continue]').click();await p.locator('[data-checkout-errors]:not([hidden])').waitFor();row.checks.mobileBar='PASS'}else assert.ok(bar.hidden||bar.display==='none','no phone bar on desktop');

  assert.deepEqual(errors,[]);row.status='PASS';result.matrix.push(row);await save();console.log('PASS H3',engine,width);await c.close();
 }}finally{await b.close()}}
}catch(e){result.failure={message:e.message,stack:e.stack};await save();throw e}
result.realWritesSent=0;await save();console.log('H3 acceptance PASS');
