import test from 'node:test';
import assert from 'node:assert/strict';
import {loadStorefront} from './support/storefront-sandbox.ts';
type Result={raw:number|null;capacity:number|null;survey:boolean;error?:string};
type Product=Record<string,unknown>;
const input={area:35,people:2,height:2.6,type:'salon',sun:'normal',insulation:'normal',city:'Aydın'};
const estimate=()=>loadStorefront().fn<(v:Record<string,unknown>)=>Result>('estimateClimate');
test('B6 reference chart and occupant/sun adjustments remain explicit',()=>{
 const calc=estimate();assert.equal(calc(input).raw,9000);assert.equal(calc(input).capacity,9000);
 assert.equal(calc({...input,sun:'sunny',people:3}).raw,10500);
 assert.equal(calc({...input,area:48}).raw,14000);
});
test('B6 invalid and out-of-scope inputs never produce confident recommendations',()=>{
 const calc=estimate();for(const area of [NaN,Infinity,-1,0,201])assert.ok(calc({...input,area}).error);
 for(const change of [{height:3.5},{insulation:'unknown'},{sun:'unknown'},{type:'magaza'},{area:10},{city:''}])assert.equal(calc({...input,...change}).survey,true);
 assert.equal(calc(input).survey,false);
});
test('B6 catalogue capacity and budget never invent price or lower required capacity',()=>{
 const store=loadStorefront(),calc=store.fn<(v:Record<string,unknown>)=>Result>('estimateClimate'),match=store.fn<(p:Product[],r:Result,b:number)=>Product[]>('matchClimateProducts');
 const p={id:'real',brandId:'gree',category:'Duvar Tipi',capacity:'9000 BTU/h',price:30000,saleMode:'online'};
 assert.equal(match([p],calc(input),40000).length,1);
 assert.equal(match([p],calc(input),20000).length,0);
 assert.equal(match([{...p,saleMode:'quote'}],calc(input),40000).length,0);
 assert.equal(match([p],calc({...input,insulation:'weak'}),0).length,0);
});
