/* H1.2: enhance native multi-page navigation without replacing routing or storing drafts. */
(()=>{
 'use strict';
 let status,resetTimer;
 const reset=()=>{clearTimeout(resetTimer);if(status){status.hidden=true;status.textContent=''}document.documentElement.classList.remove('store-navigating')};
 const storefront=url=>url.origin===location.origin&&!/^\/(?:admin|account|payment|api)(?:[/.]|$)/.test(url.pathname)&&(url.pathname==='/'||/^\/(?:[a-z0-9-]+|rehber\/[a-z0-9-]+)\.html$/.test(url.pathname));
 function pending(url){
  if(!storefront(url)||(url.pathname===location.pathname&&url.search===location.search))return;
  status.textContent='Sayfa açılıyor…';status.hidden=false;document.dispatchEvent(new CustomEvent('store:navigate'));document.documentElement.classList.add('store-navigating');
  clearTimeout(resetTimer);resetTimer=setTimeout(reset,15000);
 }
 document.addEventListener('DOMContentLoaded',()=>{
  status=document.createElement('div');status.className='store-navigation-status';status.role='status';status.setAttribute('aria-live','polite');status.hidden=true;document.body.appendChild(status);
  document.addEventListener('click',event=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const link=event.target.closest('a[href]');if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self')||link.relList.contains('external'))return;
   pending(new URL(link.href,location.href));
  });
  document.addEventListener('submit',event=>{
   const form=event.target;if(event.defaultPrevented||form.method!=='get'||(form.target&&form.target!=='_self'))return;
   const url=new URL(form.action,location.href);url.search=new URLSearchParams(new FormData(form)).toString();pending(url);
  });
  const entry=performance.getEntriesByType('navigation')[0];
  if(entry?.type==='navigate'&&document.referrer&&!location.hash){
   try{if(new URL(document.referrer).origin===location.origin){const main=document.querySelector('main');if(main){main.setAttribute('tabindex','-1');main.focus({preventScroll:true})}}}catch{/* Native navigation remains the fallback. */}
  }
 });
 window.addEventListener('pageshow',reset);
 // Traversal retains browser scroll/focus restoration; native transition opt-in is disabled.
 window.addEventListener('pagereveal',reset);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reset()});
})();
