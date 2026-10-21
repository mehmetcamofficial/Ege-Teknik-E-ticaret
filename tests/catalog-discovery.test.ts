import assert from 'node:assert/strict';
import test from 'node:test';
import {loadStorefront} from './support/storefront-sandbox.ts';

type Item={id:string; name:string; category:string; series:string; capacity:string; energy:string; wifi:string; sale:boolean; stock:number; price:number; createdAt?:string};
const items:Item[]=[
 {id:'a',name:'Airy 12000',category:'Duvar Tipi',series:'Airy',capacity:'12000 BTU/h',energy:'A+++',wifi:'Var',sale:true,stock:2,price:40,createdAt:'2026-01-01'},
 {id:'b',name:'Airy 9000',category:'Duvar Tipi',series:'Airy',capacity:'9000 BTU/h',energy:'A++',wifi:'Var',sale:true,stock:0,price:20,createdAt:'2026-02-01'},
 {id:'c',name:'Ticari',category:'Ticari Klima',series:'Ticari',capacity:'24000 BTU/h',energy:'',wifi:'',sale:false,stock:1,price:0},
];
const filter=()=>loadStorefront().fn<(products:Item[],filters:Record<string,string>)=>Item[]>('selectCatalogProducts');
test('combined filters use real values and normalize BTU without confusing absent fields',()=>{
 assert.deepEqual(Array.from(filter()(items,{series:'Airy',energy:'A+++',btu:'12.000',wifi:'Var',stock:'available'}),p=>p.id),['a']);
 assert.equal(filter()(items,{energy:'A++++'}).length,0);
});
test('price bounds exclude quote-only items; price sorting leaves quote-only last',()=>{
 assert.deepEqual(Array.from(filter()(items,{min:'10',max:'30'}),p=>p.id),['b']);
 assert.deepEqual(Array.from(filter()(items,{sort:'price-asc'}),p=>p.id),['b','a','c']);
 assert.deepEqual(Array.from(filter()(items,{sort:'price-desc'}),p=>p.id),['a','b','c']);
});
test('newest uses dates and filter/sort never mutates the source catalog',()=>{
 assert.deepEqual(Array.from(filter()(items,{sort:'newest'}),p=>p.id),['b','a','c']);
 assert.deepEqual(items.map(p=>p.id),['a','b','c']);
});
test('clear criteria restore the catalog and Turkish search is case insensitive',()=>{
 assert.equal(filter()(items,{}).length,3);
 assert.deepEqual(Array.from(filter()(items,{q:'TİCARİ'}),p=>p.id),['c']);
});
