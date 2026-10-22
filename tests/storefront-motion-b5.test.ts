import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeElement,loadStorefront} from './support/storefront-sandbox.ts';

test('B5: rapid cart/compare feedback keeps the latest message for a full reading interval',()=>{
 const root=fakeElement(),timers=new Map<number,{callback:()=>void;delay:number}>();let next=0;
 const store=loadStorefront({elements:{'.toast':root}});
 store.context.setTimeout=(callback:()=>void,delay:number)=>{timers.set(++next,{callback,delay});return next};
 store.context.clearTimeout=(id:number)=>timers.delete(id);
 const toast=store.fn<(message:string)=>void>('toast');
 toast('Ürün sepete eklendi');
 toast('Karşılaştırmaya eklendi');
 assert.equal(root.textContent,'Karşılaştırmaya eklendi');
 assert.equal(timers.size,1,'an earlier action must not dismiss newer feedback');
 assert.equal([...timers.values()][0].delay,4000);
});
