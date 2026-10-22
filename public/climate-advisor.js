/* Optional progressive enhancement. Deterministic B6 result is never replaced. No free chat/PII. */
(()=>{
 let generation=0;
 window.addEventListener('ege:climate-result',event=>{
  const {data,result,matches,out}=event.detail,current=++generation;
  if(result.survey||!matches.length)return;
  const section=document.createElement('section');section.className='climate-ai';section.setAttribute('aria-label','AI klima danışmanı');
  const heading=document.createElement('h3');heading.textContent='Klima danışmanı';
  const note=document.createElement('p');note.textContent='AI destekli sıralama, doğrulanmış ön değerlendirmeyle sınırlıdır. Kesin mühendislik hesabı veya profesyonel keşif değildir. Adınız ve konum metni sağlayıcıya gönderilmez.';
  const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='AI durumunu kontrol et';
  const status=document.createElement('p');status.setAttribute('role','status');
  const list=document.createElement('ul');section.append(heading,note,button,status,list);out.append(section);
  let enabled=false,busy=false;
  button.addEventListener('click',async()=>{
   if(busy)return;busy=true;button.setAttribute('aria-disabled','true');status.textContent=enabled?'Katalog seçenekleri değerlendiriliyor…':'Danışman durumu kontrol ediliyor…';section.setAttribute('aria-busy','true');
   try{
    const response=await fetch('/api/climate-advisor',{method:enabled?'POST':'GET',...(enabled?{headers:{'content-type':'application/json'},body:JSON.stringify({area:Number(data.area),people:Number(data.people),height:Number(data.height),type:data.type,sun:data.sun,insulation:data.insulation,locationKnown:!!data.city,...(Number(data.budget)>0?{budget:Number(data.budget)}:{})})}:{}),signal:AbortSignal.timeout(12000)});
    const value=await response.json();if(current!==generation||!section.isConnected)return;
    if(!enabled){enabled=response.ok&&value.enabled===true;status.textContent=enabled?'Danışman kullanılabilir. Değerlendirme isteyebilirsiniz.':'AI şu anda kapalı. Yukarıdaki deterministik ön değerlendirme çalışmaya devam eder.';button.textContent=enabled?'AI ile değerlendir':'Yeniden kontrol et';return}
    if(!response.ok||value.mode!=='assisted'||!Array.isArray(value.productIds))throw new Error('fallback');
    const allowed=new Map(matches.map(p=>[p.id,p]));if(value.productIds.some(id=>!allowed.has(id)))throw new Error('invalid');
    list.replaceChildren();for(const id of value.productIds){const li=document.createElement('li'),a=document.createElement('a');a.href='/product.html?id='+encodeURIComponent(id);a.textContent=allowed.get(id).name;li.append(a);list.append(li)}
    // Explanations are application-owned; no model prose is inserted into the DOM.
    status.textContent='Doğrulanmış kapasite ve varsa bütçe koşullarındaki katalog seçenekleri sıralandı. Eksik teknik bilgileri ürün detayında kontrol edin.';
   }catch{if(current===generation)status.textContent='Danışman yanıt veremedi. Yukarıdaki ön değerlendirme ve keşif bağlantısı kullanılabilir.'}
   finally{busy=false;button.removeAttribute('aria-disabled');section.removeAttribute('aria-busy')}
  });
 });
})();
