/** H1.2 transition evidence: fast-network (no held request) frame sampling, paused keyframes and video. Writes are blocked. */
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile,mkdir,readdir,rename}from'node:fs/promises';import path from'node:path';
const require=createRequire(path.join(process.env.EGE_BROWSER_TOOLS,'package.json'));const{chromium,firefox,webkit}=require('playwright');
const origin=new URL(process.env.EGE_H12_ORIGIN||'https://127.0.0.1:44392').origin,out=process.env.EGE_H12_OUTPUT||'.scratch/h12/transitions';await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile('.scratch/h12/inputs/catalog.json')),detail=JSON.parse(await readFile('.scratch/h12/inputs/airy-detail.json'));
const results={origin,sha:process.env.EGE_H12_SHA,runs:[]};
const sample=()=>{window.__frames=[];const loop=()=>{const m=document.querySelector('main');if(m){const s=getComputedStyle(m);window.__frames.push({t:Math.round(performance.now()),o:+(+s.opacity).toFixed(3),y:s.transform==='none'?0:+new DOMMatrix(s.transform).m42.toFixed(2)})}if(window.__frames.length<90)requestAnimationFrame(loop)};requestAnimationFrame(loop)};
for(const[engine,type]of[['chrome',chromium],['firefox',firefox],['webkit',webkit]].filter(([n])=>!process.env.EGE_H12_ENGINES||process.env.EGE_H12_ENGINES.split(',').includes(n))){
 const b=await type.launch({headless:true,...(engine==='chrome'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 for(const[label,width,height,reduced]of[['desktop',1440,900,'no-preference'],['mobile',390,844,'no-preference'],['mobile-reduced',390,844,'reduce']]){
  const dir=`${out}/${engine}-${label}`;await mkdir(dir,{recursive:true});
  const c=await b.newContext({viewport:{width,height},ignoreHTTPSErrors:true,reducedMotion:reduced,recordVideo:{dir,size:{width:Math.min(width,780),height:Math.round(Math.min(width,780)*height/width)}}});
  await c.addInitScript(sample);
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method()))return r.fulfill({status:204});if(u.pathname.startsWith('/api/')){if(u.pathname==='/api/products')return r.fulfill({json:fixture});if(u.pathname.startsWith('/api/products/'))return r.fulfill({json:detail});if(u.pathname==='/api/legal/required')return r.fulfill({json:{documents:[]}});if(u.pathname.includes('/reviews'))return r.fulfill({json:{reviews:[],summary:{count:0,average:null}}});return r.fulfill({json:{events:[],business:{serviceProvinces:['Aydın'],locations:{Aydın:['Kuşadası']}}}})}return r.continue()});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const run={engine,label,reduced,steps:[]};
  await p.goto(origin,{waitUntil:'networkidle'});if(await p.locator('[data-cookie-reject]').count())await p.locator('[data-cookie-reject]').click();
  const pause=p.locator('[data-hc-pause]');if(await pause.getAttribute('aria-label')==='Otomatik geçişi durdur')await pause.click();
  async function step(name,action,urlGlob){
   await action();await p.waitForURL(urlGlob);await p.waitForFunction(()=>window.__frames.length>=2);
   // Exit frame is sampled on the old page only if the click handler ran before unload; entry frames are always sampled.
   await p.waitForTimeout(700);const frames=await p.evaluate(()=>window.__frames);
   const early=frames.filter(f=>f.t<400),minO=Math.min(...early.map(f=>f.o)),maxY=Math.max(...early.map(f=>Math.abs(f.y)));
      // Deterministic keyframes: pause the real entry animation at 0 / 50 / 100 % and capture.
   const shots=[];if(!reduced.startsWith('reduce')){for(const[tag,ms]of[['start',0],['mid',140],['end',280]]){await p.evaluate(ms=>{const m=document.querySelector('main');if(!m.getAnimations().length)m.animate([{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],280);for(const a of document.querySelector('main').getAnimations()){a.pause();a.currentTime=ms}},ms);const f=`${dir}/${name}-${tag}.png`;await p.screenshot({path:f});shots.push(f)}
    await p.evaluate(()=>document.querySelector('main').getAnimations().forEach(a=>a.finish()))}
   run.steps.push({name,minOpacity:minO,maxTranslateY:maxY,frames:early.length,shots,url:new URL(p.url()).pathname});
   if(!reduced.startsWith('reduce'))assert.ok(minO<0.5,`${engine} ${label} ${name}: entry must visibly start transparent (min ${minO})`);else assert.equal(minO,1,`${engine} ${label} ${name} reduced`);
  }
  await step('home-to-catalog',()=>{if(width<1024)return p.locator('.store-nav>.menu-toggle').click().then(()=>p.locator('.nav-links a[href="catalog.html"]').first().click());return p.locator('.nav-links a[href="catalog.html"]').first().click()},'**/catalog.html');
  await p.waitForFunction(()=>document.querySelector('.product h3 a'));
  await step('catalog-to-product',()=>p.locator('.product h3 a[href*="airy-12000-btu-h-siyah-81"]').first().click(),'**/product.html?*');
  await p.locator('[data-action=add-product-cart]:not([disabled])').first().waitFor();await p.locator('[data-action=add-product-cart]').first().click();await p.locator('[data-drawer-checkout]:visible').waitFor();
  await step('product-to-checkout',()=>p.locator('[data-drawer-checkout]').click(),'**/checkout.html');
  const scrollY0=await p.goto(origin+'/catalog.html?q=Airy&stock=in').then(()=>p.waitForFunction(()=>document.querySelector('#catalog-search')?.value==='Airy')).then(()=>p.evaluate(()=>{scrollTo(0,500);return scrollY}));
  await p.locator('.brand').first().evaluate(e=>e.click());await p.waitForURL(origin+'/');await p.goBack();await p.waitForFunction(()=>document.querySelector('#catalog-search')?.value==='Airy');await p.waitForTimeout(500);const back=await p.evaluate(()=>scrollY);
  run.scrollRestore={before:scrollY0,after:back};assert.ok(Math.abs(back-scrollY0)<12,`${engine} ${label} scroll restore ${back} vs ${scrollY0}`);
  await p.goForward();await p.waitForURL(origin+'/');
  assert.deepEqual(errors,[]);results.runs.push(run);await c.close();
  const vids=(await readdir(dir)).filter(f=>f.endsWith('.webm'));if(vids[0])await rename(`${dir}/${vids[0]}`,`${dir}/journey.webm`);
  console.log('CAPTURED',engine,label,run.steps.map(s=>`${s.name}:${s.minOpacity}`).join(' '));
 }
 await b.close();
}
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log('TRANSITION CAPTURE PASS');
