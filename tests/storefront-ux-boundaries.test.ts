import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
const ux=readFileSync('public/store-ux.js','utf8'),css=readFileSync('public/store.css','utf8'),bootstrap=readFileSync('public/store.js','utf8');
test('drawer uses existing domain, escaped catalog fields and native modal semantics',()=>{
 assert.match(bootstrap,/src="\/store-ux\.js"/);assert.match(ux,/dialog\.showModal\(\)/);assert.match(ux,/aria-labelledby','cart-drawer-title/);
 assert.match(ux,/changeCartQuantity\(/);assert.match(ux,/cartLines\(getCart\(\),getProducts\(\)\)/);assert.match(ux,/esc\(p\.name\)/);
 assert.doesNotMatch(ux,/localStorage|sessionStorage|fetch\(/,'no duplicate persistence or independent catalog');
});
test('static page entry never blocks navigation or persists sensitive form drafts',()=>{
 assert.doesNotMatch(ux,/beforeunload|startViewTransition|pushState|replaceState|sessionStorage|localStorage/);
 assert.match(ux,/pageshow/);assert.match(css,/@media\(prefers-reduced-motion:no-preference\)\{\.store main\{animation:store-page-enter/);
 assert.match(css,/\.cart-drawer\[open\]\{animation:none\}/);assert.match(ux,/aria-busy/);
});
