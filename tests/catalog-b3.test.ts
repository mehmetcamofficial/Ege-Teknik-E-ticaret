import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {apiProduct,fakeElement,loadStorefront} from './support/storefront-sandbox.ts';
const items=[
 {id:'a',name:'GREE Airy 12000',sku:'GWH12AV',brandId:'gree',series:'Airy',category:'Duvar Tipi',capacity:'12000 BTU/h',energy:'A+++',wifi:'Dahili',sale:true,stock:3,price:50,createdAt:'2026-02-01'},
 {id:'b',name:'GREE Pular 9000',sku:'GWH09',brandId:'gree',series:'Pular',category:'Duvar Tipi',capacity:'9000 BTU/h',energy:'',wifi:'',sale:true,stock:0,price:30,createdAt:'2026-01-01'},
 {id:'q',name:'Multi İç Ünite',sku:'MULTI',brandId:'gree',series:'Multi',category:'Multi Sistem',capacity:'12000 BTU/h',energy:'',wifi:'',sale:false,stock:9,price:0,createdAt:null},
];
const selector=()=>loadStorefront().fn<(products:typeof items,filters:Record<string,string>)=>typeof items>('selectCatalogProducts');
test('B3: multi-token Turkish/accent/model/technical search combines with every filter',()=>{
 const fn=selector();
 assert.deepEqual(Array.from(fn(items,{q:'12.000 airy dahili',brand:'gree',btu:'12000',energy:'A+++',stock:'available',min:'40',max:'60'}),p=>p.id),['a']);
 assert.deepEqual(Array.from(fn(items,{q:'GWH12AV'}),p=>p.id),['a']);
 assert.deepEqual(Array.from(fn(items,{q:'ic unite'}),p=>p.id),['q']);
 assert.deepEqual(Array.from(fn(items,{q:'airy 9000'}),p=>p.id),[]);
 assert.deepEqual(Array.from(fn(items,{brand:'unknown'}),p=>p.id),[]);
 assert.deepEqual(Array.from(fn(items,{energy:'A++++'}),p=>p.id),[]);
});
test('B3: absent energy/specs never become facts and quote inventory is not online availability',()=>{
 const fn=selector();assert.deepEqual(Array.from(fn(items,{stock:'available'}),p=>p.id),['a']);
 assert.deepEqual(Array.from(fn(items,{stock:'unavailable'}),p=>p.id),['b']);
 assert.deepEqual(Array.from(fn(items,{q:'R290'}),p=>p.id),[]);
 assert.equal(fn(items,{min:'0',max:'0'}).length,0);
});
test('B3: inclusive price validation and deterministic name/date/price ordering are immutable',()=>{
 const fn=selector();
 const invalid: Record<string,string>[]=[{min:'60',max:'10'},{min:'-1'},{max:'NaN'},{min:'Infinity'}];
 for(const filters of invalid)assert.equal(fn(items,filters).length,0);
 assert.deepEqual(Array.from(fn(items,{min:'50',max:'50'}),p=>p.id),['a']);
 assert.deepEqual(Array.from(fn(items,{sort:'name-desc'}),p=>p.id),['q','b','a']);
 assert.deepEqual(Array.from(fn(items,{sort:'price-asc'}),p=>p.id),['b','a','q']);
 assert.deepEqual(Array.from(fn(items,{sort:'newest'}),p=>p.id),['a','b','q']);
 assert.deepEqual(items.map(p=>p.id),['a','b','q']);
});
test('B3: conservative suggestions use existing eligible series and do not silently relax filters',()=>{
 const suggest=loadStorefront().fn<(products:typeof items,filters:Record<string,string>)=>string[]>('catalogSearchSuggestions');
 assert.deepEqual(Array.from(suggest(items,{q:'Ariy'})),['Airy']);
 assert.deepEqual(Array.from(suggest(items,{q:'Ariy',btu:'9000'})),[]);
 assert.deepEqual(Array.from(suggest(items,{q:'invented'})),[]);
});
test('B3: URL changes push one shareable state, preserve unrelated parameters and skip duplicates',()=>{
 const store=loadStorefront({path:'catalog.html',search:'?utm_source=test'});
 const update=store.fn<(filters:Record<string,string>)=>void>('updateCatalogUrl');
 update({q:'Airy 12.000',brand:'gree',category:'Duvar Tipi',btu:'12000',sort:'price-asc'});
 assert.equal(store.historyCalls.length,1);assert.equal(store.historyCalls[0].method,'push');
 const url=new URL(store.historyCalls[0].url,'https://shop.test');
 assert.equal(url.searchParams.get('q'),'Airy 12.000');assert.equal(url.searchParams.get('utm_source'),'test');
 update({q:'Airy 12.000',brand:'gree',category:'Duvar Tipi',btu:'12000',sort:'price-asc'});assert.equal(store.historyCalls.length,1);
 update({});assert.equal(store.historyCalls[1].url,'/catalog.html?utm_source=test');
});
test('B3: burst typing renders once after debounce without additional product requests',async()=>{
 const input={...fakeElement(),value:'Airy'},grid=fakeElement();
 const store=loadStorefront({path:'catalog.html',elements:{'#catalog-search':input,'[data-products]':grid},api:{products:[apiProduct({name:'Airy',series:'Airy'})]}});
 await store.fn<()=>Promise<void>>('loadCatalog')();
 const queue=store.fn<()=>void>('queueCatalogSearch');queue();input.value='Airy 12';queue();input.value='Airy 12000';queue();
 assert.equal(store.historyCalls.length,0);await new Promise(resolve=>setTimeout(resolve,240));
 assert.equal(store.historyCalls.length,1);assert.equal(store.fetchCalls.filter(url=>url==='/api/products').length,1);
});
test('B3: catalog cards expose missing energy explicitly while the shared renderer preserves its contract',()=>{
 const render=loadStorefront().fn<(p:unknown,options?:unknown)=>string>('productCard');
 const p=apiProduct({energyClass:''});
 assert.doesNotMatch(render(p),/Enerji sınıfı paylaşılmamış/);
 assert.match(render(p,{showMissingFields:true}),/Enerji sınıfı paylaşılmamış/);
});
test('B3: catalog remains a client of the existing read-only API with no remote search endpoint',()=>{
 const core=readFileSync('public/store-core.js','utf8');
 assert.doesNotMatch(core,/fetch\([^)]*\/api\/(search|suggest)/);
 assert.match(core,/setTimeout\(commitCatalogFilters,180\)/);
 assert.match(core,/data-filter-inert/);
});

test('B3: replaying shared URLs restores query, filter and sorting controls without refetching',async()=>{
 const input=fakeElement(),series={...fakeElement(),dataset:{catalogFilter:'series'}},sort={...fakeElement(),dataset:{catalogFilter:'sort'}},grid=fakeElement();
 const store=loadStorefront({path:'catalog.html',elements:{'#catalog-search':input,'[data-catalog-filter="series"]':series,'[data-catalog-filter="sort"]':sort,'[data-products]':grid},api:{products:[apiProduct({name:'Airy',series:'Airy'}),apiProduct({id:'pular',name:'Pular',series:'Pular'})]}});
 await store.fn<()=>Promise<void>>('loadCatalog')();
 const replay=store.fn<()=>void>('applyCatalogQuery');
 store.location.search='?q=Airy&series=Airy&sort=price-desc';replay();assert.equal(input.value,'Airy');assert.equal(series.value,'Airy');assert.equal(sort.value,'price-desc');assert.match(grid.innerHTML,/Airy/);assert.doesNotMatch(grid.innerHTML,/Pular/);
 store.location.search='';replay();assert.equal(input.value,'');assert.equal(series.value,'');assert.equal(sort.value,'');assert.match(grid.innerHTML,/Pular/);
 assert.equal(store.historyCalls.length,0,'history replay must not push another entry');assert.equal(store.fetchCalls.filter(p=>p==='/api/products').length,1);
});
test('B3: mobile filter modal restores background state and returns focus, preserving existing inert state',()=>{
 const attrs=new Map<string,string>();let closeFocus=0,triggerFocus=0,opened=false;
 const panel={...fakeElement(),setAttribute:(k:string,v:string)=>attrs.set(k,v),removeAttribute:(k:string)=>attrs.delete(k),classList:{...fakeElement().classList,toggle:(_name?:string,on?:boolean)=>{opened=Boolean(on)}},querySelector:()=>({focus:()=>closeFocus++})};
 const background={...fakeElement(),inert:false,setAttribute:()=>{},removeAttribute:()=>{}},alreadyInert={...fakeElement(),inert:true};
 const trigger={...fakeElement(),setAttribute:()=>{},focus:()=>triggerFocus++};
 const store=loadStorefront({elements:{'.catalog-filters':panel,'body > :not(main):not(script), main > :not(.shop-grid), .catalog-results':[background,alreadyInert],'[data-filter-inert]':[background],'[data-action="toggle-filters"]':trigger}});
 const toggle=store.fn<(open:boolean)=>void>('setFiltersOpen');toggle(true);assert.equal(opened,true);assert.equal(attrs.get('aria-modal'),'true');assert.equal(background.inert,true);assert.equal(closeFocus,1);
 toggle(false);assert.equal(opened,false);assert.equal(attrs.has('aria-modal'),false);assert.equal(background.inert,false);assert.equal(alreadyInert.inert,true);assert.equal(triggerFocus,1);
});
test('B3: energy/newness availability is derived from real list fields, not inferred from product names',async()=>{
 const energy={...fakeElement(),disabled:false},newest={...fakeElement(),disabled:false},note=fakeElement();
 const store=loadStorefront({elements:{'[data-catalog-filter="energy"]':energy,'[data-newest-option]':newest,'[data-energy-note]':note},api:{products:[apiProduct({name:'Airy A+++',energyClass:'',createdAt:'2026-01-01'}),apiProduct({id:'other',energyClass:'',createdAt:'2026-01-01'})]}});
 await store.fn<()=>Promise<void>>('loadCatalog')();assert.equal(energy.disabled,true);assert.equal(newest.disabled,true);assert.match(note.textContent,/paylaşılmamış/);
});
test('B3: catalog does not load unrelated blog and second-hand endpoints',async()=>{
 const store=loadStorefront({elements:{'[data-catalog-page]':fakeElement()}});
 const listener=store.listeners.DOMContentLoaded.find(fn=>String(fn).includes('loadManagedContent'));
 assert.ok(listener);listener({});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(store.fetchCalls.includes('/api/blog'),false);assert.equal(store.fetchCalls.includes('/api/second-hand'),false);
});
