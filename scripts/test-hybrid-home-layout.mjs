/** Final H1 layout gate; local TLS and captured public catalog, no remote database writes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
assert.ok(process.env.EGE_BROWSER_TOOLS);
const require=createRequire(path.join(path.resolve(process.env.EGE_BROWSER_TOOLS),'package.json'));
const {chromium,firefox,webkit}=require('playwright');
const AxeBuilder=require('@axe-core/playwright').default;
const origin=process.env.EGE_H1_ORIGIN||'https://127.0.0.1:44387';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const input=process.env.EGE_H1_INPUT||'.scratch/h1/inputs';
const out=process.env.EGE_H1_OUTPUT||'.scratch/h1';await mkdir(out,{recursive:true});
const catalog=JSON.parse(await readFile(`${input}/catalog.json`,'utf8'));
const results=[];
for(const [engine,type] of [['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
 const browser=await type.launch({headless:true,...(engine==='chrome'?{executablePath:process.env.EGE_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{
  for(const width of [320,375,768,1024,1440]){
   const ctx=await browser.newContext({viewport:{width,height:960},ignoreHTTPSErrors:new URL(origin).protocol==='https:',reducedMotion:'reduce'});
   ctx.setDefaultTimeout(15000);
   await ctx.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/products'?catalog:{products:[],posts:[],documents:[]}}));
   const page=await ctx.newPage();await page.goto(origin,{waitUntil:'networkidle'});
   await page.locator('[data-cookie-reject]').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await page.keyboard.press('Tab');
   for(const control of await page.locator('.hc-controls button,.swatches button').all()){
    const size=await control.boundingBox();assert.ok(size.width>=24&&size.height>=44);
    await control.focus();assert.notEqual(await control.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
   }
   await page.locator('#hc-tab-1').focus();await page.keyboard.press('ArrowRight');
   assert.equal(await page.locator('#hc-tab-2').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
   assert.deepEqual(audit.violations.map(v=>v.id),[]);
   results.push({engine,width,status:'PASS',axeViolations:0,overflow:false,controls:'PASS',keyboardFocus:'PASS'});
   console.log('PASS final layout',engine,width);await ctx.close();
   await writeFile(`${out}/final-layout.json`,JSON.stringify(results,null,2));
  }
 }finally{await browser.close()}
}
