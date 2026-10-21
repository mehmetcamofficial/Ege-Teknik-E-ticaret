/* H1.1: a view over the existing ege-cart/writeCart domain, never a second cart store. */
(()=>{
 let dialog,body,status,checkout,subtotal,returnFocus,message='';
 function refresh(){
  if(!dialog?.open)return;
  const active=document.activeElement,restore=active?.dataset.drawerAction?{action:active.dataset.drawerAction,id:active.dataset.cartId,step:active.dataset.step}:null;
  if(!catalogAuthoritative()){
   status.textContent=catalogNotice();body.innerHTML='<div class="cart-drawer-loading" aria-hidden="true">'+[1,2].map(()=>'<div class="cart-drawer-skeleton"><div></div><p></p><p></p></div>').join('')+'</div>';
   subtotal.textContent='—';checkout.hidden=true;return;
  }
  const lines=cartLines(getCart(),getProducts());
  const valid=line=>line.available&&Number.isFinite(line.product.price)&&line.product.price>0&&line.quantity<=productQuantityLimit(line.product.stock)&&productQuantityLimit(line.product.stock)>0;
  const allValid=lines.length>0&&lines.every(valid);
  status.textContent=message||(!lines.length?'Sepetiniz boş.':'Fiyatlar güncel katalogdan alınır.');
  body.innerHTML=lines.length?lines.map(line=>{
   const p=line.product,id=esc(line.productId),limit=p?productQuantityLimit(p.stock):0,price=Number.isFinite(p?.price)&&p.price>0;
   const variant=p?[p.capacity,p.sku?'Model: '+p.sku:'Model / varyant kodu paylaşılmamış'].filter(Boolean).join(' · '):'';
   return `<article class="cart-drawer-item"><div class="cart-drawer-media">${p?(productImageMarkup(p,'cart-drawer-image','lazy')||productImagePlaceholder(p.name)):productImagePlaceholder('Ürün')}</div><div class="cart-drawer-info"><h3>${p?`<a href="product.html?id=${encodeURIComponent(line.productId)}">${esc(p.name)}</a>`:'Ürün doğrulanamadı'}</h3><p>${esc(variant||'Model / varyant bilgisi paylaşılmamış')}</p><p>Birim fiyat: <b>${price?money(p.price):'Doğrulanamadı'}</b></p>${!valid(line)?'<p class="cart-drawer-warning">Stok veya satış koşulları değişti. Adedi düzeltin ya da ürünü kaldırın.</p>':''}<div class="cart-drawer-item-actions"><div class="cart-drawer-quantity" role="group" aria-label="${esc(p?.name||'Ürün')} adedi"><button type="button" data-drawer-action="step" data-step="-1" data-cart-id="${id}" aria-label="${esc(p?.name||'Ürün')} adedini azalt"${!limit||line.quantity<=1?' disabled':''}>−</button><label class="sr-only" for="drawer-quantity-${id}">${esc(p?.name||'Ürün')} adedi</label><input id="drawer-quantity-${id}" data-drawer-action="quantity" data-cart-id="${id}" type="number" inputmode="numeric" min="1" max="${limit}" value="${line.quantity}"${!limit?' disabled':''}><button type="button" data-drawer-action="step" data-step="1" data-cart-id="${id}" aria-label="${esc(p?.name||'Ürün')} adedini artır"${!limit||line.quantity>=limit?' disabled':''}>+</button></div><button type="button" class="cart-drawer-remove" data-drawer-action="remove" data-cart-id="${id}" aria-label="${esc(p?.name||'Ürün')} ürününü kaldır">Kaldır</button></div><p class="cart-drawer-line-total">Satır toplamı <b>${price?money(p.price*line.quantity):'—'}</b></p></div></article>`;
  }).join(''):'<div class="cart-drawer-empty"><h3>Konfor seçiminiz burada görünecek.</h3><p>Güncel GREE modellerini inceleyerek başlayabilirsiniz.</p><a class="ghost" href="catalog.html">Klimaları inceleyin</a></div>';
  subtotal.textContent=allValid?money(cartTotal(lines)):'—';checkout.hidden=!allValid;
  if(restore){const target=[...body.querySelectorAll('[data-drawer-action]')].find(el=>el.dataset.drawerAction===restore.action&&el.dataset.cartId===restore.id&&el.dataset.step===restore.step&&!el.disabled);(target||body.querySelector('button:not(:disabled),a[href]')||dialog.querySelector('[data-drawer-close]')).focus()}
 }
 function feedback(text){if(dialog?.open){message=text;status.textContent=text}}
 function open(text=''){
  if(!dialog||typeof dialog.showModal!=='function')return false;
  message=text;
  if(!dialog.open){
   returnFocus=document.activeElement;
   if(document.querySelector('.nav-bar.open'))setMenu(document.querySelector('.store-nav>.menu-toggle'),false);
   if(document.querySelector('.catalog-filters.open'))setFiltersOpen(false);
   dialog.showModal();document.documentElement.classList.add('cart-drawer-open');
   dialog.querySelector('[data-drawer-close]').focus();
  }
  refresh();void loadCatalog();return true;
 }
 function init(){
  dialog=document.createElement('dialog');dialog.className='cart-drawer';dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','cart-drawer-title');
  dialog.innerHTML='<header class="cart-drawer-head"><div><span>ALIŞVERİŞİNİZ</span><h2 id="cart-drawer-title">Sepetiniz</h2></div><button type="button" class="ghost" data-drawer-close aria-label="Sepeti kapat" autofocus>×</button></header><p class="cart-drawer-status" role="status" aria-live="polite"></p><div class="cart-drawer-body"></div><footer class="cart-drawer-foot"><div class="cart-drawer-subtotal"><span>Ara toplam</span><b data-drawer-subtotal>—</b></div><p>KDV dahil. Teslimat ve montaj koşulları sipariş adımında doğrulanır. Bu aşamada ödeme alınmaz.</p><a class="primary" href="checkout.html" data-drawer-checkout>Sipariş adımına geç</a><button type="button" class="ghost" data-drawer-close>Alışverişe devam et</button></footer>';
  document.body.appendChild(dialog);body=dialog.querySelector('.cart-drawer-body');status=dialog.querySelector('.cart-drawer-status');checkout=dialog.querySelector('[data-drawer-checkout]');subtotal=dialog.querySelector('[data-drawer-subtotal]');
  dialog.addEventListener('close',()=>{document.documentElement.classList.remove('cart-drawer-open');message='';(returnFocus?.isConnected?returnFocus:document.querySelector('.header-cart'))?.focus()});
  dialog.addEventListener('click',event=>{
   if(event.target.closest('[data-drawer-close]')){dialog.close();return}
   if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right)dialog.close();return}
   const control=event.target.closest('[data-drawer-action]');if(!control||control.disabled||control.dataset.drawerAction==='quantity')return;
   message='';const id=control.dataset.cartId;
   if(control.dataset.drawerAction==='remove'){if(removeCart(id))message='Ürün sepetten kaldırıldı.'}
   else{const line=getCart().find(x=>x.productId===id),p=getProducts().find(x=>x.id===id);if(line){const q=Math.min(line.quantity+Number(control.dataset.step),productQuantityLimit(p?.stock));if(changeCartQuantity(id,q))message='Ürün adedi güncellendi.'}}
   refresh();
  });
  dialog.addEventListener('change',event=>{const input=event.target.closest('[data-drawer-action="quantity"]');if(!input)return;message='';if(changeCartQuantity(input.dataset.cartId,input.value))message='Ürün adedi güncellendi.';refresh()});
  document.querySelectorAll('.header-cart').forEach(link=>{link.setAttribute('aria-haspopup','dialog');link.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;if(open())event.preventDefault()})});
 }
 window.EgeCartDrawer={open,refresh,feedback};
 document.addEventListener('DOMContentLoaded',init);
 // No click interception, synthetic router or unload handler: browser form/history/scroll restoration stays native.
 window.addEventListener('pageshow',()=>{if(dialog?.open)dialog.close();document.documentElement.classList.remove('cart-drawer-open')});
})();
