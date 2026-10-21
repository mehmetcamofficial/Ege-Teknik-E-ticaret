/* H1.1: a view over the existing ege-cart/writeCart domain, never a second cart store. */
(()=>{
 let dialog,body,status,checkout,subtotal,vat,count,blocked,foot,returnFocus,lastAddTrigger,message='';
 function refresh(){
  if(!dialog?.open)return;
  const active=document.activeElement,restore=body.contains(active)?{action:active.dataset?.drawerAction,id:active.dataset?.cartId,step:active.dataset?.step,href:active.getAttribute?.('href')}:null;
  const loading=catalogState==='loading';
  body.setAttribute('aria-busy',String(loading));
  if(!catalogAuthoritative()){
   if(body.contains(active))dialog.querySelector('[data-drawer-close]').focus();
   status.textContent=catalogNotice();
   body.innerHTML=loading?'<div class="cart-drawer-loading" aria-hidden="true">'+[1,2].map(()=>'<div class="cart-drawer-skeleton"><div></div><p></p><p></p></div>').join('')+'</div>':'<div class="cart-drawer-empty"><h3>Sepet bilgileri alınamadı.</h3><p>Fiyat ve stok doğrulanmadan sipariş adımına geçilemez.</p><button type="button" class="ghost" data-drawer-retry>Yeniden dene</button></div>';
   subtotal.textContent='—';checkout.hidden=true;return;
  }
  const lines=cartLines(getCart(),getProducts());
  const valid=line=>line.available&&Number.isFinite(line.product.price)&&line.product.price>0&&line.quantity<=productQuantityLimit(line.product.stock)&&productQuantityLimit(line.product.stock)>0;
  // H3: say exactly what is wrong with a line and what fixes it; the server still re-checks price and stock.
  const issue=line=>{const p=line.product,limit=p?productQuantityLimit(p.stock):0;if(!p)return 'Bu ürün katalogda bulunamadı. Lütfen sepetten kaldırın.';if(!p.sale)return 'Bu ürün artık online satışta değil. Teklif için bizimle iletişime geçebilirsiniz.';if(!(Number.isFinite(p.price)&&p.price>0))return 'Ürün fiyatı doğrulanamadı. Ürünü kaldırın ya da daha sonra tekrar deneyin.';if(!limit)return 'Bu ürün stokta kalmadı. Siparişe devam etmek için ürünü kaldırın.';if(line.quantity>limit)return `Stokta ${limit} adet var. Adedi ${limit} veya daha az yapın.`;return ''};
  const allValid=lines.length>0&&lines.every(valid);
  const problems=lines.filter(l=>issue(l)).length;
  status.textContent=message||(!lines.length?'Sepetiniz boş.':problems?`${problems} üründe düzeltme gerekiyor; ayrıntılar ürünün altında.`:'Fiyatlar güncel katalogdan alınır.');status.classList.toggle('has-problem',!message&&problems>0);
  const units=lines.reduce((n,l)=>n+l.quantity,0);count.textContent=lines.length?`${lines.length} ürün · ${units} adet`:'';
  body.innerHTML=lines.length?lines.map(line=>{
   const p=line.product,id=esc(line.productId),limit=p?productQuantityLimit(p.stock):0,price=Number.isFinite(p?.price)&&p.price>0;
   const variant=p?[formatCapacity(p.capacity),productColour(p),p.sku?'Model: '+p.sku:''].filter(Boolean).join(' · '):'',problem=issue(line);
   return `<article class="cart-drawer-item"><div class="cart-drawer-media">${p?(productImageMarkup(p,'cart-drawer-image','lazy')||productImagePlaceholder(p.name)):productImagePlaceholder('Ürün')}</div><div class="cart-drawer-info"><h3>${p?`<a href="product.html?id=${encodeURIComponent(line.productId)}">${esc(p.name)}</a>`:'Ürün doğrulanamadı'}</h3>${variant?`<p class="cart-drawer-variant">${esc(variant)}</p>`:''}<p class="cart-drawer-unit-price">Birim fiyat: <b>${price?money(p.price):'Doğrulanamadı'}</b></p>${p?`<p class="cart-drawer-stock">Stok: ${esc(p.stock)} adet · Sipariş sınırı: ${limit} adet</p>`:''}${problem?`<p class="cart-drawer-warning" role="alert">${esc(problem)}${p&&limit&&line.quantity>limit?` <button type="button" class="cart-drawer-fix" data-drawer-action="fix" data-cart-id="${id}">Adedi ${limit} yap</button>`:''}</p>`:''}<div class="cart-drawer-item-actions"><div class="cart-drawer-quantity" role="group" aria-label="${esc(p?.name||'Ürün')} adedi"><button type="button" data-drawer-action="step" data-step="-1" data-cart-id="${id}" aria-label="${esc(p?.name||'Ürün')} adedini azalt"${!limit||line.quantity<=1?' disabled':''}>−</button><label class="sr-only" for="drawer-quantity-${id}">${esc(p?.name||'Ürün')} adedi</label><input id="drawer-quantity-${id}" data-drawer-action="quantity" data-cart-id="${id}" type="number" inputmode="numeric" min="1" max="${limit}" value="${line.quantity}"${!limit?' disabled':''}><button type="button" data-drawer-action="step" data-step="1" data-cart-id="${id}" aria-label="${esc(p?.name||'Ürün')} adedini artır"${!limit||line.quantity>=limit?' disabled':''}>+</button></div><button type="button" class="cart-drawer-remove" data-drawer-action="remove" data-cart-id="${id}" aria-label="${esc(p?.name||'Ürün')} ürününü kaldır">Kaldır</button></div><p class="cart-drawer-line-total">Satır toplamı <b>${price?money(p.price*line.quantity):'—'}</b></p></div></article>`;
  }).join(''):'<div class="cart-drawer-empty"><h3>Konfor seçiminiz burada görünecek.</h3><p>Güncel GREE modellerini inceleyerek başlayabilirsiniz.</p><a class="ghost" href="catalog.html">Klimaları inceleyin</a></div>';
  subtotal.textContent=allValid?money(cartTotal(lines)):'—';vat.textContent=allValid?money(cartVat(lines)):'—';checkout.hidden=!allValid;blocked.hidden=allValid||!lines.length;foot.hidden=!lines.length;
  // H3: focus never falls back to the page behind the modal; a vanished control hands focus to its line's quantity.
  if(restore){const usable=el=>el&&!el.disabled;const target=[...body.querySelectorAll('[data-drawer-action]')].find(el=>restore.action&&el.dataset.drawerAction===restore.action&&el.dataset.cartId===restore.id&&el.dataset.step===restore.step&&usable(el))||(restore.id?[...body.querySelectorAll('[data-drawer-action="quantity"]')].find(el=>el.dataset.cartId===restore.id&&usable(el)):null)||(restore.href?[...body.querySelectorAll('a[href]')].find(el=>el.getAttribute('href')===restore.href):null);(target||body.querySelector('button:not(:disabled),a[href]')||dialog.querySelector('[data-drawer-close]')).focus()}
 }
 function feedback(text){if(dialog?.open){message=text;status.textContent=text}}
 function open(text='',trigger=lastAddTrigger||document.activeElement){
  if(!dialog||typeof dialog.showModal!=='function')return false;
  message=text;
  if(!dialog.open){
   returnFocus=trigger;
   if(document.querySelector('.nav-bar.open'))setMenu(document.querySelector('.store-nav>.menu-toggle'),false);
   if(document.querySelector('.catalog-filters.open'))setFiltersOpen(false);
   dialog.showModal();document.documentElement.classList.add('cart-drawer-open');
   dialog.querySelector('[data-drawer-close]').focus();
  }
  refresh();void loadCatalog();return true;
 }
 function init(){
  dialog=document.createElement('dialog');dialog.className='cart-drawer';dialog.id='cart-drawer';dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','cart-drawer-title');
  dialog.innerHTML='<header class="cart-drawer-head"><div><span>ALIŞVERİŞİNİZ</span><h2 id="cart-drawer-title">Sepetiniz</h2><small class="cart-drawer-count" data-drawer-count></small></div><button type="button" class="ghost" data-drawer-close aria-label="Sepeti kapat" autofocus>×</button></header><p class="cart-drawer-status" role="status" aria-live="polite"></p><div class="cart-drawer-body"></div><footer class="cart-drawer-foot" data-drawer-foot><div class="cart-drawer-subtotal"><span>Ara toplam</span><b data-drawer-subtotal>—</b></div><div class="cart-drawer-breakdown"><span>İçindeki KDV</span><span data-drawer-vat>—</span><span>Teslimat / montaj</span><span>Sipariş adımında gösterilir</span></div><p>Tutarlar KDV dahildir ve sipariş sırasında sunucuda yeniden doğrulanır. Bu aşamada ödeme alınmaz.</p><p class=\"cart-drawer-short\">KDV dahil · ödeme bu adımda alınmaz</p><p class="cart-drawer-blocked" data-drawer-blocked hidden>Sipariş adımına geçmek için yukarıdaki uyarıları düzeltin.</p><a class="primary" href="checkout.html" data-drawer-checkout>Sipariş adımına geç</a><button type="button" class="ghost" data-drawer-close>Alışverişe devam et</button></footer>';
  document.body.appendChild(dialog);body=dialog.querySelector('.cart-drawer-body');status=dialog.querySelector('.cart-drawer-status');checkout=dialog.querySelector('[data-drawer-checkout]');subtotal=dialog.querySelector('[data-drawer-subtotal]');vat=dialog.querySelector('[data-drawer-vat]');count=dialog.querySelector('[data-drawer-count]');blocked=dialog.querySelector('[data-drawer-blocked]');foot=dialog.querySelector('[data-drawer-foot]');
  dialog.addEventListener('keydown',event=>{
   if(event.key!=='Tab')return;
   const controls=[...dialog.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);
   const first=controls[0],last=controls.at(-1);
   if(!dialog.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first)?.focus();return}
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  });
  dialog.addEventListener('close',()=>{
   document.documentElement.classList.remove('cart-drawer-open');message='';
   // A fresh catalog response can replace the original product button while the modal is open.
   const available=el=>el?.isConnected&&!el.disabled&&el.getClientRects().length;
   const replacement=returnFocus?.dataset.action?[...document.querySelectorAll('[data-action]')].find(el=>el.dataset.action===returnFocus.dataset.action&&el.dataset.id===returnFocus.dataset.id&&available(el)):null;
   (available(returnFocus)?returnFocus:replacement||document.querySelector('.header-cart,[data-open-cart-drawer]'))?.focus();
  });
  dialog.addEventListener('click',event=>{
   if(event.target.closest('[data-drawer-retry]')){message='';void loadCatalog();return}
   if(event.target.closest('[data-drawer-checkout]')&&location.pathname.endsWith('/checkout.html')){event.preventDefault();dialog.close();return}
   if(event.target.closest('[data-drawer-close]')){dialog.close();return}
   if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right)dialog.close();return}
   const control=event.target.closest('[data-drawer-action]');if(!control||control.disabled||control.dataset.drawerAction==='quantity')return;
   message='';const id=control.dataset.cartId;
   if(control.dataset.drawerAction==='remove'){if(removeCart(id))message='Ürün sepetten kaldırıldı.'}
   else if(control.dataset.drawerAction==='fix'){const p=getProducts().find(x=>x.id===id);if(p&&changeCartQuantity(id,productQuantityLimit(p.stock)))message='Ürün adedi stoğa göre düzeltildi.'}
   else{const line=getCart().find(x=>x.productId===id),p=getProducts().find(x=>x.id===id);if(line){const q=Math.min(line.quantity+Number(control.dataset.step),productQuantityLimit(p?.stock));if(changeCartQuantity(id,q))message='Ürün adedi güncellendi.'}}
   refresh();
  });
  dialog.addEventListener('change',event=>{const input=event.target.closest('[data-drawer-action="quantity"]');if(!input)return;message='';if(changeCartQuantity(input.dataset.cartId,input.value))message='Ürün adedi güncellendi.';refresh()});
  document.querySelectorAll('.header-cart,[data-open-cart-drawer]').forEach(link=>{link.hidden=false;link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-controls','cart-drawer');link.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;if(open('',link))event.preventDefault()})});
 }
 document.addEventListener('store:navigate',()=>{if(dialog?.open)status.textContent='Sayfa açılıyor…'});
 document.addEventListener('click',event=>{lastAddTrigger=event.target.closest('[data-action="add-cart"],[data-action="add-product-cart"]')},true);
 window.EgeCartDrawer={open,refresh,feedback};
 document.addEventListener('DOMContentLoaded',init);
 // No click interception, synthetic router or unload handler: browser form/history/scroll restoration stays native.
 window.addEventListener('pageshow',()=>{if(dialog?.open)dialog.close();document.documentElement.classList.remove('cart-drawer-open')});
})();
