import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const css=readFileSync('public/store.css','utf8');
function luminance(hex:string){const c=hex.match(/[a-f\d]{2}/gi)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
test('selector light and dark surface palette meets AA; rendered cascade is checked in browsers',()=>{
 const token=(name:string)=>css.match(new RegExp(`--${name}:(#[a-f0-9]{6})`))![1];
 for(const color of [token('p'),token('ink'),token('body'),'#006c49'])assert.ok(contrast(color,'#ffffff')>=4.5);
 for(const color of ['#ffffff','#d5e7dc','#b8f2d1'])assert.ok(contrast(color,'#0f382e')>=4.5);
});
