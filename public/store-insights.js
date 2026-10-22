/* Optional local adapter. No network, persistent identifier, free text or purchase event. */
(()=>{'use strict';
 const seen=new Set(),observers=[];let rumStarted=false,cleanupRum=()=>{};
 const allowed=()=>window.EGE_INSIGHTS_CONFIG?.enabled===true&&document.cookie.split(';').some(c=>c.trim()==='ege_analytics_consent=1');
 const integer=v=>Number.isInteger(v)&&v>=0&&v<=100000?v:0;
 const item=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,159}$/.test(v)?v:null;
 function track(event,input={},key){
  if(!allowed()||key&&seen.has(key)||seen.size>=1000)return false;
  let params;
  if(event==='view_item'||event==='add_to_cart'){const id=item(input.itemId);if(!id)return false;params={items:[{item_id:id}]};if(event==='add_to_cart')params.items[0].quantity=integer(input.quantity)||1}
  else if(event==='catalog_search')params={result_count:integer(input.count)};
  else if(event==='catalog_filter')params={filter_count:integer(input.count)};
  else if(event==='compare_item'){const id=item(input.itemId);if(!id||!['add','remove'].includes(input.action))return false;params={item_id:id,action:input.action}}
  else if(event==='climate_selector_complete'){if(!['survey','capacity'].includes(input.outcome))return false;params={outcome:input.outcome}}
  else if(event==='generate_lead'){if(!['urun','kesif','montaj','bakim','ariza','yedek','ikinci-el','diger'].includes(input.type))return false;params={service_type:input.type}}
  else if(event==='web_vital'){if(!['LCP','CLS'].includes(input.name)||!Number.isFinite(input.value)||input.value<0)return false;params={metric_name:input.name,value:Math.round(input.value*10000)/10000}}
  else return false;
  if(key)seen.add(key);
  window.dispatchEvent(new CustomEvent('ege:analytics',{detail:{event,params}}));return true;
 }
 function stopRum(){cleanupRum();cleanupRum=()=>{};for(const o of observers)o.disconnect();observers.length=0;rumStarted=false}
 function startRum(){if(!allowed()){stopRum();return}if(rumStarted||window.EGE_INSIGHTS_CONFIG?.rum!==true||typeof PerformanceObserver!=='function')return;rumStarted=true;
  // Session-window CLS, not the sum of all shifts. INP requires a reference implementation: UNKNOWN.
  let lcp=null,cls=0,windowSum=0,windowStart=0,lastShift=0,flushed=false;
  const observe=(type,callback)=>{if(!PerformanceObserver.supportedEntryTypes?.includes(type))return false;const o=new PerformanceObserver(list=>callback(list.getEntries()));o.observe({type,buffered:true});observers.push(o);return true};
  observe('largest-contentful-paint',entries=>{for(const e of entries)lcp=e.startTime});
  const clsSupported=observe('layout-shift',entries=>{for(const e of entries){if(e.hadRecentInput)continue;if(!windowStart||e.startTime-lastShift>1000||e.startTime-windowStart>5000){windowStart=e.startTime;windowSum=0}lastShift=e.startTime;windowSum+=e.value;cls=Math.max(cls,windowSum)}});
  const flush=()=>{if(flushed||document.visibilityState!=='hidden')return;flushed=true;if(lcp!==null)track('web_vital',{name:'LCP',value:lcp});if(clsSupported)track('web_vital',{name:'CLS',value:cls});stopRum()};
  document.addEventListener('visibilitychange',flush);cleanupRum=()=>document.removeEventListener('visibilitychange',flush);
 }
 window.EgeInsights={track,startRum,stopRum};window.addEventListener('ege:consentchange',startRum);document.addEventListener('DOMContentLoaded',startRum);
})();
