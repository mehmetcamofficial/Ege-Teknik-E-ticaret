/* eslint-disable @typescript-eslint/no-unused-vars -- called from the delegated data-action handler, page scripts and tests */
/* root-absolute so pages served below /legal/ load them too */
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(n);
/* Every value that is not a literal in this file (API data, admin-authored content, URL
   parameters) goes through esc() before it is interpolated into an innerHTML template,
   as text or as an attribute value. Nothing rendered here is intended to be rich HTML. */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/* Inline stroke icons (no icon font / CDN). Paths are static literals, never data. */
const ICONS={search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',heart:'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',compare:'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',close:'<path d="M18 6 6 18M6 6l12 12"/>',down:'<path d="m6 9 6 6 6-6"/>',arrow:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',phone:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',chat:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',tool:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',headset:'<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',check:'<path d="M20 6 9 17l-5-5"/>',calc:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',filter:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',clipboard:'<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',zap:'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',doc:'<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>',image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>'};
const ico=(name,size=20)=>`<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||''}</svg>`;
/* "12000 BTU/h" -> "12.000 BTU/h"; anything that is not a plain BTU figure is shown as served. */
const formatCapacity=c=>{const m=/^\s*(\d{4,6})\s*(BTU\/h)\s*$/i.exec(String(c||''));return m?new Intl.NumberFormat('tr-TR').format(Number(m[1]))+' '+m[2]:String(c||'')};
const productImageMarkup=(p,cls,loading)=>{const src=safeImageSrc(p.imageUrl);return src?`<img class="${cls}" data-product-image="main" src="${esc(src)}" alt="${esc(p.name)}" width="640" height="400" decoding="async"${loading?` loading="${loading}"`:''}>`:''};
const productImagePlaceholder=(name,detail=false)=>`<span class="product-image-unavailable${detail?' is-detail':''}" role="img" aria-label="${esc(name)} için doğrulanmış ürün görseli mevcut değil">${ico('image',detail?42:34)}<span>Doğrulanmış ürün görseli mevcut değil</span></span>`;
function handleBrokenProductImage(event){const img=event.target;if(!img?.matches?.('[data-product-image]'))return;if(img.dataset.productImage==='thumb'){img.closest?.('.gallery-thumb')?.remove();return}const box=document.createElement('span');box.className='product-image-unavailable'+(img.classList?.contains?.('detail-image')?' is-detail':'');box.setAttribute('role','img');box.setAttribute('aria-label',(img.getAttribute?.('alt')||'Ürün')+' için doğrulanmış ürün görseli mevcut değil');box.innerHTML=ico('image',img.classList?.contains?.('detail-image')?42:34)+'<span>Doğrulanmış ürün görseli mevcut değil</span>';img.replaceWith?.(box)}
/* Navigation driven by a data-* value is only followed when it resolves to this site: a
   relative/same-origin http(s) URL. javascript:, data:, vbscript:, //other-host and absolute
   external URLs resolve to a different origin or scheme and return null. */
function safeInternalHref(href){try{const url=new URL(String(href??''),location.href);if(url.origin!==location.origin||!/^https?:$/.test(url.protocol))return null;return url.pathname+url.search+url.hash}catch{return null}}
/* The catalog shown anywhere on the storefront (homepage, catalog, product, favorites,
   compare, checkout) is only ever what GET /api/products returned - there is no bundled
   fallback price list. Until it answers the UI says so ('loading'); if it fails it says
   that ('unavailable'). Orders are refused unless the state is 'ready', and the server
   re-prices every order line regardless of what the page displayed. */
let catalogProducts=[],catalogState='loading',productDetail=null,productDetailState='idle';
const getProducts=()=>catalogProducts;
function catalogAuthoritative(){return catalogState==='ready'}
function catalogNotice(){return catalogState==='loading'?'Ürün bilgileri yükleniyor…':'Ürün bilgileri şu anda alınamıyor. Lütfen daha sonra tekrar deneyin.'}
function renderProductViews(){renderCatalog();renderProductPage();renderFavorites();renderCompare();renderCheckout();renderFeaturedProducts();renderHomeDiscovery();updateCartCount()}
async function loadCatalog(){try{const response=await fetch('/api/products');if(!response.ok)throw new Error(`catalog ${response.status}`);const data=await response.json();catalogProducts=(Array.isArray(data.products)?data.products:[]).map(p=>({...p,energy:p.energyClass,sale:p.saleMode==='online'}));catalogState='ready';syncCatalogOptions();pruneCart()}catch{catalogState='unavailable';console.info('Ürün kataloğu alınamadı.')}if(document.querySelector('[data-product-page]')&&productDetailState==='idle')await loadProductDetail();renderProductViews()}

/* Cart state is only {productId, quantity}. Price, VAT, stock and totals always come from
   the catalog the server served, never from localStorage. */
const CART_MAX_QUANTITY=10,CART_MAX_LINES=20,PRODUCT_ID_PATTERN=/^[A-Za-z0-9._:-]{1,160}$/;
function normalizeCartEntries(raw,knownIds){
  if(!Array.isArray(raw))return [];
  const merged=new Map();
  for(const entry of raw){
    if(!entry||typeof entry!=='object')continue;
    const productId=typeof entry.productId==='string'&&entry.productId?entry.productId:(typeof entry.id==='string'?entry.id:'');
    if(!PRODUCT_ID_PATTERN.test(productId))continue;
    if(knownIds&&!knownIds.has(productId))continue;
    const parsed=Number(entry.quantity??entry.qty??1);
    const quantity=Number.isFinite(parsed)&&parsed>=1?Math.min(Math.floor(parsed),CART_MAX_QUANTITY):1;
    merged.set(productId,Math.min((merged.get(productId)||0)+quantity,CART_MAX_QUANTITY));
  }
  return [...merged].slice(0,CART_MAX_LINES).map(([productId,quantity])=>({productId,quantity}));
}
function cartLines(entries,products){
  const index=new Map((products||[]).map(p=>[p.id,p]));
  return (entries||[]).map(entry=>{const product=index.get(entry.productId)||null;return {productId:entry.productId,quantity:entry.quantity,product,available:Boolean(product&&product.sale)}});
}
function cartTotal(lines){return (lines||[]).reduce((sum,line)=>line.available?sum+line.product.price*line.quantity:sum,0)}
function orderItemsPayload(entries,products){return cartLines(entries,products).filter(line=>line.available).map(line=>({productId:line.productId,quantity:line.quantity}))}
function buildOrderPayload(fields,entries,products){return {customerName:fields.customerName||'',phone:fields.phone||'',email:fields.email||'',city:fields.city||'',address:fields.address||'',paymentProvider:fields.paymentProvider||'discovery',district:fields.district||'',...(fields.delivery?{delivery:fields.delivery}:{}),note:fields.note||'',legalAcceptances:fields.legalAcceptances||[],items:orderItemsPayload(entries,products)}}
/* Required legal documents come from GET /api/legal/required (server-decided version ids). Checkout only
   ever submits the ids of boxes the customer actively ticked; the server re-validates them. */
let legalRequirements=null;
async function loadLegalRequirements(){legalRequirements=null;try{const response=await fetch('/api/legal/required');const data=await response.json().catch(()=>({}));if(response.ok&&Array.isArray(data.documents)&&data.documents.length)legalRequirements=data.documents}catch{}renderLegalConsents();return legalRequirements}
/* Exact-version link: opens the very version whose id the box submits; opening it never ticks the box. */
function legalVersionHref(d){return '/legal/'+encodeURIComponent(d.slug)+'?version='+encodeURIComponent(d.versionId)}
function renderLegalConsents(){const root=document.querySelector('[data-legal-consents]');if(!root)return;root.innerHTML=legalRequirements?legalRequirements.map(d=>`<label class="consent"><input type="checkbox" data-legal-version="${esc(d.versionId)}"><span><a href="${esc(legalVersionHref(d))}" target="_blank" rel="noopener">${esc(d.title)}</a> metnini okudum ve kabul ediyorum.</span></label>`).join(''):'<p class="notice">Yasal metinler şu anda yüklenemedi; sipariş verilemiyor. Lütfen sayfayı yenileyin.</p>'}
function acceptedLegalVersionIds(boxes){return Array.from(boxes||[]).filter(box=>box.checked).map(box=>box.dataset.legalVersion)}
function legalConsentsComplete(requirements,acceptedIds){return Boolean(requirements&&requirements.length)&&requirements.every(d=>acceptedIds.includes(d.versionId))}
function orderAttemptKey(store){let key=null;try{key=store.getItem('ege-order-attempt')}catch{}if(!key){key=crypto.randomUUID();try{store.setItem('ege-order-attempt',key)}catch{}}return key}
function clearOrderAttemptKey(store){try{store.removeItem('ege-order-attempt')}catch{}}
function readCartRaw(){try{return JSON.parse(localStorage.getItem('ege-cart')||'[]')}catch{return []}}
function knownProductIds(){return catalogAuthoritative()?new Set(getProducts().map(p=>p.id)):null}
function writeCart(entries){localStorage.setItem('ege-cart',JSON.stringify(normalizeCartEntries(entries,null)));updateCartCount()}
/* Drops cart lines whose ids are not in the served catalog, so legacy ids such as
   "aphro-09" disappear instead of failing at checkout. */
function pruneCart(){if(!catalogAuthoritative())return 0;const before=normalizeCartEntries(readCartRaw(),null),after=normalizeCartEntries(before,knownProductIds());if(after.length!==before.length)writeCart(after);return before.length-after.length}
const getCart=()=>normalizeCartEntries(readCartRaw(),knownProductIds());
const saveCart=c=>writeCart(c);
const getFavorites=()=>JSON.parse(localStorage.getItem('ege-favorites')||'[]');
const getCompare=()=>JSON.parse(localStorage.getItem('ege-compare')||'[]');
function toggleFavorite(id){let ids=getFavorites();ids=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];localStorage.setItem('ege-favorites',JSON.stringify(ids));toast(ids.includes(id)?'Favorilere eklendi':'Favorilerden çıkarıldı');renderFavorites();updateFavoritesCount()}
function toggleCompare(id){let ids=getCompare();if(ids.includes(id))ids=ids.filter(x=>x!==id);else if(ids.length<4)ids.push(id);else return toast('En fazla 4 ürün karşılaştırılabilir');localStorage.setItem('ege-compare',JSON.stringify(ids));toast(ids.includes(id)?'Karşılaştırmaya eklendi':'Karşılaştırmadan çıkarıldı');renderCompare();updateFavoritesCount()}
function updateCartCount(){const count=getCart().reduce((sum,entry)=>sum+entry.quantity,0);document.querySelectorAll('[data-cart-count]').forEach(x=>x.textContent=count)}
function updateFavoritesCount(){for(const [sel,count] of [['[data-favorites-count]',getFavorites().length],['[data-compare-count]',getCompare().length]])document.querySelectorAll(sel).forEach(x=>{x.textContent=count;if(count)x.removeAttribute?.('data-zero');else x.setAttribute?.('data-zero','')})}
function toast(t){const e=document.querySelector('.toast');if(!e)return;e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)}
function productQuantityLimit(stock){const n=Math.floor(Number(stock));return Number.isFinite(n)&&n>0?Math.min(n,CART_MAX_QUANTITY):0}
function normalizeProductQuantity(value,stock){const limit=productQuantityLimit(stock),n=Math.floor(Number(value));return limit?Math.min(Math.max(Number.isFinite(n)?n:1,1),limit):0}
function addCart(id,quantity=1){const p=getProducts().find(x=>x.id===id);if(!p||!p.sale||p.stock<=0)return;const amount=normalizeProductQuantity(quantity,p.stock);if(!amount)return;writeCart([...readCartRaw(),{productId:id,quantity:amount}]);renderCheckout();toast(amount+' adet ürün sepete eklendi')}
function quote(id){const p=getProducts().find(x=>x.id===id)||(productDetail?.id===id?productDetail:null);location.href='https://wa.me/905427957560?text='+encodeURIComponent((p?.name||'GREE ürün')+' için fiyat ve keşif bilgisi almak istiyorum. Sayfa: '+location.href)}
/* Only the specs the catalog actually carries are shown - an empty wifi/energy value renders nothing, not a blank label. */
function specChips(p){const wifi=String(p.wifi||'').trim(),wifiText=!wifi?'':/^var$/i.test(wifi)?'Wi-Fi':/^opsiyonel$/i.test(wifi)?'Wi-Fi opsiyonel':`Wi-Fi: ${wifi}`;return [p.capacity&&`<span class="spec btu">${esc(formatCapacity(p.capacity))}</span>`,p.energy&&`<span class="spec" title="Sezonsal enerji sınıfı (soğutma / ısıtma)">${ico('zap',13)}${esc(p.energy)}</span>`,wifiText&&`<span class="spec">${esc(wifiText)}</span>`].filter(Boolean).join('')}
function stockLine(p){if(!p.sale)return '<p class="stock-line is-quote">Keşif sonrası teklif</p>';return Number(p.stock)>0?`<p class="stock-line is-in">Stokta · ${esc(p.stock)} adet</p>`:'<p class="stock-line is-out">Stokta yok</p>'}
function productCard(p){const fav=getFavorites().includes(p.id),cmp=getCompare().includes(p.id),id=esc(p.id),name=esc(p.name),href=`product.html?id=${encodeURIComponent(p.id)}`;return `<article class="product"><div class="product-media"><a href="${href}" class="product-visual" tabindex="-1">${productImageMarkup(p,'product-image','lazy')||productImagePlaceholder(p.name)}</a><div class="product-flags"><span class="badge ${p.sale?'':'quote'}">${p.sale?'Online satış':'Teklif / keşif'}</span></div><div class="product-tools card-tools"><button type="button" class="icon-toggle favorite-icon" aria-label="${name} — favorilere ekle" aria-pressed="${fav}" data-action="toggle-favorite" data-id="${id}">${ico('heart',19)}</button><button type="button" class="icon-toggle compare-icon" aria-label="${name} — karşılaştır" aria-pressed="${cmp}" data-action="toggle-compare" data-id="${id}">${ico('compare',18)}</button></div></div><div class="product-body"><div class="meta">${esc([...new Set([p.series,p.category].filter(Boolean))].join(' · '))}</div><h3><a href="${href}">${name}</a></h3>${p.sku?`<p class="product-sku">Model <b>${esc(p.sku)}</b></p>`:''}<div class="specs">${specChips(p)}</div><div class="product-foot"><div class="price${p.sale?'':' is-quote'}">${p.sale?money(p.price):'Fiyat Sor'}<small>${p.sale?'KDV dahil':'Projelendirme ile satılır'}</small></div>${stockLine(p)}</div><div class="actions">${p.sale&&Number(p.stock)<=0?'<button type="button" class="primary" disabled>Tükendi</button>':`<button type="button" class="primary" data-action="${p.sale?'add-cart':'quote'}" data-id="${id}">${p.sale?'Sepete Ekle':'Teklif Al'}</button>`}<a class="ghost" href="${href}">İncele</a></div></div></article>`}
/* Placeholder cards while GET /api/products is in flight: same footprint as a real card, so nothing jumps when data lands. */
const productSkeleton=()=>'<div class="product product-skeleton" aria-hidden="true"><div class="product-media"><div class="product-visual"></div></div><div class="product-body"><div class="skeleton-line w40"></div><div class="skeleton-line w80 h24"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40 h24"></div></div></div>';
/* Real capacities are written "12000 BTU/h"; the chips say "12.000". Compare digits only, and only for BTU-rated products. */
const capacityBtuDigits=p=>/btu/i.test(p.capacity||'')?p.capacity.replace(/\D/g,''):'';
const catalogFilterKeys=['series','energy','wifi','stock','min','max','sort'];
function selectCatalogProducts(products,filters={}){
  const query=String(filters.q||'').trim().toLocaleLowerCase('tr');
  const min=filters.min!==''&&filters.min!=null?Number(filters.min):null,max=filters.max!==''&&filters.max!=null?Number(filters.max):null;
  const result=products.filter(p=>(!filters.category||filters.category==='Tümü'||p.category===filters.category)&&(!filters.btu||filters.btu==='Tümü'||capacityBtuDigits(p)===String(filters.btu).replace(/\D/g,''))&&(!query||[p.name,p.series,p.category,p.sku].join(' ').toLocaleLowerCase('tr').includes(query))&&(!filters.series||p.series===filters.series)&&(!filters.energy||p.energy===filters.energy)&&(!filters.wifi||String(p.wifi)===filters.wifi)&&(!filters.stock||Number(p.stock)>0)&&(!(Number.isFinite(min)&&min!==null)||(p.sale&&Number(p.price)>=min))&&(!(Number.isFinite(max)&&max!==null)||(p.sale&&Number(p.price)<=max)));
  if(filters.sort==='price-asc'||filters.sort==='price-desc')result.sort((a,b)=>{if(a.sale!==b.sale)return a.sale?-1:1;return a.sale?(filters.sort==='price-asc'?a.price-b.price:b.price-a.price):0});
  if(filters.sort==='newest')result.sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
  return result;
}
function catalogFilters(){const filters={category:document.querySelector('[name=category]:checked')?.value||'Tümü',q:document.querySelector('#catalog-search')?.value||'',btu:document.querySelector('.chip.active')?.dataset.btu||'Tümü'};for(const key of catalogFilterKeys)filters[key]=document.querySelector(`[data-catalog-filter="${key}"]`)?.value||'';return filters}
function syncCatalogOptions(){
  const products=getProducts(),params=new URLSearchParams(location.search),countBy=f=>products.reduce((m,p)=>{const v=p[f];if(v!=null&&String(v).trim())m.set(String(v),(m.get(String(v))||0)+1);return m},new Map());
  const categoryRoot=document.querySelector('[data-category-options]');
  if(categoryRoot){const current=params.get('category')||document.querySelector('[name=category]:checked')?.value||'Tümü',cats=countBy('category');categoryRoot.innerHTML=[['Tümü',products.length],...cats].map(([value,n])=>`<label class="chip"><input class="sr-only" type="radio" name="category" value="${esc(value)}"${value===current?' checked':''}> ${esc(value==='Tümü'?'Tüm ürünler':value)} <span class="n">${esc(n)}</span></label>`).join('')}
  const btuRoot=document.querySelector('[data-btu-options]');
  if(btuRoot){const want=(document.querySelector('.chip.active')?.dataset.btu||params.get('btu')||'Tümü').replace(/\D/g,''),caps=[...new Set(products.map(capacityBtuDigits).filter(Boolean))].map(Number).sort((a,b)=>a-b);btuRoot.innerHTML=['Tümü',...caps].map(c=>{const v=c==='Tümü'?'Tümü':String(c),on=v==='Tümü'?!want:v===want;return `<button type="button" class="chip${on?' active':''}" data-btu="${esc(v)}" aria-pressed="${on}">${esc(v==='Tümü'?'Tümü':new Intl.NumberFormat('tr-TR').format(c))}</button>`}).join('')}
  for(const [key,field] of [['series','series'],['energy','energy'],['wifi','wifi']]){const select=document.querySelector(`[data-catalog-filter="${key}"]`);if(!select)continue;const value=select.value||params.get(key)||'';const counts=countBy(field),options=[...counts.keys()].sort((a,b)=>a.localeCompare(b,'tr'));select.innerHTML='<option value="">Tümü</option>'+options.map(v=>`<option value="${esc(v)}">${esc(v)} (${esc(counts.get(v))})</option>`).join('');select.value=options.includes(value)?value:''}
}
function updateCatalogUrl(filters){const params=new URLSearchParams(location.search);for(const key of ['category','q','btu',...catalogFilterKeys]){const value=filters[key];if(value&&value!=='Tümü')params.set(key,value);else params.delete(key)}history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():''))}
function resetCatalogFilters(){const search=document.querySelector('#catalog-search');if(search)search.value='';document.querySelectorAll('[name=category]').forEach(el=>{el.checked=el.value==='Tümü'});setBtuChip('Tümü');document.querySelectorAll('[data-catalog-filter]').forEach(el=>{if(el.dataset.catalogFilter!=='sort')el.value=''});renderCatalog();updateCatalogUrl(catalogFilters())}
function setBtuChip(value){document.querySelectorAll('.chip[data-btu]').forEach(el=>{const on=el.dataset.btu===value||(value!=='Tümü'&&el.dataset.btu?.replace(/\D/g,'')===String(value).replace(/\D/g,''));el.classList.toggle('active',on);el.setAttribute?.('aria-pressed',String(on))})}
function removeCatalogFilter(key){if(key==='category')document.querySelectorAll('[name=category]').forEach(el=>{el.checked=el.value==='Tümü'});else if(key==='q'){const search=document.querySelector('#catalog-search');if(search)search.value=''}else if(key==='btu')setBtuChip('Tümü');else{const el=document.querySelector(`[data-catalog-filter="${key}"]`);if(el)el.value=''}renderCatalog();updateCatalogUrl(catalogFilters())}
function setFiltersOpen(open){const panel=document.querySelector('.catalog-filters');if(!panel)return;panel.classList.toggle('open',open);document.querySelector('.filters-backdrop')?.classList.toggle('open',open);document.querySelectorAll('[data-action="toggle-filters"]').forEach(b=>b.setAttribute('aria-expanded',String(open)));document.documentElement?.classList.toggle('nav-open',open);if(open)panel.querySelector('.filters-close')?.focus()}
const CATALOG_PAGE=24;let catalogLimit=CATALOG_PAGE,catalogSignature='';
const FILTER_LABELS={category:'Kategori',q:'Arama',btu:'Kapasite',series:'Seri',energy:'Enerji',wifi:'Wi-Fi',stock:'Stok',min:'En az ₺',max:'En çok ₺'};
function renderCatalog(){const root=document.querySelector('[data-products]');if(!root)return;const count=document.querySelector('[data-result-count]'),more=document.querySelector('[data-load-more]');if(!catalogAuthoritative()){root.innerHTML=catalogState==='loading'?`<p class="sr-only" role="status">${catalogNotice()}</p>${productSkeleton().repeat(6)}`:`<div class="empty" role="status">${catalogNotice()}</div>`;count?.replaceChildren();if(more)more.innerHTML='';return}
  const filters=catalogFilters(),signature=JSON.stringify({...filters,sort:''});if(signature!==catalogSignature){catalogSignature=signature;catalogLimit=CATALOG_PAGE}
  const ps=selectCatalogProducts(getProducts(),filters),shown=ps.slice(0,catalogLimit);
  root.innerHTML=ps.length?shown.map(productCard).join(''):'<div class="empty"><b>Bu filtrelerle eşleşen ürün bulunamadı.</b><br>Filtreleri değiştirin ya da ihtiyacınızı bize iletin. <button type="button" class="ghost" data-action="clear-catalog">Filtreleri temizle</button></div>';
  count?.replaceChildren(document.createTextNode(ps.length+' ürün'));document.querySelectorAll('[data-apply-count]').forEach(el=>{el.textContent=ps.length+' ürünü göster'});
  if(more)more.innerHTML=ps.length>shown.length?`<p>${shown.length} / ${ps.length} ürün gösteriliyor</p><progress max="${ps.length}" value="${shown.length}" aria-hidden="true"></progress><button type="button" class="ghost" data-action="load-more">Daha fazla ürün göster</button>`:'';
  const title=document.querySelector('[data-catalog-title]');if(title)title.textContent=filters.series?`GREE ${filters.series} Serisi`:filters.category&&filters.category!=='Tümü'?`GREE ${filters.category}`:'GREE Klima ve İklimlendirme';
  const active=document.querySelector('[data-active-filters]');if(active){const entries=Object.entries(filters).filter(([key,value])=>key!=='sort'&&value&&value!=='Tümü');active.innerHTML=entries.map(([key,value])=>`<button type="button" class="active-chip spec" data-action="remove-filter" data-key="${esc(key)}"><span>${esc(FILTER_LABELS[key])}:</span> ${esc(key==='stock'?'Stokta':key==='btu'?new Intl.NumberFormat('tr-TR').format(Number(String(value).replace(/\D/g,'')))+' BTU':value)}<i aria-hidden="true">×</i><span class="sr-only"> filtresini kaldır</span></button>`).join('')+(entries.length>1?'<button type="button" class="clear-all" data-action="clear-catalog">Tümünü temizle</button>':'');const badge=document.querySelector('[data-filter-count]');if(badge)badge.textContent=entries.length?`(${entries.length})`:''}}
/* Delivery model (Phase 3.4B). DISPLAY ONLY: the server derives installation, shipping and the service area from each
   product's stored delivery class, prices any shipping itself and refuses everything else (lib/delivery.ts). The browser
   carries no copy of that rule: the class traits, both province lists and the shipping tariff all come from
   GET /api/checkout/charges, and this code only looks a class up. */
let checkoutConfig=null;
async function loadCheckoutCharges(){checkoutConfig=null;try{const response=await fetch('/api/checkout/charges');const data=await response.json().catch(()=>({}));if(response.ok&&data&&data.shipping&&Array.isArray(data.serviceProvinces)&&data.locations&&typeof data.locations==='object'&&data.deliveryTraits)checkoutConfig=data}catch{}fillProvinces();syncDistricts(false);renderDeliveryOptions();renderChargeSummary()}
const tariffKnown=t=>Boolean(t&&t.status==='configured'&&Number.isInteger(t.amount)&&t.amount>=0);
const AREA_MESSAGE='Bu ürün için şu anda Ege Teknik hizmet bölgesi içinde teslimat ve kurulum hizmeti sunuyoruz.';
const SHIPPING_SOON='Kargo seçeneği yakında aktif olacaktır. Şimdilik mağazadan teslim alabilirsiniz.';
/* 'dealer' = the cart holds at least one dealer-delivered class (air conditioner, local delivery): the WHOLE order travels
   with Ege Teknik and no shipping/pickup is offered. 'parts' = only shippable items. Anything the config cannot classify is
   'unknown' and blocks the order rather than being guessed. */
function deliveryModel(lines){
  const items=(lines||[]).filter(l=>l.available);if(!items.length)return {mode:'empty'};
  const traits=checkoutConfig&&checkoutConfig.deliveryTraits;if(!traits)return {mode:'unknown'};
  const list=items.map(l=>traits[l.product&&l.product.deliveryClass]);if(list.some(t=>!t))return {mode:'unknown'};
  const dealer=list.some(t=>t.dealerDelivered);
  return {mode:dealer?'dealer':'parts',installationIncluded:list.some(t=>t.installationIncluded),mixed:dealer&&list.some(t=>t.shippingEligible)}}
function deliveryChoice(lines,values){
  const model=deliveryModel(lines),v=values||{};
  let method=null;
  if(model.mode==='dealer')method='dealer';
  else if(model.mode==='parts')method=v.delivery==='shipping'&&tariffKnown(checkoutConfig.shipping)?'shipping':'pickup';
  return {model,method,city:v.city||'',district:v.district||''}}
/* A district only counts when it is one of the chosen province's own districts (the server re-checks this). */
const districtValid=(city,district)=>Boolean(checkoutConfig&&district&&Array.isArray(checkoutConfig.locations[city])&&checkoutConfig.locations[city].includes(district));
function checkoutSummary(productTotal,choice){
  if(!checkoutConfig)return {rows:[],total:null,blocked:'unavailable'};
  const {model,method,city,district}=choice,place=[city,district].filter(Boolean).join(' / ');
  if(model.mode==='unknown')return {rows:[],total:null,blocked:'unknown'};
  if(model.mode==='empty')return {rows:[],total:productTotal,blocked:null};
  if(method==='dealer'){
    const rows=[['Teslimat ve kurulum','Adrese teslim']];if(model.installationIncluded)rows.push(['Standart montaj','Dahil']);rows.push(['Teslimat bölgesi',place||'İl seçilmedi']);
    if(!city)return {rows,total:null,blocked:'province'};
    if(!checkoutConfig.serviceProvinces.includes(city))return {rows,total:null,blocked:'area'};
    if(!districtValid(city,district))return {rows,total:null,blocked:'district'};
    return {rows,total:productTotal,blocked:null}}
  if(method==='shipping'){
    const rows=[['Teslimat','Kargo'],['Kargo ücreti',money(checkoutConfig.shipping.amount)]];
    if(!city)return {rows,total:null,blocked:'province'};
    if(!districtValid(city,district))return {rows,total:null,blocked:'district'};
    return {rows,total:productTotal+checkoutConfig.shipping.amount,blocked:null}}
  return {rows:[['Teslimat','Mağazadan teslim · Ücretsiz']],total:productTotal,blocked:null}}
function checkoutNotice(blocked){
  if(blocked==='unavailable')return 'Teslimat bilgileri şu anda yüklenemedi; sipariş verilemiyor. Lütfen sayfayı yenileyin.';
  if(blocked==='unknown')return 'Sepetteki bir ürünün teslimat bilgisi doğrulanamadı; sipariş oluşturulamıyor. Lütfen sayfayı yenileyin.';
  if(blocked==='province')return 'Lütfen teslimat ilini seçin.';
  if(blocked==='district')return 'Lütfen teslimat ilçesini seçin.';
  if(blocked==='area')return AREA_MESSAGE;
  return ''}
function currentDeliveryValues(){const q=sel=>document.querySelector(sel);return {city:q('[name=city]')?.value||'',district:q('[name=district]')?.value||'',delivery:q('[name=delivery]:checked')?.value||''}}
function fillProvinces(){const select=document.querySelector('[data-province]');if(!select||!checkoutConfig)return;const current=select.value;select.innerHTML='<option value="">İl seçin</option>'+Object.keys(checkoutConfig.locations).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');select.value=current}
/* The district select lists ONLY the chosen province's districts. `reset` (the province changed) clears any earlier district; without a province the select is disabled. */
function syncDistricts(reset){const select=document.querySelector('[data-district]');if(!select||!checkoutConfig)return;const city=document.querySelector('[name=city]')?.value||'',list=city&&Array.isArray(checkoutConfig.locations[city])?checkoutConfig.locations[city]:[],current=reset?'':select.value;
  select.innerHTML=(list.length?'<option value="">İlçe seçin</option>':'<option value="">Önce il seçin</option>')+list.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  select.disabled=!list.length;select.value=list.includes(current)?current:''}
function onProvinceChange(){syncDistricts(true);renderChargeSummary()}
function renderDeliveryOptions(){
  const box=document.querySelector('[data-delivery-options]');if(!box)return;
  if(!checkoutConfig||!catalogAuthoritative()){box.innerHTML='';return}
  const model=deliveryModel(cartLines(getCart(),getProducts())),keep=document.querySelector('[name=delivery]:checked')?.value;
  if(model.mode==='dealer'){
    box.innerHTML=`<div class="delivery-card" data-delivery-mode="dealer"><h3>Teslimat ve kurulum</h3><ul class="check-list"><li>✓ ${model.installationIncluded?'Standart montaj dahil':'Bayi teslimatı'}</li><li>✓ Ege Teknik hizmet bölgesinde adrese teslim</li><li>✓ Yetkili servis yönlendirmesi</li></ul><p class="tax-note"><small>${model.installationIncluded?'Standart montaj ürün fiyatına dahildir. ':''}Ege Teknik veya ilgili GREE servis organizasyonu ürünü adresinize getirir; ayrıca teslimat ücreti alınmaz.${model.mixed?' Sepetinizdeki yedek parçalar aynı teslimatla gelir.':''}</small></p></div>`;return}
  if(model.mode==='parts'){
    const shipOk=tariffKnown(checkoutConfig.shipping),ship=shipOk&&keep==='shipping';
    box.innerHTML=`<fieldset class="delivery-choice" data-delivery-mode="parts"><legend>Teslimat seçeneği</legend><label class="delivery-option"><input type="radio" name="delivery" value="pickup"${ship?'':' checked'}><span><b>Mağazadan teslim</b><small>Ücretsiz</small></span></label><label class="delivery-option"${shipOk?'':' data-disabled'}><input type="radio" name="delivery" value="shipping"${ship?' checked':''}${shipOk?'':' disabled'} aria-describedby="shipping-note"><span><b>Kargo</b> (Türkiye geneli)<small id="shipping-note">${shipOk?'Kargo ücreti '+money(checkoutConfig.shipping.amount)+' (sipariş tutarına eklenir).':SHIPPING_SOON}</small></span></label></fieldset>`;return}
  box.innerHTML=''}
/* Province and address are required for dealer delivery and carrier shipping, never for store pickup. */
function syncAddressRequirements(choice){
  const needed=choice.method==='dealer'||choice.method==='shipping';
  ['[name=city]','[name=district]','[name=address]'].forEach(sel=>{const el=document.querySelector(sel);if(el)el.required=needed});
  const hint=document.querySelector('[data-address-hint]');if(hint)hint.textContent=choice.method==='pickup'?'Mağazadan teslimde adres gerekmez.':''}
function renderChargeSummary(){
  const box=document.querySelector('[data-charge-summary]');if(!box)return;
  const totalEl=document.querySelector('[data-total]'),notice=document.querySelector('[data-charge-notice]'),submit=document.querySelector('[data-submit-order]');
  if(!catalogAuthoritative()){box.innerHTML='';if(totalEl)totalEl.textContent='—';return}
  const lines=cartLines(getCart(),getProducts()),choice=deliveryChoice(lines,currentDeliveryValues()),summary=checkoutSummary(cartTotal(lines),choice),hasItems=lines.some(l=>l.available);
  syncAddressRequirements(choice);
  box.innerHTML=summary.rows.map(([label,text])=>`<div class="summary-row"><span>${esc(label)}</span><b>${esc(text)}</b></div>`).join('');
  if(totalEl)totalEl.textContent=!hasItems?'—':summary.total===null?'Kesinleşmedi':money(summary.total);
  if(notice){notice.hidden=summary.total!==null;notice.textContent=summary.total===null?checkoutNotice(summary.blocked):''}
  if(submit)submit.disabled=summary.total===null||!hasItems}
function marketingChoices(boxes){const choices={sms:false,email:false,whatsapp:false};Array.from(boxes||[]).forEach(box=>{if(box.checked&&Object.hasOwn(choices,box.dataset.marketingChannel))choices[box.dataset.marketingChannel]=true});return choices}
/* KVKK Aydınlatma is informational, never a checkbox. The link points at the currently published document; if none is published the page says so. */
async function renderKvkkNotices(){const slots=document.querySelectorAll('[data-kvkk-notice]');if(!slots.length)return;let doc=null;try{const response=await fetch('/api/legal/documents');const data=await response.json().catch(()=>({}));if(response.ok&&Array.isArray(data.documents))doc=data.documents.find(d=>d.slug==='kvkk')||null}catch{}
  slots.forEach(slot=>{slot.innerHTML=doc?`Kişisel verilerinizin işlenmesine ilişkin <a href="${esc(legalVersionHref(doc))}" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>'ni inceleyebilirsiniz.`:'KVKK Aydınlatma Metni henüz yayınlanmamıştır.'})}
/* Display-only mirror of lib/order-domain.ts's calculateLine: VAT carved out of a VAT-inclusive line total.
   The server is always the authority - this only lets the customer see the breakdown before submitting. */
function lineVat(unitPrice,quantity,vatRateBps){return Math.round(unitPrice*quantity*vatRateBps/(10000+vatRateBps))}
function cartVat(lines){return (lines||[]).reduce((sum,l)=>l.available?sum+lineVat(l.product.price,l.quantity,l.product.vatRateBps||0):sum,0)}
function renderCheckout(){const root=document.querySelector('[data-cart-items]');if(!root)return;const subtotalEl=document.querySelector('[data-subtotal]'),vatEl=document.querySelector('[data-vat]'),totalEl=document.querySelector('[data-total]'),setTotals=t=>{if(subtotalEl)subtotalEl.textContent=t;if(vatEl)vatEl.textContent=t;if(totalEl)totalEl.textContent=t};
  // Never show a price or an "unavailable" verdict for a line before the server catalog has answered.
  if(!catalogAuthoritative()){root.innerHTML=getCart().length?`<p>${catalogNotice()}</p>`:'<p class="cart-empty">Sepetiniz boş. <a class="primary inline" href="catalog.html">Ürünleri inceleyin</a></p>';setTotals('—');return}
  const lines=cartLines(getCart(),getProducts()),sellable=lines.filter(l=>l.available),blocked=lines.filter(l=>!l.available);
  /* type="button" is required, not cosmetic: these rows render inside checkout.html's
     <form data-checkout-form>, and a <button> with no type defaults to submit - so a
     remove click would also fire submitOrder and place an order for the rest of the cart. */
  const rows=[...sellable.map(l=>`<div class="summary-row"><span>${esc(l.product.name)}<br><small>${esc(l.product.capacity)} · ${money(l.product.price)} × ${l.quantity} adet</small></span><span>${money(l.product.price*l.quantity)} <button type="button" class="ghost" data-action="remove-cart" data-id="${esc(l.productId)}">×</button></span></div>`),
    ...blocked.map(l=>`<div class="summary-row"><span>Bu ürün artık satışta değil<br><small>Ürün kodu: ${esc(l.productId)}</small></span><span><button type="button" class="ghost" data-action="remove-cart" data-id="${esc(l.productId)}">×</button></span></div>`)];
  root.innerHTML=rows.length?rows.join(''):'<p class="cart-empty">Sepetiniz boş. <a class="primary inline" href="catalog.html">Ürünleri inceleyin</a></p>';
  /* an empty cart shows dashes, never a ₺0 total */
  if(!sellable.length){setTotals('—');renderDeliveryOptions();renderChargeSummary();return}
  if(subtotalEl)subtotalEl.textContent=money(cartTotal(lines));if(vatEl)vatEl.textContent=money(cartVat(lines));renderDeliveryOptions();renderChargeSummary()}
function removeCart(productId){writeCart(readCartRaw().filter(entry=>(entry?.productId??entry?.id)!==productId));renderCheckout()}
/* Guest order confirmation: built entirely from the server's response (lib/order-domain.ts's
   toOrderConfirmation allow-list) - no internal id ever reaches this markup. Replaces the form
   so the customer sees a clear result, not a still-fillable form with a one-line note. */
/* Text for the stored delivery method; legacy orders (no method recorded) fall back to the amount alone. */
function deliveryMethodText(d,data){
  if(d.method==='dealer')return d.installation==='included_standard'?'Adrese teslim · Standart montaj dahil':'Adrese teslim';
  if(d.method==='pickup')return 'Mağazadan teslim · Ücretsiz';
  if(d.method==='shipping')return 'Kargo · '+money(data.shippingTotal);
  return money(data.shippingTotal)}
function renderOrderConfirmation(data){
  const box=document.querySelector('[data-order-confirmation]');if(!box)return;
  const items=Array.isArray(data.items)?data.items:[],d=data.delivery||{};
  box.querySelector('[data-confirmation-number]').innerHTML=`Takip numarası: <b>${esc(data.orderNumber)}</b>`;
  box.querySelector('[data-confirmation-items]').innerHTML=items.map(i=>`<div class="summary-row"><span>${esc(i.productName)}<br><small>${money(i.unitPrice)} × ${esc(i.quantity)} adet</small></span><b>${money(i.lineTotal)}</b></div>`).join('');
  box.querySelector('[data-confirmation-subtotal]').textContent=money(items.reduce((s,i)=>s+i.lineTotal,0));
  box.querySelector('[data-confirmation-vat]').textContent=money(data.vatTotal);
  box.querySelector('[data-confirmation-shipping]').textContent=deliveryMethodText(d,data);
  box.querySelector('[data-confirmation-total]').textContent=money(data.total);
  box.querySelector('[data-confirmation-delivery]').innerHTML=`${esc(d.name)}<br>${esc(d.phone)} · ${esc(d.email)}<br>${esc([d.address,[d.district,d.city].filter(Boolean).join(' / ')].filter(Boolean).join(', '))}<br><small>${esc(deliveryMethodText(d,data))}</small>`;
  box.hidden=false;
  const form=document.querySelector('[data-checkout-form]');if(form)form.hidden=true;
  const heading=box.querySelector('[data-confirmation-heading]');heading?.focus();
  box.scrollIntoView({block:'start'})
}
async function submitOrder(e){e.preventDefault();const f=e.currentTarget,button=f.querySelector('button.primary'),result=f.querySelector('[data-order-result]'),say=t=>{if(result)result.textContent=t};
  if(!catalogAuthoritative()){say('Ürün bilgileri sunucudan doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.');return}
  const entries=getCart(),products=getProducts(),payload=buildOrderPayload({customerName:'',phone:'',email:'',city:'',address:'',paymentProvider:''},entries,products);
  if(!payload.items.length){toast('Sepetiniz boş');say('Sepetinizde satın alınabilir ürün yok.');return}
  const accepted=acceptedLegalVersionIds(f.querySelectorAll('[data-legal-version]'));
  if(!legalConsentsComplete(legalRequirements,accepted)){say(legalRequirements?'Devam etmek için tüm yasal metinleri kabul etmelisiniz.':'Yasal metinler yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');return}
  const d=new FormData(f),lines=cartLines(entries,products),choice=deliveryChoice(lines,{city:d.get('city'),district:d.get('district'),delivery:d.get('delivery')}),summary=checkoutSummary(cartTotal(lines),choice);
  if(summary.total===null){say(checkoutNotice(summary.blocked));return}
  Object.assign(payload,{expectedTotal:summary.total,delivery:choice.method,district:d.get('district')||'',marketing:marketingChoices(f.querySelectorAll('[data-marketing-channel]')),customerName:d.get('customerName'),phone:d.get('phone'),email:d.get('email'),city:d.get('city')||'',address:d.get('address')||'',paymentProvider:d.get('provider'),note:d.get('note')||'',legalAcceptances:accepted});
  const attemptKey=orderAttemptKey(sessionStorage);
  if(button){button.disabled=true;button.textContent='Sipariş kaydediliyor…'}
  try{
    const response=await fetch('/api/orders',{method:'POST',headers:{'content-type':'application/json','idempotency-key':attemptKey},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    /* The attempt key is released only when the server rejected the request itself (invalid, legal version changed, key reused for a different request), so the corrected form gets a fresh key. Stock conflicts, 5xx and network failures keep it so a retry dedupes. */
    if(!response.ok){if(response.status===400||response.status===422||data.code==='LEGAL_VERSION_MISMATCH'||data.code==='IDEMPOTENCY_KEY_REUSED')clearOrderAttemptKey(sessionStorage);if(data.code==='LEGAL_VERSION_MISMATCH')void loadLegalRequirements();if(data.code==='PRICE_CHANGED'||data.code==='CHARGES_UNDETERMINED')void loadCheckoutCharges();throw new Error(data.error||'Sipariş kaydedilemedi')}
    // Cart and attempt key are cleared only once the server has confirmed the order.
    clearOrderAttemptKey(sessionStorage);writeCart([]);
    renderOrderConfirmation(data);
  }catch(error){
    if(button){button.disabled=false;button.textContent='Tekrar Dene'}renderChargeSummary();
    say(error.message||'Sipariş kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.')
  }}

/**
 * Single delegated click handler for every dynamically-rendered and static
 * data-action="..." control across the storefront (product cards, cart/compare
 * remove buttons, the header's mobile menu toggle, etc.) - registered once,
 * here, instead of onclick="..." attributes in the generated HTML. The site's
 * CSP has no 'unsafe-hashes', so inline event-handler attributes are silently
 * blocked; addEventListener is a normal DOM API call and is unaffected. This
 * also means re-rendered markup (a new catalog filter, a new cart line) never
 * needs its listeners rebound - the listener lives on `document`, not on the
 * elements it acts on.
 *
 * data-* attributes here only ever carry plain identifiers or URLs (never
 * executable script) - the handler is what decides what to do with them.
 */
/* The same product can appear more than once on a page (hero, featured grid, related); every copy of a toggle reflects the stored state. */
function syncToggleState(action,id,on,clicked){clicked?.setAttribute?.('aria-pressed',String(on));document.querySelectorAll(`[data-action="${action}"]`).forEach(b=>{if(b.dataset?.id===id){b.setAttribute('aria-pressed',String(on));const label=b.querySelector?.('[data-toggle-label]');if(label)label.textContent=action==='toggle-favorite'?(on?'Favorilerde':'Favorilere ekle'):(on?'Karşılaştırmada':'Karşılaştır')}})}
function handleDelegatedClick(e){
  const chip=e.target.closest?.('.chip[data-btu]');if(chip?.dataset?.btu){setBtuChip(chip.dataset.btu);renderCatalog();return}
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const action=el.dataset.action,id=el.dataset.id;
  if(action==='add-cart')addCart(id);
  else if(action==='add-product-cart'){const input=document.querySelector('[data-product-quantity]');addCart(id,input?.value||1)}
  else if(action==='quantity-step'){const input=document.querySelector('[data-product-quantity]');if(input){input.value=String(normalizeProductQuantity(Number(input.value||1)+Number(el.dataset.step||0),productDetail?.stock));}}
  else if(action==='clear-catalog')resetCatalogFilters();
  else if(action==='remove-filter')removeCatalogFilter(el.dataset.key);
  else if(action==='load-more'){catalogLimit+=CATALOG_PAGE;renderCatalog();document.querySelectorAll('[data-products] .product')[catalogLimit-CATALOG_PAGE]?.querySelector('h3 a')?.focus()}
  else if(action==='toggle-filters')setFiltersOpen(!document.querySelector('.catalog-filters')?.classList.contains('open'));
  else if(action==='close-filters')setFiltersOpen(false);
  else if(action==='hero-tone')setHeroTone(el.dataset.tone);
  else if(action==='toggle-help')setHelpOpen(document.getElementById('help-panel')?.hidden!==false);
  else if(action==='gallery-select')selectProductGallery(Number(el.dataset.index));
  else if(action==='review-open'){if(reviewState.formOpen){reviewState.formOpen=false;renderReviewSection()}else openReviewForm()}
  else if(action==='review-more'){if(!reviewState.loadingMore)void loadProductReviews(false)}
  else if(action==='quote')quote(id);
  else if(action==='toggle-favorite'){toggleFavorite(id);syncToggleState('toggle-favorite',id,getFavorites().includes(id),el)}
  else if(action==='toggle-compare'){toggleCompare(id);syncToggleState('toggle-compare',id,getCompare().includes(id),el)}
  else if(action==='remove-cart')removeCart(id);
  else if(action==='toggle-menu')toggleMenu(el);
  else if(action==='calculate-btu')calculateBtu();
  else if(action==='navigate'){const to=safeInternalHref(el.dataset.href);if(to)location.href=to}
}
document.addEventListener('click',handleDelegatedClick);
document.addEventListener('submit',e=>{if(e.target.closest?.('[data-review-form]'))void submitReview(e)});
document.addEventListener('input',onReviewInput);
document.addEventListener('change',e=>{if(e.target.matches?.('[data-review-sort]')){reviewState.sort=e.target.value;void loadProductReviews(true);return}if(e.target.name==='rating')onReviewInput(e)});
document.addEventListener('change',e=>{const input=e.target.closest?.('[data-product-quantity]');if(input)input.value=String(normalizeProductQuantity(input.value,productDetail?.stock)||1)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('help-panel')?.hidden===false){setHelpOpen(false);return}if(e.key==='Escape'&&document.querySelector('.catalog-filters.open')){setFiltersOpen(false);document.querySelector('[data-action="toggle-filters"]')?.focus();return}if(e.key==='Escape'){const open=document.querySelector('.store-nav>[data-action="toggle-menu"][aria-expanded="true"]');if(open){setMenu(open,false);open.focus();return}}const thumb=e.target.closest?.('[data-action="gallery-select"]');if(!thumb||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const count=approvedGallery(productDetail).length;if(!count)return;const current=Number(thumb.dataset.index),next=e.key==='Home'?0:e.key==='End'?count-1:(current+(e.key==='ArrowRight'?1:-1)+count)%count;selectProductGallery(next);document.querySelector(`[data-action="gallery-select"][data-index="${next}"]`)?.focus()});

document.addEventListener('DOMContentLoaded',()=>{updateCartCount();updateFavoritesCount();renderCatalog();renderCheckout();document.querySelector('[data-checkout-form]')?.addEventListener('submit',submitOrder);if(document.querySelector('[data-legal-consents]'))void loadLegalRequirements();if(document.querySelector('[data-charge-summary]'))void loadCheckoutCharges();document.querySelector('[data-checkout-form]')?.addEventListener('change',e=>{const t=e.target;if(!t||!t.matches)return;if(t.matches('[name=city]'))onProvinceChange();else if(t.matches('[name=district],[name=delivery]'))renderChargeSummary()});void renderKvkkNotices();document.querySelectorAll('[name=category]').forEach(x=>x.addEventListener('change',renderCatalog));document.querySelector('#catalog-search')?.addEventListener('input',renderCatalog);void loadCatalog()});

const business={name:'Ege Teknik',phone:'0542 795 75 60',phoneHref:'tel:+905427957560',wa:'https://wa.me/905427957560',email:'info@egeteknik.tr',address:'İkiçeşmelik Mahallesi Süleyman Demirel Bulvarı, Ege Uluçınar Koop. No:13/1D, 09400 Kuşadası/Aydın',map:'https://share.google/YHInB4tNwB2khqC10'};
/* Catalog navigation is static (categories/series/capacities the catalog carries); counts and prices are never hard-coded here. */
const NAV_CATEGORIES=[['Duvar Tipi','Duvar tipi klimalar'],['Salon Tipi','Salon tipi klimalar'],['Ticari Klima','Kaset, yer/tavan ve karavan'],['Multi Sistem','Multi split iç ve dış üniteler'],['Isı Pompası','Versati ısı pompaları'],['Home','Fan ve evaporatif soğutucular'],['Yedek Parça','Filtre ve Wi-Fi kiti']];
const NAV_SERIES=['Airy','Fairy','Pular','Aphro'],NAV_BTU=[9000,12000,18000,24000];
const catalogHref=q=>'catalog.html?'+new URLSearchParams(q).toString();
function renderHeader(){const root=document.querySelector('[data-site-header]');if(!root)return;const fmt=n=>new Intl.NumberFormat('tr-TR').format(n);
  const mega=`<div class="mega" id="mega-klima"><div><h3>Kategoriler</h3><ul>${NAV_CATEGORIES.map(([c])=>`<li><a href="${esc(catalogHref({category:c}))}">${esc(c==='Home'?'Ev Ürünleri (Home)':c)}</a></li>`).join('')}</ul></div><div><h3>Duvar tipi seriler</h3><ul>${NAV_SERIES.map(sr=>`<li><a href="${esc(catalogHref({category:'Duvar Tipi',series:sr}))}">GREE ${sr}</a></li>`).join('')}<li><a href="catalog.html">Tüm ürünler</a></li></ul></div><div class="mega-cap"><h3>Kapasiteye göre</h3><ul>${NAV_BTU.map(b=>`<li><a href="${esc(catalogHref({btu:b}))}">${fmt(b)} BTU/h</a></li>`).join('')}</ul></div><div class="mega-feature"><div><b>Hangi kapasite size uygun?</b><p>Alan, cephe ve yalıtım bilgisiyle ön öneri alın; kesin karar için keşif isteyin.</p></div><a class="btn btn-light" href="selector.html">Klima Seçici${ico('arrow',16)}</a></div></div>`;
  const skipHref=document.querySelector('base')?`${location.pathname}#main`:'#main';root.innerHTML=`<a class="skip-link" href="${skipHref}">İçeriğe geç</a><header class="store-header"><div class="store-top"><div class="wrap"><p><b>Ege Teknik</b> Kuşadası merkezli · Ege Teknik hizmet bölgesinde satış, keşif, montaj ve servis</p><div class="top-links"><a href="mailto:${business.email}">${ico('mail',14)}${business.email}</a><a href="${business.phoneHref}">${ico('phone',14)}${business.phone}</a><a href="${business.wa}" rel="noopener">${ico('chat',14)}WhatsApp</a></div></div></div><div class="wrap store-nav"><button type="button" class="menu-toggle ghost" data-action="toggle-menu" aria-expanded="false" aria-controls="site-nav" aria-label="Menüyü aç">${ico('menu',20)}<span class="label">Menü</span></button><a class="brand" href="/">EGE TEKNİK<small>KLİMA & TEKNOLOJİ</small></a><form class="header-search" action="catalog.html" method="get" role="search"><label class="sr-only" for="site-search">Ürünlerde ara</label><input id="site-search" name="q" type="search" placeholder="Model, seri veya BTU ara (ör. Airy 12000)" autocomplete="off"><button type="submit" aria-label="Ara">${ico('search',18)}</button></form><div class="header-tools"><a class="header-icon hide-xs" href="favorites.html" title="Favoriler" aria-label="Favoriler">${ico('heart',21)}<span class="count" data-favorites-count data-zero>0</span></a><a class="header-icon hide-xs" href="compare.html" title="Karşılaştır" aria-label="Karşılaştır">${ico('compare',21)}<span class="count" data-compare-count data-zero>0</span></a><a class="header-cart" href="checkout.html" aria-label="Sepet">${ico('bag',19)}<span class="label">Sepet</span><span class="cart-count" data-cart-count>0</span></a></div></div><nav class="nav-bar" id="site-nav" aria-label="Ana menü"><div class="nav-drawer-head"><a class="brand" href="/">EGE TEKNİK<small>KLİMA & TEKNOLOJİ</small></a><button type="button" class="menu-toggle ghost" data-action="toggle-menu" aria-expanded="true" aria-controls="site-nav" aria-label="Menüyü kapat">${ico('close',20)}</button></div><form class="drawer-search" action="catalog.html" method="get" role="search"><label class="sr-only" for="drawer-search">Ürünlerde ara</label><input id="drawer-search" name="q" type="search" placeholder="Model, seri veya BTU ara" autocomplete="off"><button type="submit" aria-label="Ara">${ico('search',18)}</button></form><div class="wrap nav-links"><div class="nav-item"><a href="catalog.html" aria-haspopup="true">GREE Klimalar${ico('down',16)}</a>${mega}</div><a href="second-hand.html">Spot Ürünler</a><a href="selector.html">Klima Seçici</a><a href="services.html">Montaj &amp; Servis</a><a href="blog.html">Klima Rehberi</a><a href="regions.html">Hizmet Bölgeleri</a><a href="contact.html">İletişim</a><a class="nav-extra" href="favorites.html">Favoriler</a><a class="nav-extra" href="compare.html">Karşılaştır</a><a class="nav-extra" href="/account">Hesabım</a><a class="nav-cta" href="contact.html?subject=kesif">${ico('clipboard',17)}Keşif / montaj talebi</a></div></nav><button type="button" class="nav-backdrop" data-action="toggle-menu" aria-controls="site-nav" aria-expanded="false" tabindex="-1" aria-label="Menüyü kapat"></button></header>`;
  const page=String(location.pathname||'').split('/').pop()||'index.html';root.querySelectorAll?.('.nav-links>a, .header-tools a').forEach(a=>{if(a.getAttribute('href')===page)a.setAttribute('aria-current','page')});if(page==='catalog.html'||page==='product.html')root.querySelector?.('.nav-item>a')?.setAttribute('aria-current','page');if(page==='article.html'||location.pathname.startsWith('/rehber/'))root.querySelector?.('.nav-links>a[href="blog.html"]')?.setAttribute('aria-current','page');const q=new URLSearchParams(location.search).get('q');if(q)root.querySelectorAll?.('input[name=q]').forEach(i=>{i.value=q})}
/* One disclosure pattern for both headers: the button names the panel it controls, reports its state, Escape closes it and returns focus. */
function setMenu(button,open){const panel=document.getElementById(button?.getAttribute('aria-controls')||'')||document.querySelector('.nav-links');if(!button||!panel)return;panel.classList.toggle('open',open);document.querySelector('.nav-backdrop')?.classList.toggle('open',open);document.documentElement?.classList.toggle('nav-open',open);document.querySelectorAll(`[data-action="toggle-menu"][aria-controls="${panel.id}"]`).forEach(b=>{if(!b.classList.contains('nav-backdrop')&&!b.closest?.('.nav-drawer-head'))b.setAttribute('aria-expanded',String(open))});if(open)(panel.querySelector?.('.nav-drawer-head .menu-toggle')||panel.querySelector?.('a'))?.focus();else if(button.closest?.('.nav-drawer-head')||button.classList.contains('nav-backdrop'))document.querySelector('.store-nav>.menu-toggle')?.focus()}
function toggleMenu(button){const panel=document.getElementById(button?.getAttribute('aria-controls')||'');setMenu(button,panel?!panel.classList.contains('open'):button.getAttribute('aria-expanded')!=='true')}
/* Help launcher: a real, accessible contact menu today and the mount point for a future assistant.
   A future integration calls window.EgeAssistant.mount(render) with a function that receives the panel element; nothing here
   claims an assistant exists. */
function renderHelpLauncher(){if(!document.querySelector('[data-site-footer]')||document.querySelector('[data-help]'))return;const wrap=document.createElement('div');wrap.className='help-launcher';wrap.dataset.help='';wrap.innerHTML=`<div class="help-panel" id="help-panel" role="dialog" aria-modal="false" aria-labelledby="help-title" hidden><div class="help-head"><h2 id="help-title">Size nasıl yardımcı olalım?</h2><button type="button" class="help-close" data-action="toggle-help" aria-label="Yardım menüsünü kapat">${ico('close',18)}</button></div><div id="ege-assistant-root" data-assistant-slot></div><ul class="help-list"><li><a href="mailto:${business.email}">${ico('mail',18)}<span><b>E-posta</b>${business.email}</span></a></li><li><a href="${business.phoneHref}">${ico('phone',18)}<span><b>Telefon</b>${business.phone}</span></a></li><li><a href="contact.html">${ico('clipboard',18)}<span><b>İletişim formu</b>Satış, keşif veya servis talebi</span></a></li><li><a href="${business.wa}" rel="noopener">${ico('chat',18)}<span><b>WhatsApp</b>Hızlı soru için</span></a></li><li><a href="${business.map}" target="_blank" rel="noopener">${ico('pin',18)}<span><b>Yol tarifi</b>Kuşadası mağaza konumu<span class="sr-only"> (yeni sekmede açılır)</span></span></a></li></ul></div><button type="button" class="help-toggle" data-action="toggle-help" aria-expanded="false" aria-controls="help-panel">${ico('headset',20)}<span class="help-label">Yardım</span></button>`;document.body.appendChild(wrap);window.EgeAssistant=window.EgeAssistant||{mount(render){const slot=document.getElementById('ege-assistant-root');if(slot&&typeof render==='function')render(slot)}}}
function setHelpOpen(open){const panel=document.getElementById('help-panel'),btn=document.querySelector('.help-toggle');if(!panel||!btn)return;panel.hidden=!open;btn.setAttribute('aria-expanded',String(open));if(open)panel.querySelector('a')?.focus();else btn.focus()}
function renderFooter(){const root=document.querySelector('[data-site-footer]');if(!root)return;root.innerHTML=`<footer class="store-footer"><div class="wrap footer-grid"><div class="footer-company"><a class="brand light" href="/">EGE TEKNİK<small>KLİMA & TEKNOLOJİ</small></a><p>GREE klima satış, keşif, montaj ve satış sonrası destek.<br>${esc(business.address)}</p></div><div><b>İletişim</b><a href="mailto:${business.email}">${ico('mail',16)}${business.email}</a><a href="${business.phoneHref}">${ico('phone',16)}${business.phone}</a><a href="${business.map}" target="_blank" rel="noopener">${ico('pin',16)}Yol tarifi<span class="sr-only"> (yeni sekmede açılır)</span></a><a href="contact.html">${ico('clipboard',16)}İletişim formu</a></div><div><b>Ürünler</b>${NAV_CATEGORIES.slice(0,5).map(([c])=>`<a href="${esc(catalogHref({category:c}))}">${esc(c)}</a>`).join('')}<a href="catalog.html">Tüm ürünler</a></div><div><b>Hizmetler</b><a href="services.html">Montaj ve servis</a><a href="contact.html?subject=kesif">Keşif talebi</a><a href="regions.html">Hizmet bölgeleri</a><b class="footer-sub">Hesap</b><a href="/account">Hesabım</a><a href="order-lookup.html">Sipariş takibi</a><a href="checkout.html">Sepet</a></div></div><div class="wrap footer-bottom"><span>© 2026 Ege Teknik · Kuşadası / Aydın</span><nav class="footer-legal" aria-label="Yasal"><a href="policies.html">Satış ve iade koşulları</a><a href="policies.html#privacy">KVKK ve gizlilik</a><button type="button" class="footer-cookie" data-cookie-settings>Çerez tercihleri</button></nav></div></footer>`;/* the footer carries the cookie-preferences control, so the floating fallback button is not needed */document.querySelectorAll('.cookie-settings-trigger').forEach(b=>b.remove())}
function applyCatalogQuery(){const params=new URLSearchParams(location.search);const search=document.querySelector('#catalog-search');if(search)search.value=params.get('q')||'';const category=params.get('category')||'Tümü';document.querySelectorAll('[name=category]').forEach(el=>{el.checked=el.value===category});setBtuChip(params.get('btu')||'Tümü');for(const key of catalogFilterKeys){const el=document.querySelector(`[data-catalog-filter="${key}"]`);if(el)el.value=params.get(key)||''}renderCatalog()}
/* Product-detail data has its own trust boundary. The catalog list is used only for
   related products and cart authority; hero/specification/document content comes from
   GET /api/products/[id] exactly once. */
let selectedGalleryIndex=0;
const safeExternalHref=u=>{try{const url=new URL(String(u??''));return /^https:$/.test(url.protocol)?url.href:''}catch{return ''}};
function approvedGallery(p){if(!p)return[];const seen=new Set(),items=[];for(const item of Array.isArray(p.gallery)?p.gallery:[]){const url=safeImageSrc(item?.url);if(!url||seen.has(url))continue;seen.add(url);items.push({url,alt:String(item.alt||p.name||'Ürün görseli'),width:Number(item.width)||1,height:Number(item.height)||1})}return items}
function selectProductGallery(index){const items=approvedGallery(productDetail);if(!items.length)return;selectedGalleryIndex=Math.min(Math.max(Math.floor(index)||0,0),items.length-1);const item=items[selectedGalleryIndex],img=document.querySelector('.detail-image'),thumbs=document.querySelectorAll('[data-action="gallery-select"]');if(img&&typeof img.setAttribute==='function'&&thumbs&&thumbs.length===items.length){/* swap in place: no page re-render, focus and quantity stay where they are */if(img.getAttribute('src')!==item.url){img.classList.add('is-loading');const done=()=>img.classList.remove('is-loading');img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});img.setAttribute('src',item.url);img.setAttribute('alt',item.alt);img.setAttribute('width',item.width);img.setAttribute('height',item.height)}thumbs.forEach((t,i)=>{const on=i===selectedGalleryIndex;t.classList.toggle('active',on);t.setAttribute('aria-pressed',String(on))});const count=document.querySelector('[data-gallery-count]');if(count)count.textContent=`${selectedGalleryIndex+1} / ${items.length}`;return}const qty=document.querySelector('[data-product-quantity]')?.value;renderProductPage();const input=document.querySelector('[data-product-quantity]');if(input&&qty)input.value=qty}
async function loadProductDetail(){const root=document.querySelector('[data-product-page]');if(!root||productDetailState==='loading'||productDetailState==='ready')return productDetail;const id=new URLSearchParams(location.search).get('id');if(!id){productDetailState='not-found';renderProductPage();return null}productDetailState='loading';renderProductPage();try{const response=await fetch('/api/products/'+encodeURIComponent(id));const data=await response.json().catch(()=>({}));if(response.status===404){productDetailState='not-found';productDetail=null}else if(!response.ok||!data.product){productDetailState='unavailable';productDetail=null}else{productDetail=data.product;productDetailState='ready';selectedGalleryIndex=0;void loadProductReviews(true)}}catch{productDetailState='unavailable';productDetail=null}renderProductPage();return productDetail}
function productNotFoundMarkup(message){return `<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><a href="catalog.html">Ürünler</a></nav><div class="empty"><h1 class="pd-empty-title">Ürün gösterilemiyor</h1>${message} <a href="catalog.html">Kataloğa dönün.</a></div>`}
function detailFact(label,value){return value?`<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`:''}
function descriptionMarkup(p){const short=String(p.shortDescription||'').trim(),long=String(p.description||'').trim(),same=short&&long&&short.localeCompare(long,'tr',{sensitivity:'base'})===0;return long&&!same?plainTextParagraphs(long):''}
const SPEC_GROUPS=[['Genel',['capacity_btu','product_type','colour','refrigerant','power_supply','wifi','multi_function_filter','connectable_indoor_units']],['Performans ve verimlilik',['cooling_capacity_btuh','heating_capacity_btuh','cooling_capacity_kw','heating_capacity_kw','energy_class','energy_class_seer','seer','scop','power_input_cooling_w','power_input_heating_w','power_input_cooling_kw','power_input_heating_kw','operating_current']],['Boyut ve ağırlık',['indoor_dimensions','indoor_weight','outdoor_dimensions','outdoor_weight']],['Hava akışı ve ses',['indoor_airflow','outdoor_airflow','indoor_sound_pressure','outdoor_sound_pressure']],['Çalışma koşulları',['operating_temperature_cooling','operating_temperature_heating']]];
function specRows(list){return list.map(s=>`<div class="spec-row"><dt>${esc(s.label)}</dt><dd>${esc(s.value)}${s.unit?` <span>${esc(s.unit)}</span>`:''}</dd></div>`).join('')}
/* Only verified rows from the public API; order within a group is the API's stable order. Short lists stay one card, longer ones are grouped for scanning. */
function specificationMarkup(specs){const list=(Array.isArray(specs)?specs:[]).filter(s=>s&&s.label&&s.value!=null&&String(s.value).trim());if(!list.length)return '';if(list.length<=6)return `<div class="pd-spec-groups is-single"><div class="spec-group"><dl class="spec-table">${specRows(list)}</dl></div></div>`;const used=new Set(),groups=SPEC_GROUPS.map(([title,keys])=>{const items=list.filter(s=>keys.includes(s.key));items.forEach(s=>used.add(s));return [title,items]});const rest=list.filter(s=>!used.has(s));if(rest.length)groups.push(['Diğer',rest]);return `<div class="pd-spec-groups">${groups.filter(([,items])=>items.length).map(([title,items])=>`<div class="spec-group"><h3>${esc(title)}</h3><dl class="spec-table">${specRows(items)}</dl></div>`).join('')}</div>`}
const DOCUMENT_TYPES={catalog:'Katalog',manual:'Kullanım kılavuzu',energy_label:'Enerji etiketi',wifi_guide:'Wi-Fi rehberi',remote_guide:'Kumanda rehberi',erp:'Ürün bilgi formu'};
function documentMarkup(documents){return (Array.isArray(documents)?documents:[]).map(d=>{const href=safeExternalHref(d?.url);if(!href||!d.label)return '';const format=/\.pdf(?:$|[?#])/i.test(href)?'PDF':/\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(href)?'Görsel':'Bağlantı',type=DOCUMENT_TYPES[d.type]||'',typeText=type&&type.toLocaleLowerCase('tr')!==String(d.label).toLocaleLowerCase('tr')?type+' · ':'';return `<a class="document-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span class="doc-icon" aria-hidden="true">${format==='PDF'?'PDF':format==='Görsel'?'IMG':'URL'}</span><span class="doc-body"><span class="doc-title">${esc(d.label)}</span><small>${esc(typeText+format)}<span class="pd-sr"> (yeni sekmede açılır)</span></small></span><span class="doc-arrow" aria-hidden="true">↗</span></a>`}).filter(Boolean).join('')}
/* Product-page delivery notes from the product's stored delivery class (the value the server and the checkout use; nothing is inferred from the name or category). Quote-priced products and unknown classes state no delivery promise. */
/* Delivery copy for the product page, driven only by the stored deliveryClass. Two places, no shared sentence:
   deliveryNotes = the one-line purchasing facts beside the price; deliveryDetail = the "Montaj ve Teslimat" card below. */
function deliveryNotes(p,sale){
  if(!sale)return ['Teslimat ve montaj koşulları teklif sürecinde netleşir.'];
  switch(p.deliveryClass){
    case 'installed_delivery':return ['Standart montaj dahil.','Ege Teknik hizmet bölgesinde adrese teslim.'];
    case 'shippable':return ['Mağazadan teslim alabilirsiniz.','Kargo seçeneği henüz aktif değil.'];
    case 'local_delivery':return ['Ürün Ege Teknik hizmet bölgesinde bayi teslimatıyla gönderilir.'];
    default:return ['Teslimat ve montaj bilgisi ödeme adımında gösterilir.']}}
function deliveryDetail(p,sale){
  if(!sale)return {title:'Teslimat ve Montaj',paragraphs:['Kapsam ve fiyat, keşif sonrası hazırlanan teklifte netleşir.']};
  switch(p.deliveryClass){
    case 'installed_delivery':return {title:'Montaj ve Teslimat',paragraphs:['Ege Teknik veya ilgili GREE servis organizasyonu ürünü adresinize getirir; ayrıca teslimat ücreti alınmaz.','Yetkili servis yönlendirmesi ile standart montaj yapılır. Standart kapsam dışındaki borulama, elektrik, erişim ve yapı işleri ayrıca bildirilir ve onayınız olmadan ücretlendirilmez.']};
    case 'shippable':return {title:'Teslimat',paragraphs:['Ödeme adımında mağazadan teslim seçilir; bu seçenekte adres bilgisi istenmez.','Kargo tarifesi aktif olduğunda ödeme adımında seçenek olarak sunulur; kargo bedeli sipariş onaylanmadan önce gösterilir.']};
    case 'local_delivery':return {title:'Teslimat',paragraphs:['Teslimat adresi Ege Teknik hizmet bölgesinde olmalıdır; il ve ilçe ödeme adımında seçilir.','Standart montaj kapsamı ürün tipine göre uygulanır.']};
    default:return null}}
function relatedProductsFor(p,products){const seen=new Set([p.id]);return (products||[]).filter(x=>x&&x.id&&!seen.has(x.id)&&(seen.add(x.id),true)).map((x,index)=>({x,index,score:(p.series&&x.series===p.series?4:0)+(p.category&&x.category===p.category?2:0)+(capacityBtuDigits(p)&&capacityBtuDigits(x)===capacityBtuDigits(p)?1:0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,4).map(r=>r.x)}
/* Customer reviews (Phase 5A). Only approved reviews and aggregates computed from them are ever shown;
   zero reviews render an honest empty state, never 0-star social proof. Everything is escaped plain text. */
const REVIEW_LABELS=['','Çok kötü','Kötü','Orta','İyi','Çok iyi'];
let reviewState={status:'idle',productId:null,summary:null,reviews:[],nextCursor:null,sort:'newest',formOpen:false,sent:false,loadingMore:false};
const fmtRating=n=>new Intl.NumberFormat('tr-TR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n);
const starGlyphs=n=>{const full=Math.max(0,Math.min(5,Math.round(n)));return '★'.repeat(full)+'☆'.repeat(5-full)};
function reviewDate(iso){const d=new Date(String(iso)+'T00:00:00');return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'long',year:'numeric'}).format(d)}
async function loadProductReviews(reset=true){const p=productDetail;if(!p)return;if(reset)reviewState={...reviewState,status:'loading',productId:p.id,reviews:[],nextCursor:null,summary:null};else reviewState.loadingMore=true;renderReviewSection();
  try{const q=new URLSearchParams({sort:reviewState.sort,limit:'10'});if(!reset&&reviewState.nextCursor)q.set('cursor',reviewState.nextCursor);
    const response=await fetch(`/api/products/${encodeURIComponent(p.id)}/reviews?${q}`);const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.summary||!Array.isArray(data.reviews))throw new Error('reviews '+response.status);
    reviewState={...reviewState,status:'ready',summary:data.summary,reviews:reset?data.reviews:[...reviewState.reviews,...data.reviews],nextCursor:data.nextCursor||null,loadingMore:false}}
  catch{reviewState={...reviewState,status:reset?'unavailable':reviewState.status,loadingMore:false};if(!reset)toast('Daha fazla yorum yüklenemedi.')}
  renderReviewSection()}
function reviewHeroMarkup(){const s=reviewState.summary;return s&&s.count>0&&s.average!=null?`<a class="pd-rating-link" href="#yorumlar"><span aria-hidden="true">${starGlyphs(s.average)}</span> <b>${esc(fmtRating(s.average))}</b><span class="pd-sr"> 5 üzerinden,</span> · ${esc(s.count)} değerlendirme</a>`:''}
function reviewSummaryMarkup(s){const rows=[5,4,3,2,1].map(n=>{const c=Number(s.distribution?.[n])||0,pct=s.count?Math.round(c/s.count*100):0;return `<li><span class="rd-label">${n} yıldız</span><span class="rd-bar" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="rd-count">${c} <small>(%${pct})</small></span></li>`}).join('');
  return `<div class="review-summary"><div class="review-average"><span class="review-average-value">${esc(fmtRating(s.average))}</span><span class="review-stars" aria-hidden="true">${starGlyphs(s.average)}</span><span>5 üzerinden ${esc(fmtRating(s.average))} · ${esc(s.count)} değerlendirme</span></div><ul class="review-distribution" aria-label="Puan dağılımı">${rows}</ul></div>`}
function reviewItemMarkup(r){const n=Math.max(1,Math.min(5,Number(r.rating)||1)),date=reviewDate(r.date);
  return `<li class="review-item"><article><div class="review-head"><span class="review-stars" aria-hidden="true">${starGlyphs(n)}</span><span class="review-score">${n}/5<span class="pd-sr"> puan</span></span><b class="review-author">${esc(r.displayName)}</b>${date?`<time datetime="${esc(r.date)}">${esc(date)}</time>`:''}${r.verifiedPurchase===true?'<span class="review-verified">✓ Doğrulanmış satın alma</span>':''}</div><div class="review-body">${plainTextParagraphs(r.body)}</div></article></li>`}
function reviewFormMarkup(){if(reviewState.sent)return '<p class="review-sent" role="status">Yorumunuz alındı. Yayınlanmadan önce incelenir.</p>';if(!reviewState.formOpen)return '';
  const stars=[1,2,3,4,5].map(n=>`<input class="review-radio" type="radio" name="rating" id="review-rating-${n}" value="${n}" required><label for="review-rating-${n}"><span aria-hidden="true">★</span><span class="pd-sr">${n} yıldız – ${REVIEW_LABELS[n]}</span></label>`).join('');
  return `<form class="review-form" id="review-form" data-review-form novalidate><p class="review-note">Yorumunuz yayınlanmadan önce incelenir. Hesap açmanız gerekmez.</p><p class="review-errors" data-review-errors role="alert" hidden></p>
<fieldset class="review-rating" data-rating-value="0" aria-describedby="review-rating-help review-rating-error"><legend>Puanınız <span>(zorunlu)</span></legend><div class="review-stars-input">${stars}</div><p class="review-help" id="review-rating-help" data-rating-text>Henüz puan seçmediniz.</p><p class="field-error" id="review-rating-error" data-error-for="rating"></p></fieldset>
<label class="field" for="review-name">Görünecek adınız<input id="review-name" name="displayName" maxlength="40" autocomplete="nickname" required aria-describedby="review-name-help review-name-error"><small class="field-help" id="review-name-help">Örneğin “Ahmet Y.”. E-posta veya telefon yazmayın.</small><span class="field-error" id="review-name-error" data-error-for="displayName"></span></label>
<label class="field" for="review-body">Yorumunuz<textarea id="review-body" name="body" rows="5" minlength="10" maxlength="2000" required aria-describedby="review-body-help review-body-error"></textarea><small class="field-help" id="review-body-help"><span data-body-count>0</span>/2000 karakter · bağlantı eklenemez</small><span class="field-error" id="review-body-error" data-error-for="body"></span></label>
<details class="review-verify"><summary>Satın aldığınızı doğrulayın (isteğe bağlı)</summary><p class="field-help">Sipariş numaranız ve iletişim bilginiz yorumda gösterilmez; yalnızca satın almayı doğrulamak için kullanılır.</p><label class="field" for="review-order">Sipariş numarası<input id="review-order" name="orderNumber" maxlength="40" autocomplete="off" placeholder="ETS-20260101-ABC123" aria-describedby="review-order-error"><span class="field-error" id="review-order-error" data-error-for="orderNumber"></span></label><label class="field" for="review-contact">Siparişteki telefon veya e-posta<input id="review-contact" name="contact" maxlength="150" autocomplete="off" aria-describedby="review-contact-error"><span class="field-error" id="review-contact-error" data-error-for="contact"></span></label></details>
<div class="review-hp" aria-hidden="true"><label>Web sitesi<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="notice" data-kvkk-notice></p>
<button type="submit" class="primary" data-review-submit>Yorumu gönder</button></form>`}
function reviewSectionInner(){const s=reviewState.summary,st=reviewState.status,write=reviewState.sent?'':`<button type="button" class="ghost review-write" data-action="review-open" aria-expanded="${reviewState.formOpen}" aria-controls="review-form">Yorum yazın</button>`;
  if(st==='idle'||st==='loading')return '<p class="review-loading">Yorumlar yükleniyor…</p>';
  if(st==='unavailable')return '<p class="review-empty">Yorumlar şu anda yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>';
  if(!s||!s.count)return `<p class="review-empty">Bu ürün için henüz müşteri yorumu bulunmuyor.</p>${write}${reviewFormMarkup()}`;
  return `${reviewSummaryMarkup(s)}<div class="review-toolbar">${write}<label class="review-sort" for="review-sort">Sırala<select id="review-sort" data-review-sort>${[['newest','En yeni'],['highest','En yüksek puan'],['lowest','En düşük puan']].map(([v,t])=>`<option value="${v}"${reviewState.sort===v?' selected':''}>${t}</option>`).join('')}</select></label></div>${reviewFormMarkup()}<ol class="review-list">${reviewState.reviews.map(reviewItemMarkup).join('')}</ol>${reviewState.nextCursor?`<button type="button" class="ghost review-more" data-action="review-more"${reviewState.loadingMore?' disabled':''}>${reviewState.loadingMore?'Yükleniyor…':'Daha fazla yorum'}</button>`:''}`}
function reviewSectionMarkup(){return `<section class="pd-section pd-reviews" id="yorumlar" aria-labelledby="yorumlar-title"><h2 id="yorumlar-title">Müşteri Yorumları</h2><div data-reviews-root>${reviewSectionInner()}</div></section>`}
function renderReviewSection(){const root=document.querySelector('[data-reviews-root]');if(root&&typeof root.innerHTML==='string')root.innerHTML=reviewSectionInner();const hero=document.querySelector('[data-review-hero]');if(hero)hero.innerHTML=reviewHeroMarkup();if(reviewState.formOpen&&!reviewState.sent&&document.querySelector('[data-review-form] [data-kvkk-notice]'))void renderKvkkNotices()}
function openReviewForm(){reviewState.formOpen=true;renderReviewSection();document.querySelector('[data-review-form] .review-radio')?.focus()}
function reviewFieldValues(form){const get=n=>form.querySelector(`[name="${n}"]`),rating=form.querySelector('[name="rating"]:checked');return {rating:rating?Number(rating.value):0,displayName:String(get('displayName')?.value||''),body:String(get('body')?.value||''),orderNumber:String(get('orderNumber')?.value||'').trim(),contact:String(get('contact')?.value||'').trim(),website:String(get('website')?.value||'')}}
/* Mirrors the server rules for fast feedback; the server re-validates everything. */
function validateReviewInput(v){const e={};if(!(Number.isInteger(v.rating)&&v.rating>=1&&v.rating<=5))e.rating='Lütfen 1 ile 5 arasında bir puan seçin.';const name=v.displayName.trim(),body=v.body.trim();
  if(name.length<2||name.length>40)e.displayName='Görünecek ad 2–40 karakter olmalı.';else if(/\S+@\S+/.test(name)||/(\d[\s().-]*){7,}/.test(name))e.displayName='Görünecek ada e-posta veya telefon yazmayın.';
  if(body.length<10)e.body='Yorum en az 10 karakter olmalı.';else if(body.length>2000)e.body='Yorum en fazla 2000 karakter olabilir.';
  if(Boolean(v.orderNumber)!==Boolean(v.contact))e[v.orderNumber?'contact':'orderNumber']='Doğrulama için sipariş numarası ile telefon veya e-postayı birlikte girin.';return e}
function showReviewErrors(form,errors,summary){form.querySelectorAll('[data-error-for]').forEach(el=>{const key=el.dataset.errorFor,msg=errors[key]||'';el.textContent=msg;const input=key==='rating'?form.querySelector('.review-rating'):form.querySelector(`[name="${key}"]`);if(input){if(msg)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid')}});
  const box=form.querySelector('[data-review-errors]');if(box){const has=Object.keys(errors).length>0||!!summary;box.hidden=!has;box.textContent=summary||(has?'Lütfen işaretli alanları düzeltin.':'')}}
async function submitReview(e){const form=e.target.closest?.('[data-review-form]');if(!form||!productDetail)return;e.preventDefault();const values=reviewFieldValues(form),errors=validateReviewInput(values);showReviewErrors(form,errors,'');
  if(Object.keys(errors).length){const first=Object.keys(errors)[0];(first==='rating'?form.querySelector('.review-radio'):form.querySelector(`[name="${first}"]`))?.focus();return}
  const button=form.querySelector('[data-review-submit]');form.dataset.idempotencyKey=form.dataset.idempotencyKey||crypto.randomUUID();if(button){button.disabled=true;button.textContent='Gönderiliyor…'}
  const payload={rating:values.rating,displayName:values.displayName,body:values.body};if(values.orderNumber){payload.orderNumber=values.orderNumber;payload.contact=values.contact}if(values.website)payload.website=values.website;
  try{const response=await fetch(`/api/products/${encodeURIComponent(productDetail.id)}/reviews`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':form.dataset.idempotencyKey},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));
    if(response.status===202){reviewState={...reviewState,sent:true,formOpen:false};renderReviewSection();return}
    showReviewErrors(form,data.fields||{},response.status===429?'Çok fazla yorum gönderildi. Lütfen daha sonra tekrar deneyin.':data.error||'Yorumunuz gönderilemedi. Lütfen tekrar deneyin.')}
  catch{showReviewErrors(form,{},'Bağlantı kurulamadı. Lütfen tekrar deneyin.')}
  if(button){button.disabled=false;button.textContent='Yorumu gönder'}}
function onReviewInput(e){const t=e.target;if(t?.name==='rating'){const fs=t.closest('.review-rating'),n=Number(t.value);if(fs){fs.dataset.ratingValue=String(n);const txt=fs.querySelector('[data-rating-text]');if(txt)txt.textContent=`Seçiminiz: ${n}/5 – ${REVIEW_LABELS[n]}`}}else if(t?.name==='body'){const c=t.closest('form')?.querySelector('[data-body-count]');if(c)c.textContent=String(t.value.length)}}
const pdIcon=d=>`<svg class="pd-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PD_ICONS={check:'M5 12.5l4.2 4.2L19 7',shield:'M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6l7-3z',doc:'M7 3h7l5 5v13H7zM14 3v5h5',truck:'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',tool:'M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',chat:'M4 5h16v11H9l-5 4z'};
/* "Öne çıkan özellikler": only verified specification rows the public API returned; nothing is inferred. */
const HIGHLIGHT_KEYS=[['capacity_btu','Kapasite'],['energy_class','Enerji sınıfı'],['seer','SEER'],['scop','SCOP'],['indoor_sound_db','İç ünite ses seviyesi'],['indoor_sound_pressure','İç ünite ses basıncı'],['wifi','Wi-Fi kontrol'],['refrigerant','Soğutucu akışkan'],['indoor_dimensions','İç ünite ölçüleri']];
/* Typical use by capacity (same wording as the homepage capacity guide); only for single wall/floor units, never for multi-system parts. */
function usageFor(p){if(!p||p.category==='Multi Sistem'||p.category==='Yedek Parça')return '';const b=Number(capacityBtuDigits(p));return ({9000:'küçük oda (yatak, çalışma veya çocuk odası)',12000:'oda ve küçük salon',18000:'salon, mutfakla birleşik oturma alanı',24000:'büyük ve açık plan salon'})[b]||''}
function highlightMarkup(specs){const list=Array.isArray(specs)?specs:[],items=HIGHLIGHT_KEYS.map(([key,label])=>{const s=list.find(x=>x&&x.key===key&&x.value!=null&&String(x.value).trim());return s?`<li><span>${esc(label)}</span><b>${esc(key==='capacity_btu'?formatCapacity(s.value+' BTU/h').replace(/ BTU\/h$/,''):s.value)}${s.unit?` <small>${esc(s.unit)}</small>`:''}</b></li>`:''}).filter(Boolean).slice(0,6);return items.length>=2?`<ul class="pd-highlights" aria-label="Öne çıkan özellikler">${items.join('')}</ul>`:''}
/* The compact mobile buy bar only appears once the main purchase box has scrolled out of view. */
let stickyObserver=null;
/* product.html?id=…#belgeler: the section only exists after the detail loads, so honour the hash once it does. */
let productHashHandled=false;
function scrollToProductHash(){if(productHashHandled)return;productHashHandled=true;const id=String(location.hash||'').slice(1);if(!/^[a-z-]{2,20}$/.test(id))return;const go=()=>{const el=document.getElementById(id);if(el&&typeof el.scrollIntoView==='function')el.scrollIntoView({block:'start'})};setTimeout(go,50);if(typeof window.addEventListener==='function')window.addEventListener('load',()=>setTimeout(go,50),{once:true})}
function watchStickyBuy(){const bar=document.querySelector('.pd-sticky'),box=document.querySelector('.pd-buy');stickyObserver?.disconnect?.();if(!bar||!box||typeof IntersectionObserver!=='function')return;stickyObserver=new IntersectionObserver(([entry])=>{bar.classList.toggle('is-visible',!entry.isIntersecting&&entry.boundingClientRect.top<0)});stickyObserver.observe(box)}
function renderProductPage(){const root=document.querySelector('[data-product-page]');if(!root)return;if(productDetailState==='idle'||productDetailState==='loading'){root.innerHTML='<p class="sr-only" role="status">Ürün ayrıntıları yükleniyor…</p><div class="pd-hero detail-grid pd-skeleton" aria-hidden="true"><div class="product-gallery"><div class="detail-visual"></div></div><div class="pd-info"><div class="skeleton-line w40"></div><div class="skeleton-line w80 h24"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40 h24"></div><div class="pd-buy"><div class="skeleton-line w80 h24"></div><div class="skeleton-line w60 h24"></div><div class="skeleton-line w80"></div></div></div></div>';return}if(productDetailState==='not-found'){root.innerHTML=productNotFoundMarkup('Ürün bulunamadı. Ürün kaldırılmış veya bağlantı hatalı olabilir.');document.title='Ürün bulunamadı | Ege Teknik';return}if(productDetailState!=='ready'||!productDetail){root.innerHTML=productNotFoundMarkup('Ürün ayrıntıları şu anda alınamıyor. Lütfen daha sonra tekrar deneyin.');return}
  const p=productDetail,sale=p.saleMode==='online',stock=Math.max(0,Math.floor(Number(p.stock)||0)),limit=productQuantityLimit(stock),name=esc(p.name),pid=esc(p.id),kesif=`contact.html?subject=${sale?'urun':'kesif'}&product=${encodeURIComponent(p.id)}`,gallery=approvedGallery(p),active=gallery[Math.min(selectedGalleryIndex,gallery.length-1)],specs=specificationMarkup(p.specifications),documents=documentMarkup(p.documents),related=catalogAuthoritative()?relatedProductsFor(p,getProducts()):[],short=String(p.shortDescription||'').trim(),long=descriptionMarkup(p),hasWarranty=!!(p.warranty&&p.warranty.text),verifiedWarranty=hasWarranty&&p.warranty.kind==='product';
  const galleryMarkup=active?`<div class="product-gallery"><div class="detail-visual"><img class="detail-image" data-product-image="main" src="${esc(active.url)}" alt="${esc(active.alt)}" width="${esc(active.width)}" height="${esc(active.height)}" fetchpriority="high" decoding="async">${gallery.length>1?`<span class="pd-gallery-count" data-gallery-count aria-hidden="true">${selectedGalleryIndex+1} / ${gallery.length}</span>`:''}</div>${gallery.length>1?`<div class="gallery-thumbs" role="group" aria-label="Ürün görselleri">${gallery.map((g,i)=>`<button type="button" class="gallery-thumb${i===selectedGalleryIndex?' active':''}" data-action="gallery-select" data-index="${i}" aria-label="${esc(g.alt)} görselini göster" aria-pressed="${i===selectedGalleryIndex}"><img data-product-image="thumb" src="${esc(g.url)}" alt="" width="${esc(g.width)}" height="${esc(g.height)}" loading="lazy" decoding="async"></button>`).join('')}</div>`:''}</div>`:`<div class="product-gallery"><div class="detail-visual missing-product-image">${productImagePlaceholder(p.name,true)}</div></div>`;
  const status=sale?(stock>0?`<span class="pd-status is-available">Stokta · ${esc(stock)} adet</span>`:'<span class="pd-status is-soldout">Tükendi</span>'):'<span class="pd-status is-quote">Teklif ile satılır</span>';
  const offer=`<div class="pd-offer">${sale?`<div class="pd-price"><span class="pd-amount">${money(p.price)}</span><span class="pd-vat">KDV dahil</span></div>`:'<div class="pd-price is-quote"><span class="pd-amount">Fiyat teklif ile belirlenir</span><span class="pd-vat">Projelendirme ile satılır</span></div>'}${status}</div>`;
  const facts=[['Seri',p.series&&p.series!==p.category?p.series:''],['Kapasite',formatCapacity(p.capacity)],['Enerji sınıfı',p.energyClass],['Wi-Fi',p.wifi]].filter(([,v])=>v&&String(v).trim()).map(([l,v])=>`<li><span>${esc(l)}</span><b>${esc(v)}</b></li>`).join('');
  const primary=sale?(stock>0?`<div class="purchase-row"><div class="quantity-control"><label for="product-quantity">Adet</label><div><button type="button" data-action="quantity-step" data-step="-1" aria-label="Adedi azalt">−</button><input id="product-quantity" data-product-quantity type="number" inputmode="numeric" min="1" max="${limit}" step="1" value="1" aria-describedby="quantity-help"><button type="button" data-action="quantity-step" data-step="1" aria-label="Adedi artır">+</button></div></div><button type="button" class="primary add-product-cart" data-action="add-product-cart" data-id="${pid}">Sepete Ekle</button></div><small class="pd-help" id="quantity-help">En fazla ${limit} adet eklenebilir.</small>`:`<p class="sold-out" role="status">Bu ürün şu anda stokta yok. Stok durumu için bize ulaşabilirsiniz.</p><button type="button" class="primary" disabled>Sepete Ekle</button>`):`<a class="primary pd-cta" href="${kesif}">Teklif talep et</a>`;
  const fav=getFavorites().includes(p.id),cmp=getCompare().includes(p.id);
  const secondary=`<div class="pd-secondary"><button type="button" class="ghost" data-action="quote" data-id="${pid}">${pdIcon(PD_ICONS.chat)}WhatsApp’tan Sor</button>${sale?`<a class="ghost" href="${kesif}">Ürün hakkında bilgi al</a>`:''}</div><div class="pd-toggles"><button type="button" class="pd-toggle" data-action="toggle-favorite" data-id="${pid}" aria-pressed="${fav}">${ico('heart',18)}<span data-toggle-label>${fav?'Favorilerde':'Favorilere ekle'}</span></button><button type="button" class="pd-toggle" data-action="toggle-compare" data-id="${pid}" aria-pressed="${cmp}">${ico('compare',18)}<span data-toggle-label>${cmp?'Karşılaştırmada':'Karşılaştır'}</span></button><a class="pd-toggle" href="compare.html">Karşılaştırma listesi</a></div>`;
  const notes=`<ul class="pd-notes">${deliveryNotes(p,sale).map((text,i)=>`<li>${pdIcon(i===0&&p.deliveryClass==='installed_delivery'?PD_ICONS.tool:PD_ICONS.truck)}<span>${esc(text)}</span></li>`).join('')}</ul>`;
  const assure=`<ul class="pd-assure" aria-label="Ege Teknik hizmetleri"><li>${ico('pin',18)}<span><b>Hizmet bölgesi</b>Kuşadası merkezli, <a href="regions.html">9 ilde</a> satış ve servis</span></li><li>${ico('clipboard',18)}<span><b>Keşif</b><a href="${kesif.replace(/subject=urun/,'subject=kesif')}">Yerinde değerlendirme isteyin</a></span></li><li>${ico('headset',18)}<span><b>Satış sonrası</b>Bakım, arıza ve yedek parça desteği</span></li></ul>`;
  const trust=`<ul class="pd-trust" aria-label="Satın alma bilgileri">${sale?`<li>${pdIcon(PD_ICONS.check)}Fiyatlar KDV dahildir</li>`:''}${hasWarranty?`<li>${pdIcon(PD_ICONS.shield)}<a href="#garanti">Garanti bilgisi</a></li>`:''}<li>${pdIcon(PD_ICONS.doc)}<a href="policies.html">Satış, iade ve yasal bilgiler</a></li></ul>`;
  const warranty=hasWarranty?`<section class="pd-card warranty-card${verifiedWarranty?' is-verified':''}" id="garanti" aria-labelledby="garanti-title"><h2 id="garanti-title">${pdIcon(PD_ICONS.shield)}Garanti</h2><p>${esc(p.warranty.text)}</p>${verifiedWarranty&&p.warranty.conditions?`<p class="pd-muted">${esc(p.warranty.conditions)}</p>`:''}</section>`:'';
  const detail=deliveryDetail(p,sale);
  const install=detail?`<section class="pd-card" aria-labelledby="kurulum-title"><h2 id="kurulum-title">${pdIcon(PD_ICONS.tool)}${esc(detail.title)}</h2>${detail.paragraphs.map(t=>`<p>${esc(t)}</p>`).join('')}</section>`:'';
  const highlights=highlightMarkup(p.specifications);
  const usage=usageFor(p),aboutText=long||usage;
  const navItems=[[highlights,'ozellikler','Özellikler'],[aboutText,'aciklama','Açıklama'],[specs,'teknik','Teknik özellikler'],[documents,'belgeler','Belgeler'],[hasWarranty||install,'teslimat',p.deliveryClass==='installed_delivery'&&sale?'Montaj ve teslimat':'Teslimat'],[true,'yorumlar','Yorumlar']].filter(([on])=>on);
  const pdNav=`<nav class="pd-nav" aria-label="Ürün bölümleri"><div>${navItems.map(([,id,label])=>`<a href="#${id}">${label}</a>`).join('')}</div></nav>`;
  const stickyBar=sale&&stock>0?`<div class="pd-sticky" aria-hidden="true"><div><b>${money(p.price)}</b><small>KDV dahil · Stokta</small></div><button type="button" class="primary" data-action="add-cart" data-id="${pid}" tabindex="-1">Sepete Ekle</button></div>`:!sale?`<div class="pd-sticky" aria-hidden="true"><div><b>Teklif ile satılır</b><small>Keşif sonrası fiyat</small></div><a class="primary" href="${kesif}" tabindex="-1">Teklif iste</a></div>`:'';
  root.innerHTML=`<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><a href="catalog.html">Ürünler</a><span aria-hidden="true">›</span><span aria-current="page">${name}</span></nav><section class="pd-hero detail-grid">${galleryMarkup}<div class="pd-info detail-buy"><div class="pd-title"><div class="eyebrow">${esc([p.category,p.series].filter(Boolean).join(' · '))}</div><h1>${name}</h1>${p.sku?`<p class="pd-meta sku">Model kodu <b>${esc(p.sku)}</b></p>`:''}<p class="pd-rating" data-review-hero>${reviewHeroMarkup()}</p></div>${short?`<p class="pd-lead lead">${esc(short)}</p>`:''}${offer}${facts?`<ul class="pd-facts" aria-label="Öne çıkan özellikler">${facts}</ul>`:''}<div class="pd-buy">${primary}${secondary}${notes}</div>${trust}${assure}</div></section>${pdNav}${highlights?`<section class="pd-section" id="ozellikler" aria-labelledby="ozellikler-title"><h2 id="ozellikler-title">Öne Çıkan Özellikler</h2>${highlights}</section>`:''}${aboutText?`<section class="pd-section" id="aciklama" aria-labelledby="aciklama-title"><h2 id="aciklama-title">Ürün Açıklaması</h2><div class="pd-prose">${long}${usage?`<p class="pd-usage"><b>Kapasiteye göre tipik kullanım:</b> ${esc(usage)}. Kesin seçim mekânın güneş, yalıtım ve kullanım koşullarına bağlıdır.</p>`:''}</div></section>`:''}${specs?`<section class="pd-section" id="teknik" aria-labelledby="teknik-title"><h2 id="teknik-title">Teknik Özellikler</h2>${specs}</section>`:''}${documents?`<section class="pd-section" id="belgeler" aria-labelledby="belge-title"><h2 id="belge-title">Belgeler ve Dokümanlar</h2><div class="document-grid">${documents}</div></section>`:''}${hasWarranty||install?`<div class="pd-section pd-support${hasWarranty&&install?'':' is-single'}" id="teslimat">${warranty}${install}</div>`:''}${reviewSectionMarkup()}<section class="pd-section contact-panel" aria-labelledby="destek-title"><div><h2 id="destek-title">Ürün hakkında desteğe mi ihtiyacınız var?</h2><p>Model seçimi, teklif ve teslimat bilgisi için bize yazın: ${business.email} · ${business.phone}</p></div><div class="buy-actions"><a class="primary" href="${kesif}">İletişim / Teklif</a><a class="ghost" href="mailto:${business.email}?subject=${encodeURIComponent(p.name+' hakkında')}">E-posta gönder</a></div></section>${related.length?`<section class="pd-section related-section" aria-labelledby="ilgili-title"><h2 id="ilgili-title">İlgili Ürünler</h2><div class="product-grid">${related.map(productCard).join('')}</div></section>`:''}${stickyBar}`;watchStickyBuy();scrollToProductHash();document.title=p.name+' | Ege Teknik Kuşadası';document.querySelector('meta[name="description"]')?.setAttribute('content',String(p.shortDescription||p.name+' — fiyat, teknik özellikler ve teslimat bilgileri.').slice(0,170));document.querySelector('link[rel="canonical"]')?.setAttribute('href','https://egeteknik.tr/product.html?id='+encodeURIComponent(p.id))}
const regions=[['aydin','Aydın'],['izmir','İzmir'],['mugla','Muğla'],['manisa','Manisa'],['denizli','Denizli'],['usak','Uşak'],['afyonkarahisar','Afyonkarahisar'],['kutahya','Kütahya'],['balikesir','Balıkesir']];
/* Service-area map: the SVG is static markup; this only wires selection. Every province links to its real region page and a survey request. */
function selectMapProvince(slug){const region=regions.find(r=>r[0]===slug);const panel=document.querySelector('[data-map-panel]');if(!region||!panel)return;document.querySelectorAll('[data-map-province]').forEach(p=>p.classList.toggle('is-active',p.dataset.mapProvince===slug));document.querySelectorAll('[data-map-select]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mapSelect===slug)));const hq=slug==='aydin';panel.innerHTML=`<span class="eyebrow">${hq?'Merkez · Kuşadası':'Hizmet bölgesi'}</span><h3>${esc(region[1])}</h3><p>${hq?'Ege Teknik’in merkezi Kuşadası’ndadır. Aydın genelinde satış, keşif, montaj ve servis talepleri buradan planlanır.':`${esc(region[1])} genelinde GREE klima satışı, keşif, montaj ve servis taleplerini Kuşadası merkezimizden planlıyoruz.`}</p><ul class="map-services"><li>Klima satışı ve kapasite danışmanlığı</li><li>Keşif ve montaj planlaması</li><li>Bakım, arıza ve yedek parça talepleri</li></ul><div class="map-actions"><a class="primary inline" href="contact.html?subject=kesif&city=${esc(slug)}">Keşif talebi</a><a class="ghost inline" href="region.html?city=${esc(slug)}">${esc(region[1])} sayfası</a></div>`}
function renderServiceMap(){const root=document.querySelector('[data-service-map]');if(!root||root.dataset.ready)return;root.dataset.ready='1';const list=root.querySelector('[data-map-list]');if(list)list.innerHTML=regions.map(([s,n])=>`<button type="button" class="chip" data-map-select="${s}" aria-pressed="false">${n}</button>`).join('');root.addEventListener('click',e=>{const t=e.target.closest?.('[data-map-select],[data-map-province]');if(t)selectMapProvince(t.dataset.mapSelect||t.dataset.mapProvince)});selectMapProvince('aydin')}
function renderRegions(){const root=document.querySelector('[data-regions]');if(root)root.innerHTML=regions.map(([s,n])=>`<a class="region-card" href="region.html?city=${s}"><span>Hizmet bölgesi</span><b>${n}</b><small>Satış • keşif • montaj • servis</small></a>`).join('')}
function renderRegionPage(){const root=document.querySelector('[data-region-page]');if(!root)return;const slug=new URLSearchParams(location.search).get('city')||'aydin';/* The URL value is only ever used as a lookup key: an unknown city renders the generic page and is never echoed into the markup. */const region=regions.find(x=>x[0]===slug),name=region?.[1]||'Hizmet Bölgesi';root.innerHTML=`<div class="eyebrow">Ege Teknik hizmet bölgesi</div><h1>${name} Klima Satış, Montaj ve Servis</h1><p class="lead">Kuşadası merkezli Ege Teknik; ${name} genelinde GREE klima satışı, keşif, montaj, bakım, onarım ve yedek parça taleplerini planlı servis organizasyonuyla karşılar.</p><div class="service-grid"><article><b>Klima satışı</b><p>İhtiyaca uygun BTU ve seri seçimi, online sipariş veya teklif.</p></article><article><b>Keşif ve montaj</b><p>Mekân koşulları, borulama ve dış ünite konumunun değerlendirilmesi.</p></article><article><b>Bakım ve onarım</b><p>Periyodik bakım, arıza kontrolü ve parça temini.</p></article></div><div class="region-cta"><div><h2>${name} için servis veya keşif isteyin</h2><p>Adresinizi ve ihtiyacınızı iletin; uygun hizmet planı için sizi arayalım.</p></div><a class="primary" href="contact.html${region?`?city=${region[0]}`:''}">Talep oluştur</a></div>`;document.title=name+' Klima Servisi ve Satış | Ege Teknik'}
/* Klima Rehberi articles are pre-rendered static pages (public/rehber/*.html, built by
   scripts/build-klima-rehberi.mjs). Old article.html?slug=… links are redirected server-side
   (next.config.ts); this map is the client-side fallback for the same addresses. */
const GUIDE_LEGACY={'klima-btu-hesaplama':'klima-btu-hesaplama','9000-btu-kac-metrekare':'btu-kapasite-farklari','12000-btu-kac-metrekare':'btu-kapasite-farklari','18000-btu-kac-metrekare':'btu-kapasite-farklari','24000-btu-nerede-kullanilir':'btu-kapasite-farklari','gree-serileri-karsilastirma':'gree-serileri-karsilastirma','inverter-klima-nedir':'inverter-klima-nedir','klima-elektrik-tuketimi':'enerji-sinifi-seer-scop','enerji-sinifi-farki':'enerji-sinifi-seer-scop','klima-neden-sogutmaz':'klima-neden-sogutmaz','klima-neden-su-akitir':'klima-neden-su-akitir','klima-bakimi-ne-zaman':'klima-bakimi-ne-zaman','ikinci-el-klima-alinir-mi':'ikinci-el-klima-alinir-mi','kusadasi-klima-secimi':'mekana-gore-klima-secimi','yazlik-ev-klima-secimi':'mekana-gore-klima-secimi'};
/* article.html now only hosts admin-managed posts. A known legacy guide slug moves to its static page;
   anything else waits for /api/blog and shows an honest "not found" state when no post matches. */
function renderArticle(){const root=document.querySelector('[data-article]');if(!root)return;const slug=new URLSearchParams(location.search).get('slug')||'';const target=Object.prototype.hasOwnProperty.call(GUIDE_LEGACY,slug)?GUIDE_LEGACY[slug]:null;if(target&&typeof location.replace==='function'){location.replace('/rehber/'+target+'.html');return}if(!slug)articleNotFound(root)}
function articleNotFound(root){root.innerHTML='<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><a href="blog.html">Klima Rehberi</a></nav><div class="empty article-missing"><h1>Aradığınız yazı bulunamadı</h1><p>Yazı kaldırılmış veya adresi değişmiş olabilir. Tüm içeriklerimiz Klima Rehberi sayfasında.</p><a class="primary" href="blog.html">Klima Rehberi’ne git</a></div>'}
/* Contact form: posts to the real /api/service-requests endpoint (stored for the Ege Teknik team). Success is only shown after
   the server returns a request number; WhatsApp is offered as an optional follow-up, never opened automatically. */
function renderContactForm(){const f=document.querySelector('[data-contact-form]');if(!f)return;const q=new URLSearchParams(location.search),subject=f.querySelector('[name=subject]'),city=f.querySelector('[name=city]');if(subject&&q.get('subject')&&[...(subject.options||[])].some(o=>o.value===q.get('subject')))subject.value=q.get('subject');const region=regions.find(r=>r[0]===q.get('city'));if(city&&region)city.value=region[1];const product=q.get('product'),message=f.querySelector('[name=message]');if(message&&product&&/^[A-Za-z0-9._:-]{1,160}$/.test(product)&&!message.value)message.value=`Ürün: ${product}\n`;
  f.addEventListener('submit',async e=>{e.preventDefault();const d=new FormData(f),button=f.querySelector('button[type=submit]'),status=f.querySelector('[data-form-status]'),say=(t,ok)=>{if(status){status.setAttribute('role','alert');status.textContent=t;status.className='form-status'+(ok?' is-ok':'');status.hidden=!t}};
    const phone=String(d.get('phone')||'').trim(),email=String(d.get('email')||'').trim();if(!phone&&!email){say('Size ulaşabilmemiz için e-posta veya telefon girin.');f.querySelector('[name=email]')?.focus();return}if(!f.checkValidity?.()){f.reportValidity?.();return}
    button.disabled=true;button.textContent='Talebiniz gönderiliyor…';say('');const payload={type:d.get('subject'),name:d.get('name'),phone,email,city:d.get('city'),message:d.get('message')},attemptKey=sessionStorage.getItem('ege-service-attempt')||crypto.randomUUID();sessionStorage.setItem('ege-service-attempt',attemptKey);
    try{const response=await fetch('/api/service-requests',{method:'POST',headers:{'content-type':'application/json','idempotency-key':attemptKey},body:JSON.stringify(payload)});const result=await response.json().catch(()=>({}));if(!response.ok||!result.requestNumber)throw new Error(result.error||'Talep kaydedilemedi.');sessionStorage.removeItem('ege-service-attempt');const wa=business.wa+'?text='+encodeURIComponent(`Ege Teknik web talebi ${result.requestNumber}`);
      f.innerHTML=`<div class="form-success" role="status" tabindex="-1"><h2>Talebiniz alındı</h2><p>Takip numaranız <b>${esc(result.requestNumber)}</b>. Ekibimiz ${email?'e-posta':'telefon'} ile size dönüş yapacak.</p><p class="field-help">Acil bir durum için <a href="${business.phoneHref}">${business.phone}</a> numarasını arayabilir veya talebinizi <a href="${esc(wa)}" rel="noopener">WhatsApp’tan</a> hatırlatabilirsiniz.</p></div>`;f.querySelector('.form-success')?.focus()}
    catch(error){button.disabled=false;button.textContent='Tekrar deneyin';say((error.message||'Talep kaydedilemedi.')+' Dilerseniz '+business.email+' adresine yazabilir veya '+business.phone+' numarasını arayabilirsiniz.')}})}
/* Klima Seçici: one estimator shared by selector.html and the homepage section (area × 500 BTU, sun and insulation
   factors, +500 BTU per occupant above two). It is a first estimate only; anything outside a single wall unit's range,
   commercial spaces and harsh conditions are sent to an on-site survey rather than given a number. */
const SELECTOR_TYPES=[['salon','Salon / oturma odası'],['yatak','Yatak odası'],['cocuk','Çocuk / çalışma odası'],['ofis','Ofis'],['magaza','Mağaza / işyeri']];
const BTU_CLASSES=[9000,12000,18000,24000];
function renderBtuSelector(){document.querySelectorAll('[data-btu-selector]').forEach(root=>{if(root.dataset.ready)return;root.dataset.ready='1';const opt=(v,t,sel)=>`<option value="${v}"${sel?' selected':''}>${t}</option>`;
  root.innerHTML=`<form class="selector-form" data-selector-form novalidate><div class="field-grid selector-fields"><label class="field" for="sel-city">Şehir<select id="sel-city">${regions.map(([s,n])=>opt(s,n,s==='aydin')).join('')}</select></label><label class="field" for="sel-type">Mekân türü<select id="sel-type">${SELECTOR_TYPES.map(([v,t])=>opt(v,t,v==='salon')).join('')}</select></label><label class="field" for="sel-area">Alan (m²)<input id="sel-area" type="number" inputmode="numeric" min="5" max="200" step="1" value="24" aria-describedby="sel-area-help"><small class="field-help" id="sel-area-help">Odanın net taban alanı</small></label><label class="field" for="sel-people">Kişi sayısı<input id="sel-people" type="number" inputmode="numeric" min="1" max="30" step="1" value="3"></label><label class="field" for="sel-sun">Güneş durumu<select id="sel-sun">${opt('.9','Az güneş (kuzey cephe)')}${opt('1','Normal',true)}${opt('1.2','Yoğun güneş (güney/batı, geniş cam)')}</select></label><label class="field" for="sel-ins">Yalıtım<select id="sel-ins">${opt('.9','İyi (yalıtımlı, çift cam)')}${opt('1','Orta',true)}${opt('1.2','Zayıf (yalıtımsız / eski bina)')}</select></label></div><button type="button" class="primary btn-lg" data-action="calculate-btu">Kapasiteyi hesapla</button></form><div class="selector-result" data-selector-result aria-live="polite"></div>`;
  root.querySelector('[data-selector-form]')?.addEventListener('change',()=>{if(root.querySelector('[data-selector-result]')?.classList.contains('show'))calculateBtu()})})}
function calculateBtu(){const num=(sel,def)=>{const n=Number(document.querySelector(sel)?.value);return Number.isFinite(n)&&n>0?n:def};const area=Math.min(num('#sel-area',20),500),sun=num('#sel-sun',1),ins=num('#sel-ins',1),people=Math.min(num('#sel-people',2),50),type=document.querySelector('#sel-type')?.value||'salon',city=document.querySelector('#sel-city')?.value||'';
  const raw=area*500*sun*ins+Math.max(0,people-2)*500,btu=BTU_CLASSES.find(c=>raw<=c)||null,next=btu?BTU_CLASSES[BTU_CLASSES.indexOf(btu)+1]:null,range=btu&&next&&raw>btu*.9?[btu,next]:btu?[btu]:null;
  const commercial=type==='ofis'||type==='magaza',survey=!btu||commercial||area>60||(sun>1&&ins>1)||Boolean(range&&range.length>1);
  const fmt=n=>new Intl.NumberFormat('tr-TR').format(n),cityName=regions.find(r=>r[0]===city)?.[1]||'',count=catalogAuthoritative()&&btu?getProducts().filter(p=>capacityBtuDigits(p)===String(btu)).length:0;
  const reasons=[!btu&&'hesaplanan ihtiyaç tek bir duvar tipi klimanın kapasitesini aşıyor',commercial&&'ticari kullanımda cihaz tipi ve yerleşim projeye göre belirlenir',area>60&&'geniş alanlarda çoklu cihaz veya farklı tip gerekebilir',sun>1&&ins>1&&'yoğun güneş ve zayıf yalıtım birlikte ısı yükünü belirgin artırır',range&&range.length>1&&'sonuç iki kapasite sınırına yakın'].filter(Boolean);
  const out=document.querySelector('[data-selector-result]');if(!out)return;
  const kesif=`contact.html?subject=kesif${city?`&city=${encodeURIComponent(city)}`:''}`;
  out.innerHTML=btu?`<span>Ön kapasite önerisi${cityName?` · ${esc(cityName)}`:''}</span><b>${range.map(fmt).join(' – ')} BTU/h</b><p>Yaklaşık ihtiyaç: ${fmt(Math.round(raw/100)*100)} BTU/h. Bu sonuç ön değerlendirmedir; kesin kapasite montaj yeri ve mekân koşullarına göre netleşir.</p>${survey?`<p class="selector-warning" role="note"><b>Yerinde keşif önerilir:</b> ${esc(reasons.join('; '))}.</p>`:''}<div class="selector-actions"><a class="primary inline" href="catalog.html?btu=${btu}">${count?`${count} uygun modeli gör`:'Uygun modelleri gör'}</a>${range.length>1?`<a class="ghost inline" href="catalog.html?btu=${range[1]}">${fmt(range[1])} BTU modelleri</a>`:''}<a class="ghost inline" href="${kesif}">Keşif iste</a></div>`:`<span>Ön kapasite önerisi${cityName?` · ${esc(cityName)}`:''}</span><b>24.000 BTU/h üzeri</b><p>Yaklaşık ihtiyaç: ${fmt(Math.round(raw/100)*100)} BTU/h. Bu ihtiyaç için salon tipi, kaset, yer/tavan veya çoklu cihaz çözümü gerekir.</p><p class="selector-warning" role="note"><b>Yerinde keşif önerilir:</b> ${esc(reasons.join('; '))}.</p><div class="selector-actions"><a class="primary inline" href="${kesif}">Keşif iste</a><a class="ghost inline" href="catalog.html?category=Ticari%20Klima">Ticari klimalar</a><a class="ghost inline" href="catalog.html?category=Salon%20Tipi">Salon tipi klimalar</a></div>`;
  out.classList.add('show')}
/* Homepage featured cards: the static markup only names a product by id
   (data-featured-product); every price, stock and name shown comes from the served
   catalog and is written with textContent. A product that is not in the catalog shows
   that it is not listed - never a remembered price. */
function renderFeaturedProducts(){document.querySelectorAll('[data-featured-product]').forEach(card=>{const set=(field,text)=>card.querySelectorAll(`[data-product-field="${field}"]`).forEach(el=>{el.textContent=text});
  if(catalogState==='loading'){set('price','Fiyat yükleniyor…');set('stock','');return}
  const p=catalogAuthoritative()?getProducts().find(x=>x.id===card.dataset.featuredProduct):null;
  // After the authoritative catalog loads, the homepage uses the same card renderer and actions as the catalog.
  if(card.hasAttribute?.('data-home-card')&&catalogState!=='loading'){card.classList.add('home-catalog-card');card.innerHTML=p?productCard(p):`<div class="empty">${catalogState==='unavailable'?catalogNotice():'Şu anda listelenmiyor'}</div>`;return}
  if(!p){set('price',catalogState==='unavailable'?'Fiyat bilgisi alınamadı':'Şu anda listelenmiyor');set('stock','');return}
  set('name',p.name);set('capacity',p.capacity||'—');set('sku',p.sku||'—');set('price',p.sale?money(p.price):'Fiyat için teklif alın');set('stock',p.sale?(p.stock>0?`Stok: ${p.stock}`:'Stokta yok'):'');
  card.querySelectorAll('[data-product-specs]').forEach(el=>{el.innerHTML=specChips(p)});card.querySelectorAll('[data-hero-cart]').forEach(b=>{const soldOut=!p.sale||Number(p.stock)<=0;b.disabled=soldOut;b.textContent=!p.sale?'Teklif için sorun':soldOut?'Tükendi':'Sepete ekle'})})}
/* Homepage showroom: the colour swatches switch between two real catalog products (image, id, price and stock all follow). */
function setHeroTone(tone){const btn=document.querySelector(`[data-action="hero-tone"][data-tone="${tone}"]`),card=document.querySelector('.hero-card'),img=document.querySelector('[data-hero-image]');if(!btn||!card)return;const id=btn.dataset.product;document.querySelectorAll('[data-action="hero-tone"]').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));card.dataset.featuredProduct=id;card.querySelectorAll('[data-hero-link]').forEach(a=>a.setAttribute('href','product.html?id='+encodeURIComponent(id)));card.querySelectorAll('[data-hero-cart],.hero-fav').forEach(b=>{b.dataset.id=id});card.querySelector('.hero-fav')?.setAttribute('aria-pressed',String(getFavorites().includes(id)));if(img){img.removeAttribute('srcset');img.setAttribute('src',btn.dataset.image);img.setAttribute('alt',btn.dataset.alt||'')}renderFeaturedProducts()}
/* Series and capacity discovery figures are computed from the served catalog only; before it loads they stay as dashes. */
const USE_BY_BTU=[[9000,'küçük oda'],[12000,'oda'],[18000,'salon'],[24000,'geniş salon']];
function renderHomeDiscovery(){document.querySelectorAll('.hero-fav').forEach(b=>b.setAttribute('aria-pressed',String(getFavorites().includes(b.dataset.id))));if(!catalogAuthoritative())return;const products=getProducts(),fmt=n=>new Intl.NumberFormat('tr-TR').format(n);
  document.querySelectorAll('[data-series-card]').forEach(card=>{const list=products.filter(p=>p.series===card.dataset.seriesCard&&p.category==='Duvar Tipi'),caps=[...new Set(list.map(capacityBtuDigits).filter(Boolean).map(Number))].sort((a,b)=>a-b),prices=list.filter(p=>p.sale).map(p=>Number(p.price)).filter(n=>n>0),energy=[...new Set(list.map(p=>p.energy).filter(Boolean))],set=(f,t)=>card.querySelectorAll(`[data-series-field="${f}"]`).forEach(el=>{el.textContent=t});
    set('range',caps.length?(caps.length>1?`${fmt(caps[0])}–${fmt(caps.at(-1))}`:fmt(caps[0]))+' BTU/h':'—');set('energy',energy.length?energy.join(', '):'—');set('from',prices.length?money(Math.min(...prices)):'Teklif ile');set('count',list.length?`${list.length} model`:'—');
    const uses=USE_BY_BTU.filter(([b])=>caps.includes(b)).map(([,u])=>u);set('use',uses.length?'Uygun kapasite seçenekleri: '+uses.join(', ')+'.':'')});
  document.querySelectorAll('[data-need-btu]').forEach(el=>{const n=products.filter(p=>capacityBtuDigits(p)===el.dataset.needBtu).length;el.textContent=n?`${n} model`:'Modelleri gör'});
  document.querySelectorAll('[data-cat-count]').forEach(el=>{const n=products.filter(p=>p.category===el.dataset.catCount).length;if(n)el.textContent=el.dataset.countSuffix?`${n}${el.dataset.countSuffix}`:`${n} ürün`})}
function renderFavorites(){const root=document.querySelector('[data-favorites]');if(!root)return;if(!catalogAuthoritative()){root.innerHTML=`<div class="empty">${catalogNotice()}</div>`;return}const ps=getProducts().filter(p=>getFavorites().includes(p.id));root.innerHTML=ps.length?ps.map(productCard).join(''):'<div class="empty">Henüz favori ürününüz yok. <a class="primary inline" href="catalog.html">Ürünleri inceleyin</a></div>'}
function renderCompare(){const root=document.querySelector('[data-compare]');if(!root)return;if(!catalogAuthoritative()){root.innerHTML=`<div class="empty">${catalogNotice()}</div>`;return}const ps=getProducts().filter(p=>getCompare().includes(p.id));if(!ps.length){root.innerHTML='<div class="empty">Karşılaştırma listeniz boş. <a class="primary inline" href="catalog.html">Katalogdan ürün ekleyin</a></div>';return}const cells=f=>ps.map(p=>`<span>${esc(f(p)||'—')}</span>`).join(''),label=t=>`<span class="cmp-label">${t}</span>`;root.innerHTML=`${ps.length>1?'<p class="compare-hint" id="compare-hint">Tüm ürünleri görmek için tabloyu yana kaydırın.</p>':''}<div class="compare-scroll" role="region" aria-label="Ürün karşılaştırma tablosu"${ps.length>1?' aria-describedby="compare-hint"':''} tabindex="0"><div class="compare-grid" style="--cmp-n:${ps.length}"><b class="cmp-label">Özellik</b>${ps.map(p=>`<b>${esc(p.name)}</b>`).join('')}${label('Kapasite')}${cells(p=>p.capacity)}${label('Enerji sınıfı')}${cells(p=>p.energy)}${label('Wi-Fi')}${cells(p=>p.wifi)}${label('Fiyat')}${cells(p=>p.sale?money(p.price):'Teklif ile')}${label('Durum')}${cells(p=>p.sale?(p.stock>0?'Stokta':'Tükendi'):'Teklif ile satılır')}${label('İşlem')}${ps.map(p=>`<span class="cmp-actions"><a class="ghost" href="product.html?id=${encodeURIComponent(p.id)}">İncele</a><button type="button" class="ghost" data-action="toggle-compare" data-id="${esc(p.id)}">Çıkar</button></span>`).join('')}</div></div>`;root.style.setProperty('--cols',ps.length+1)}
/* Only absolute http(s) URLs or site-root paths are used as image sources. */
function safeImageSrc(u){const s=String(u??'').trim();if(s.startsWith('/')&&!s.startsWith('//'))return s;try{const url=new URL(s);return /^https?:$/.test(url.protocol)?url.href:''}catch{return ''}}
const imageTag=(u,alt,extra='')=>{const src=safeImageSrc(u);return src?`<img src="${esc(src)}" alt="${esc(alt)}"${extra}>`:''};
/* Admin-authored post content is plain text: blank lines separate paragraphs, single
   newlines become <br>. It is escaped first, so no markup in it is ever interpreted. */
const plainTextParagraphs=t=>String(t??'').split(/\n{2,}/).map(x=>`<p>${esc(x).replace(/\n/g,'<br>')}</p>`).join('');
function renderManagedBlog(posts){const root=document.querySelector('[data-blog]');if(root){root.innerHTML=posts.map(p=>{const href=`article.html?slug=${encodeURIComponent(p.slug)}`,img=imageTag(p.imageUrl,'',' loading="lazy" decoding="async"');return `<article class="g-card">${img?`<div class="g-card-media">${img}</div>`:''}<div class="g-card-body"><span class="g-cat">Ege Teknik</span><h3><a href="${href}">${esc(p.title)}</a></h3><p>${esc(p.excerpt)}</p><div class="g-card-foot"><span class="g-card-cta" aria-hidden="true">Yazıyı oku →</span></div></div></article>`}).join('');document.querySelector('[data-managed-blog]')?.removeAttribute('hidden')}const article=document.querySelector('[data-article]'),slug=new URLSearchParams(location.search).get('slug'),post=posts.find(p=>p.slug===slug);if(article&&post){article.innerHTML=`<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><a href="blog.html">Klima Rehberi</a></nav><div class="eyebrow">Ege Teknik Klima Rehberi</div><h1>${esc(post.title)}</h1>${imageTag(post.imageUrl,post.title,' class="article-cover"')}<p class="lead">${esc(post.excerpt)}</p><div class="managed-content">${plainTextParagraphs(post.content)}</div>`;document.title=post.title+' | Ege Teknik'}}
const secondHandHref=p=>`contact.html?subject=ikinci-el&product=${encodeURIComponent(p.slug)}`;
function renderManagedSecondHand(products){const root=document.querySelector('.second-grid');if(root&&products.length)document.querySelector('[data-second-hand-empty]')?.remove();if(root&&products.length)root.innerHTML=products.map(p=>`<article class="second-card">${imageTag(p.imageUrl,p.name,' loading="lazy"')}<small>${esc(p.category)} • ${esc(p.condition)}</small><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><p><b>${money(p.price)}</b> • Stok: ${esc(p.stock)}</p><p>${esc(p.testNotes)}</p><button type="button" class="ghost" data-action="navigate" data-href="${esc(secondHandHref(p))}">Bilgi al</button></article>`).join('')}
/* Homepage outlet highlights: only real published second-hand stock, or an honest empty/unavailable state. */
function renderSecondHandHighlights(products){const root=document.querySelector('[data-home-second-hand]');if(!root)return;
  if(products===null){root.innerHTML='<p class="spot-empty">İkinci el stok bilgisi şu anda alınamıyor. Güncel durum için ikinci el sayfasını ziyaret edin.</p>';return}
  if(!products.length){root.innerHTML='<p class="spot-empty">Şu anda yayında ikinci el ürün bulunmuyor. Yeni stok geldiğinde haber almak için <a href="contact.html?subject=ikinci-el">talep bırakın</a>.</p>';return}
  root.innerHTML=products.slice(0,2).map(p=>`<article class="spot-card">${imageTag(p.imageUrl,p.name,' loading="lazy"')}<span>${esc(p.category)} • ${esc(p.condition)}</span><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><p class="price">${money(p.price)}</p><a class="btn btn-light" href="${esc(secondHandHref(p))}">Bilgi al</a></article>`).join('')}
async function loadManagedContent(){const [b,s]=await Promise.allSettled([fetch('/api/blog'),fetch('/api/second-hand')]);
  let managedPosts=[];try{if(b.status==='fulfilled'&&b.value.ok){const {posts}=await b.value.json();if(Array.isArray(posts)&&posts.length){managedPosts=posts;renderManagedBlog(posts)}}}catch{console.info('Yönetilen rehber yazıları alınamadı.')}
  {const article=document.querySelector('[data-article]'),slug=new URLSearchParams(location.search).get('slug');if(article&&slug&&!Object.prototype.hasOwnProperty.call(GUIDE_LEGACY,slug)&&!managedPosts.some(p=>p.slug===slug))articleNotFound(article)}
  let secondHand=null;try{if(s.status==='fulfilled'&&s.value.ok){const {products}=await s.value.json();secondHand=Array.isArray(products)?products:[]}}catch{secondHand=null}
  if(secondHand)renderManagedSecondHand(secondHand);renderSecondHandHighlights(secondHand)}
/* Homepage hero carousel (Paket 1E). Lightweight and dependency-free: every slide is in the static
   markup (no layout shift), only one is visible at a time. Autoplay (6.5 s) pauses on hover and while
   keyboard focus is inside, stops for good after any manual navigation, never starts when the visitor
   prefers reduced motion, and can always be paused or resumed with the pause/play button. */
const HERO_INTERVAL=6500;
function initHeroCarousel(){const root=document.querySelector('[data-hero-carousel]');if(!root||typeof root.querySelectorAll!=='function')return null;
  const slides=[...root.querySelectorAll('[data-hc-slide]')],tabs=[...root.querySelectorAll('[data-hc-tab]')],viewport=root.querySelector('[data-hc-viewport]'),pauseBtn=root.querySelector('[data-hc-pause]');if(slides.length<2)return null;
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  const st={index:0,playing:!reduced,hover:false,focus:false,timer:null,started:0,remaining:HERO_INTERVAL};
  const held=()=>st.hover||st.focus||(typeof document.hidden==='boolean'&&document.hidden);
  const restartBar=()=>{const bar=tabs[st.index]?.querySelector('.hc-bar i');if(bar?.style){bar.style.animation='none';void bar.offsetWidth;bar.style.animation=''}};
  const clear=()=>{if(st.timer){clearTimeout(st.timer);st.timer=null}};
  const schedule=()=>{clear();if(!st.playing||held())return;st.started=Date.now();st.timer=setTimeout(()=>{st.remaining=HERO_INTERVAL;go(st.index+1,false)},st.remaining)};
  const sync=()=>{const running=st.playing&&!held();root.classList.toggle('hc-playing',st.playing);root.classList.toggle('hc-paused',st.playing&&held());root.classList.toggle('hc-stopped',!st.playing);if(viewport)viewport.setAttribute('aria-live',running?'off':'polite');if(pauseBtn)pauseBtn.setAttribute('aria-label',st.playing?'Otomatik geçişi durdur':'Otomatik geçişi başlat')};
  function go(i,user){const n=slides.length,next=((i%n)+n)%n;if(user){st.playing=false;clear()}
    slides.forEach((s,k)=>{const on=k===next;s.classList.toggle('is-active',on);if(on){s.removeAttribute('aria-hidden');s.removeAttribute('inert')}else{s.setAttribute('aria-hidden','true');s.setAttribute('inert','')}});
    tabs.forEach((t,k)=>{const on=k===next;t.setAttribute('aria-selected',String(on));t.setAttribute('tabindex',on?'0':'-1')});
    st.index=next;root.dataset.theme=String(next);st.remaining=HERO_INTERVAL;restartBar();sync();schedule()}
  const hold=(key,value)=>{if(st[key]===value)return;if(value&&st.timer){st.remaining=Math.max(600,st.remaining-(Date.now()-st.started));clear()}st[key]=value;sync();if(!value)schedule()};
  root.addEventListener('click',e=>{const t=e.target.closest?.('[data-hc-tab],[data-hc-prev],[data-hc-next],[data-hc-pause]');if(!t)return;
    if(t.hasAttribute('data-hc-pause')){st.playing=!st.playing;st.remaining=HERO_INTERVAL;if(st.playing)restartBar();else clear();sync();schedule();return}
    if(t.hasAttribute('data-hc-prev'))go(st.index-1,true);else if(t.hasAttribute('data-hc-next'))go(st.index+1,true);else go(Number(t.dataset.hcTab),true)});
  root.addEventListener('keydown',e=>{if(!e.target.closest?.('[role=tablist]'))return;const k=e.key;let to=null;if(k==='ArrowRight')to=st.index+1;else if(k==='ArrowLeft')to=st.index-1;else if(k==='Home')to=0;else if(k==='End')to=slides.length-1;if(to===null)return;e.preventDefault();go(to,true);tabs[st.index]?.focus()});
  if(typeof matchMedia==='function'&&matchMedia('(hover: hover) and (pointer: fine)').matches){root.addEventListener('mouseenter',()=>hold('hover',true));root.addEventListener('mouseleave',()=>hold('hover',false))}
  root.addEventListener('focusin',()=>hold('focus',true));root.addEventListener('focusout',e=>{if(!root.contains(e.relatedTarget))hold('focus',false)});
  let sx=null,sy=0;viewport?.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;sx=e.clientX;sy=e.clientY});
  viewport?.addEventListener('pointerup',e=>{if(sx===null)return;const dx=e.clientX-sx,dy=e.clientY-sy;sx=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3)go(st.index+(dx<0?1:-1),true)});
  viewport?.addEventListener('pointercancel',()=>{sx=null});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(st.timer){st.remaining=Math.max(600,st.remaining-(Date.now()-st.started));clear()}}sync();schedule()});
  root.style?.setProperty?.('--hc-dur',HERO_INTERVAL+'ms');root.classList.add('hc-ready');go(0,false);
  return {go,state:st}}
/* P3-A2: guest order lookup. Posts the tracking number and the e-mail the order was placed with to
   POST /api/orders/lookup and shows what the server returns. Two rules shape this function:

   1. Nothing the API returns is ever turned into HTML. Every API-derived value is written with
      textContent on a created element - no innerHTML, insertAdjacentHTML, outerHTML or document.write -
      so a stored product name or address can never become markup.
   2. The API's own error text is never displayed. The page owns its messages: every 400/404/429 (which
      deliberately do not distinguish an unknown order from a wrong e-mail) renders ONE sentence, and a
      network/5xx failure renders a different, operational one. Nothing here reveals whether an order
      exists, and no proof ever enters a URL, storage or an analytics payload. */
const ORDER_LOOKUP_URL='/api/orders/lookup';
const ORDER_LOOKUP_INVALID_MESSAGE='Sipariş bilgileri doğrulanamadı. Sipariş numarası ve e-posta adresini kontrol edip tekrar deneyin.';
const ORDER_LOOKUP_UNAVAILABLE_MESSAGE='Sipariş bilgileri şu anda alınamıyor. Lütfen daha sonra tekrar deneyin.';
const ORDER_LOOKUP_IN_PROGRESS='Sipariş sorgulanıyor…';
/* Visible sub-state names: what the customer can act on. Everything else stays neutral rather than
   promising a date or a service level the site cannot evidence. */
const ORDER_STATUS_TEXT={pending_payment:'Ödeme bekleniyor',cancelled:'İptal edildi',returned:'İade edildi',completed:'Tamamlandı'};
const ORDER_DATE_FORMAT=new Intl.DateTimeFormat('tr-TR',{dateStyle:'long'});
const orderLookupDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':ORDER_DATE_FORMAT.format(date)};
const orderElement=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);if(className)element.className=className;return element};
const orderSummaryRow=(label,value)=>{const row=orderElement('div',undefined,'summary-row');row.append(orderElement('span',label),orderElement('b',value));return row};

function renderOrderLookupResult(data){
  const box=document.querySelector('[data-order-lookup-result]');if(!box)return;
  const order=data&&typeof data==='object'?data.order:null;if(!order||typeof order!=='object')return;
  const items=Array.isArray(order.items)?order.items:[],delivery=order.delivery&&typeof order.delivery==='object'?order.delivery:{},total=Number(order.total)||0;
  const panel=orderElement('section',undefined,'panel');panel.setAttribute('tabindex','-1');
  panel.append(orderElement('h2',`Sipariş ${order.orderNumber}`));
  /* The date and the status are two facts, so they are two text nodes with a separator element between
   them: the " · " is presentation text this page owns, never a value that arrived from the API, and the
   two API-derived values are never concatenated into one string. */
  const meta=orderElement('p',undefined,'tax-note');
  const dateLine=orderElement('small');
  dateLine.append(orderElement('span','Sipariş tarihi: '),orderElement('span',orderLookupDate(order.createdAt)||'—'));
  const separator=orderElement('span',' · ','order-sep');separator.setAttribute('aria-hidden','true');
  meta.append(dateLine,separator,orderElement('small',order.statusLabel||ORDER_STATUS_TEXT[order.status]||''));
  panel.append(meta);
  panel.append(orderElement('h3','Sipariş içeriği'));
  for(const item of items){
    const row=orderElement('div',undefined,'summary-row');
    row.append(orderElement('span',`${item.productName} · ${money(item.unitPrice)} × ${item.quantity} adet`),orderElement('b',money(item.lineTotal)));
    panel.append(row);
  }
  if(!items.length)panel.append(orderElement('p','Bu sipariş için ürün kaydı bulunamadı.','notice'));
  panel.append(orderElement('h3','Ödeme özeti'));
  panel.append(orderSummaryRow('Ara toplam',money(order.subtotal)),orderSummaryRow('KDV (ara toplama dahil)',money(order.vatTotal)),orderSummaryRow('Teslimat',deliveryMethodText(delivery,order)),orderSummaryRow('Ödenecek toplam (KDV dâhil)',money(total)));
  panel.append(orderElement('h3','Teslimat bilgileri'));
  const place=[delivery.address,[delivery.district,delivery.city].filter(Boolean).join(' / ')].filter(Boolean).join(', ');
  const details=orderElement('p');
  /* The delivery method is always introduced by its label. deliveryMethodText() falls back to the
     shipping amount for an order that recorded no method, and a bare "₺500" at the end of a block tells
     the customer nothing; "Teslimat: ₺500" does. No amount is computed here - the value is whatever the
     storefront's own helper already reads from the public projection. */
  const deliveryLine=orderElement('span');
  deliveryLine.append(orderElement('b','Teslimat: '),orderElement('span',deliveryMethodText(delivery,order)));
  details.append(orderElement('span',delivery.name),document.createElement('br'),orderElement('span',`${delivery.phone} · ${delivery.email}`),document.createElement('br'),orderElement('span',place),document.createElement('br'),deliveryLine);
  panel.append(details);
  box.replaceChildren(panel);
  panel.focus?.();
}

function renderOrderLookup(){
  const form=document.querySelector('[data-order-lookup]');if(!form)return;
  const status=form.querySelector('[data-form-status]');
  const say=(text,ok=false)=>{if(!status)return;status.textContent=text;status.className='form-status'+(ok?' is-ok':'');status.hidden=!text};
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!form.checkValidity?.()){form.reportValidity?.();return}
    const orderNumber=String(form.querySelector('[name=orderNumber]')?.value||'').trim(),email=String(form.querySelector('[name=email]')?.value||'').trim();
    const button=form.querySelector('button[type=submit]');
    if(button){button.disabled=true;button.textContent=ORDER_LOOKUP_IN_PROGRESS}
    say('');
    try{
      const response=await fetch(ORDER_LOOKUP_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderNumber,email})});
      // A refusal and a transport failure are told apart deliberately: only the server can say the details
      // were wrong, and blaming the customer for our own network problem would be both wrong and unhelpful.
      if(!response.ok){say(response.status>=500?ORDER_LOOKUP_UNAVAILABLE_MESSAGE:ORDER_LOOKUP_INVALID_MESSAGE);return}
      renderOrderLookupResult(await response.json().catch(()=>null));
      say('Sipariş bilgileriniz doğrulandı.',true);
    }catch{say(ORDER_LOOKUP_UNAVAILABLE_MESSAGE)}
    finally{if(button){button.disabled=false;button.textContent='Siparişimi görüntüle'}}
  });
}

document.addEventListener('DOMContentLoaded',()=>{renderHeader();renderFooter();renderHelpLauncher();renderBtuSelector();renderServiceMap();initHeroCarousel();updateCartCount();updateFavoritesCount();renderFeaturedProducts();applyCatalogQuery();renderProductPage();renderRegions();renderRegionPage();renderArticle();renderContactForm();renderFavorites();renderCompare();renderOrderLookup()});
document.addEventListener('DOMContentLoaded',()=>{void loadManagedContent()});
document.addEventListener('error',handleBrokenProductImage,true);
/* First-party analytics beacon (Phase 6A). Fire-and-forget: never blocks rendering or any other
   fetch, never throws, and a failure here is silently ignored - the storefront works identically
   with or without it. No raw IP or user-agent is ever sent or stored (see lib/analytics.ts for
   the full privacy model); the anonymous visitor id lives in a server-set, httpOnly first-party
   cookie this script never reads or writes directly. */
function sendAnalyticsEvent(){try{
  const body={path:location.pathname};
  if(document.referrer)body.referrer=document.referrer;
  if(document.querySelector('[data-product-page]')){const id=new URLSearchParams(location.search).get('id');if(id)body.productId=id}
  fetch('/api/analytics/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{})
}catch{}}
const scheduleAnalyticsEvent=typeof requestIdleCallback==='function'?requestIdleCallback:(cb=>setTimeout(cb,300));
document.addEventListener('DOMContentLoaded',()=>{scheduleAnalyticsEvent(sendAnalyticsEvent)});

document.addEventListener('change',e=>{if(e.target.matches?.('[data-catalog-filter], [name=category]')){renderCatalog();updateCatalogUrl(catalogFilters())}});
document.addEventListener('input',e=>{if(e.target.matches?.('#catalog-search'))updateCatalogUrl(catalogFilters())});
document.addEventListener('click',e=>{if(e.target.closest?.('.chip[data-btu]'))updateCatalogUrl(catalogFilters())});
if(typeof window!=='undefined')window.addEventListener('popstate',()=>applyCatalogQuery());

