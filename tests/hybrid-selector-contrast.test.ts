import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const css=readFileSync('public/store.css','utf8');
function luminance(hex:string){const c=hex.match(/[a-f\d]{2}/gi)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
test('H1.1 selector light-surface text and primary/secondary actions meet AA tokens',()=>{
 const token=(name:string)=>css.match(new RegExp(`--${name}:(#[a-f0-9]{6})`))![1];
 for(const color of [token('p'),token('ink'),token('body')])assert.ok(contrast(color,'#ffffff')>=4.5);
 assert.match(css,/\.selector-card \.selector-actions \.ghost,\[data-climate-result\] \.ghost\{background:#fff;color:var\(--p\)!important/);
 assert.match(css,/\.selector-card \.selector-actions \.primary\{background:var\(--p\);color:#fff!important/);
});
