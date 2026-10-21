(()=>{
  'use strict';
  const CONSENT_COOKIE='ege_analytics_consent';
  const CONSENT_MAX_AGE=365*24*60*60;
  const cookieValue=()=>document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(CONSENT_COOKIE+'='))?.split('=')[1]||'';
  const analyticsAllowed=()=>cookieValue()==='1';
  const setConsentCookie=value=>{document.cookie=`${CONSENT_COOKIE}=${value?'1':'0'}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`};
  const revokeAnalyticsId=()=>fetch('/api/analytics/event',{method:'DELETE',keepalive:true}).catch(()=>{});
  const recordCurrentPageAfterOptIn=()=>{try{if(typeof window.sendAnalyticsEvent==='function')window.sendAnalyticsEvent()}catch{}};

  function removeUi(){document.querySelector('[data-cookie-banner]')?.remove();document.querySelector('[data-cookie-modal]')?.remove()}
  function ensureSettingsButton(){if(document.querySelector('[data-cookie-settings]'))return;const b=document.createElement('button');b.type='button';b.className='cookie-settings-trigger';b.dataset.cookieSettings='';b.textContent='Çerez Tercihleri';document.body.appendChild(b)}
  function openPreferences(){
    document.querySelector('[data-cookie-modal]')?.remove();
    const wrap=document.createElement('div');wrap.className='cookie-modal-backdrop';wrap.dataset.cookieModal='';
    wrap.innerHTML=`<section class="cookie-modal" role="dialog" aria-modal="true" aria-labelledby="cookie-modal-title"><div class="cookie-modal-head"><div><small>Gizlilik tercihi</small><h2 id="cookie-modal-title">Çerez Tercihleri</h2></div><button type="button" class="cookie-close" data-cookie-close aria-label="Kapat">×</button></div><p>Gerekli teknolojiler siteyi çalıştırmak için kullanılır. Ziyaretçi analitiği ise yalnız siz izin verirseniz etkinleşir.</p><div class="cookie-choice-row"><div><b>Gerekli</b><span>Sepet, güvenlik ve tercih kaydı gibi temel işlevler.</span></div><input type="checkbox" checked disabled aria-label="Gerekli teknolojiler açık"></div><label class="cookie-choice-row"><div><b>Ziyaretçi analitiği</b><span>Ziyaretçi, sayfa, ürün görüntüleme, cihaz türü ve yönlendiren kaynak istatistikleri.</span></div><input type="checkbox" data-cookie-analytics ${analyticsAllowed()?'checked':''}></label><div class="cookie-modal-actions"><button type="button" class="cookie-btn secondary" data-cookie-save>Tercihleri Kaydet</button><a href="policies.html#privacy" class="cookie-link">Çerez ve gizlilik bilgileri</a></div></section>`;
    document.body.appendChild(wrap);wrap.querySelector('[data-cookie-analytics]')?.focus();
  }
  function showBanner(){
    if(cookieValue()==='1'||cookieValue()==='0'||document.querySelector('[data-cookie-banner]'))return;
    const box=document.createElement('section');box.className='cookie-banner';box.dataset.cookieBanner='';box.setAttribute('aria-label','Çerez tercihleri');
    box.innerHTML=`<div class="cookie-banner-copy"><b>Gizlilik tercihlerinizi siz belirlersiniz</b><p>Gerekli teknolojiler siteyi çalıştırır. Ziyaretçi analitiği yalnız izin verirseniz kullanılır.</p><a href="policies.html#privacy">Ayrıntılı bilgi</a></div><div class="cookie-banner-actions"><button type="button" class="cookie-btn secondary" data-cookie-reject>Yalnızca gerekli</button><button type="button" class="cookie-btn secondary" data-cookie-preferences>Tercihler</button><button type="button" class="cookie-btn primary" data-cookie-accept>Tümünü kabul et</button></div>`;
    document.body.appendChild(box);
  }
  function saveChoice(allow){
    const previouslyAllowed=analyticsAllowed();
    setConsentCookie(allow);removeUi();ensureSettingsButton();
    if(!allow)void revokeAnalyticsId();
    else if(!previouslyAllowed)recordCurrentPageAfterOptIn();
  }

  const COPY_REPLACEMENTS=[
    ['İkinci El & Revizyonlu Ürünler','Spot Ürünler'],
    ['İkinci El & Outlet','Spot Ürünler'],
    ['EGE TEKNİK OUTLET & YENİLENMİŞ DEPARTMANI','EGE TEKNİK SPOT ÜRÜNLER'],
    ['Tüm Revizyonlu Klimaları ve İkinci El Kataloğunu Gör','Tüm Spot Ürünleri Gör'],
    ['İkinci El Ekspertiz','Spot Ürün Ekspertizi'],
    ['İkinci El Klima Alırken Nelere Dikkat Edilmeli?','Spot Klima Alırken Nelere Dikkat Edilmeli?'],
    ['İkinci El Klima Alınır mı?','Spot Klima Alınır mı?'],
    ['İkinci el stok bilgisi','Spot Ürün stok bilgisi'],
    ['ikinci el stok bilgisi','Spot Ürün stok bilgisi'],
    ['kontrol edilmiş ikinci el ürünler','kontrol edilmiş Spot Ürünler'],
    ['tekil stoklu ikinci el ürünler','tekil stoklu Spot Ürünler'],
    ['yayında ikinci el ürün bulunmuyor','yayında Spot Ürün bulunmuyor'],
    ['Güncel durum için ikinci el sayfasını','Güncel durum için Spot Ürünler sayfasını'],
    ['2. El İnverter Klimalar','Spot İnverter Klimalar'],
    ['Revizyonlu Beyaz Eşya','Spot Beyaz Eşya'],
    ['✓ Yetkili servis yönlendirmesi','✓ Gerektiğinde uygun servis yönlendirmesi'],
    ['Ege Teknik veya ilgili GREE servis organizasyonu ürünü adresinize getirir; ayrıca teslimat ücreti alınmaz.','Ege Teknik hizmet bölgesinde adrese teslim sağlanır; doğrudan hizmet verilemeyen durumlarda uygun servis yönlendirmesi yapılabilir.'],
    ['Yetkili servis yönlendirmesi ile standart montaj yapılır.','Standart montaj geçerli ürün koşullarına göre uygulanır; gerektiğinde uygun servis yönlendirmesi yapılabilir.']
  ];
  let normalizing=false;
  function normalizeStorefrontCopy(){
    if(normalizing||!document.body)return;
    normalizing=true;
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      let next=node.nodeValue||'';
      for(const [from,to] of COPY_REPLACEMENTS)if(next.includes(from))next=next.replaceAll(from,to);
      if(next!==node.nodeValue)node.nodeValue=next;
    }
    if(document.title.includes('İkinci El Outlet'))document.title=document.title.replace('İkinci El Outlet','Spot Ürünler');
    if(document.title.includes('İkinci El Klima ve Outlet'))document.title=document.title.replace('İkinci El Klima ve Outlet','Spot Ürünler');
    normalizing=false;
  }
  function watchStorefrontCopy(){
    let queued=false;
    const queue=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;normalizeStorefrontCopy()})};
    const observer=new MutationObserver(queue);
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    normalizeStorefrontCopy();
  }

  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-cookie-accept],[data-cookie-reject],[data-cookie-preferences],[data-cookie-save],[data-cookie-close],[data-cookie-settings]');if(!t)return;
    if(t.matches('[data-cookie-accept]'))saveChoice(true);
    else if(t.matches('[data-cookie-reject]'))saveChoice(false);
    else if(t.matches('[data-cookie-preferences],[data-cookie-settings]'))openPreferences();
    else if(t.matches('[data-cookie-save]'))saveChoice(Boolean(document.querySelector('[data-cookie-analytics]')?.checked));
    else if(t.matches('[data-cookie-close]'))document.querySelector('[data-cookie-modal]')?.remove();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('[data-cookie-modal]')?.remove()});
  document.addEventListener('DOMContentLoaded',()=>{showBanner();ensureSettingsButton();setTimeout(watchStorefrontCopy,0)});

  /* Load the existing storefront synchronously so its DOMContentLoaded listeners remain intact. */
  document.write('<script src="/store-core.js"></'+'script>');
})();
