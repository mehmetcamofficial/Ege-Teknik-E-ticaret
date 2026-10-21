import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {apiProduct,fakeElement,loadStorefront} from './support/storefront-sandbox.ts';
async function setup(overrides:Record<string,unknown>={},cart:unknown[]=[]){
 const box={...fakeElement(),checked:true,disabled:false,dataset:{legalVersion:'synthetic-legal'}};
 const store=loadStorefront({api:{products:[apiProduct({id:'cart-synthetic',...overrides})]},storage:{'ege-cart':cart},elements:{'[data-legal-version]':[box]}});
 let opened=0;
 (store.context.window as Record<string,unknown>).EgeCartDrawer={open:()=>opened++,refresh:()=>{},feedback:()=>{}};
 await store.fn<()=>Promise<void>>('loadCatalog')();
 return{store,box,opened:()=>opened,add:store.fn<(id:string,qty?:number)=>boolean>('addCart'),change:store.fn<(id:string,qty:unknown)=>boolean>('changeCartQuantity')};
}
test('cart add persists only identity/quantity, updates actual quantity, invalidates legal acceptance then opens drawer',async()=>{
 const {store,add,opened,box}=await setup();assert.equal(add('cart-synthetic',2),true);assert.equal(opened(),1);
 assert.deepEqual(JSON.parse(String((store.context.localStorage as Storage).getItem('ege-cart'))),[{productId:'cart-synthetic',quantity:2}]);
 assert.equal(box.checked,false);assert.equal(box.disabled,true);
});
for(const [name,fields] of [['sold out',{stock:0}],['unknown stock',{stock:undefined}],['quote only',{saleMode:'quote'}],['invalid price',{price:NaN}],['absent price',{price:undefined}]] as const){
 test(`failed add does not open or persist: ${name}`,async()=>{const{add,opened,store}=await setup(fields);assert.equal(add('cart-synthetic'),false);assert.equal(opened(),0);assert.equal((store.context.localStorage as Storage).getItem('ege-cart'),'[]')});
}
test('unlisted variant id is rejected; a real id with missing optional SKU is preserved',async()=>{
 const {add,opened}=await setup({sku:''});assert.equal(add('fabricated-white-variant'),false);assert.equal(opened(),0);assert.equal(add('cart-synthetic'),true);assert.equal(opened(),1);
});
test('quantity changes reject overstock, fractional, zero and negative requests without mutating',async()=>{
 const {add,change,store}=await setup({stock:3});add('cart-synthetic');
 for(const q of [4,1.5,0,-1,NaN])assert.equal(change('cart-synthetic',q),false);
 assert.equal(change('cart-synthetic',3),true);assert.equal(change('cart-synthetic',2),true);
 assert.deepEqual(JSON.parse(String((store.context.localStorage as Storage).getItem('ege-cart'))),[{productId:'cart-synthetic',quantity:2}]);
});
test('multiple adds respect remaining stock and never announce/open on failed extra add',async()=>{
 const {add,opened}=await setup({stock:3});assert.equal(add('cart-synthetic',2),true);assert.equal(add('cart-synthetic',2),true);assert.equal(opened(),2);assert.equal(add('cart-synthetic'),false);assert.equal(opened(),2);
});
test('storage failure produces no drawer success and leaves previous legal acceptance unchanged',async()=>{
 const {add,opened,store,box}=await setup();box.checked=true;box.disabled=false;
 (store.context.localStorage as Storage).setItem=()=>{throw new Error('Synthetic denied storage')};
 assert.equal(add('cart-synthetic'),false);assert.equal(opened(),0);assert.equal(box.checked,true);
});
test('catalog price wins over stale/forged price fields in persisted cart',async()=>{
 const {store}=await setup({price:98765},[{productId:'cart-synthetic',quantity:2,price:1}]);
 const total=store.fn<(lines:unknown)=>number>('cartTotal')(store.fn<(entries:unknown,products:unknown)=>unknown>('cartLines')([{productId:'cart-synthetic',quantity:2}],vm.runInContext('getProducts()',store.context)));assert.equal(total,197530);
});
