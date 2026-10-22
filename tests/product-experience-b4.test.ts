import test from 'node:test';
import assert from 'node:assert/strict';
import { VERIFIED_IMAGE_CORRECTIONS, correctedProductImage } from '../lib/product-image-corrections.ts';
import { toCatalogListItem, toPublicProductDetail } from '../lib/product-enrichment.ts';
import { apiProduct, fakeElement, loadStorefront } from './support/storefront-sandbox.ts';

test('B4: all 11 verified image repairs require exact product and legacy URL, without mutation', () => {
  assert.equal(VERIFIED_IMAGE_CORRECTIONS.length, 11);
  for (const entry of VERIFIED_IMAGE_CORRECTIONS) {
    const original = { id: entry.id, imageUrl: entry.from, price: 123, saleMode: 'quote', gallery: [{ url: entry.from, alt: 'Ürün', width: 960, height: 540 }] };
    const before = JSON.stringify(original);
    const list = toCatalogListItem(original, 4), detail = toPublicProductDetail(original, 4);
    assert.equal(list.imageUrl, entry.to);
    assert.equal(detail.imageUrl, entry.to);
    assert.equal(detail.gallery[0].url, entry.to);
    assert.equal(list.price, 123);
    assert.equal(list.stock, 4);
    assert.equal(correctedProductImage('another-model', entry.from), entry.from);
    assert.equal(correctedProductImage(entry.id, 'https://www.gree.com.tr/new.jpg'), 'https://www.gree.com.tr/new.jpg');
    assert.equal(JSON.stringify(original), before);
    assert.equal(new URL(entry.to).hostname, 'www.gree.com.tr');
    assert.equal(new URL(entry.source).pathname, '/urun/' + entry.id);
  }
});

test('B4: comparison deduplicates/caps stored selections and tolerates corrupted storage', () => {
  const store = loadStorefront({ storage: { 'ege-compare': ['a', 'b', 'a', 'c', 'd', 'e', 1] } });
  assert.deepEqual(JSON.parse(JSON.stringify(store.fn<() => string[]>('getCompare')())), ['a','b','c','d']);
  const saved=store.storage.get('ege-compare');
  store.fn<(id:string)=>void>('toggleCompare')('e');
  assert.equal(store.storage.get('ege-compare'),saved,'a fifth selection is refused');
  store.storage.set('ege-compare', '{broken');
  assert.deepEqual(JSON.parse(JSON.stringify(store.fn<() => string[]>('getCompare')())), []);
});

test('B4: comparison distinguishes missing values, actual technical units and differences', async () => {
  const root=fakeElement();
  const products=[apiProduct({id:'a',name:'A',capacity:'12000 BTU/h',energyClass:''}),apiProduct({id:'b',name:'B',capacity:'18000 BTU/h',stock:0})];
  const store=loadStorefront({path:'compare.html',elements:{'[data-compare]':root},storage:{'ege-compare':['a','b']},api:{products,detail:{id:'a',specifications:[{key:'indoor_sound_pressure',value:'22',unit:'dB(A)'}]}}});
  await store.fn<() => Promise<void>>('loadCatalog')();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(root.innerHTML, /<table class="premium-compare"/);
  assert.match(root.innerHTML, /scope="row"/);
  assert.match(root.innerHTML, /Paylaşılmamış/);
  assert.match(root.innerHTML, /22 dB\(A\)/);
  assert.match(root.innerHTML, /Farklı/);
  assert.match(root.innerHTML, /Teknik bilgileri yeniden dene/);
  assert.equal(store.fetchCalls.filter(url=>url==='/api/products/a').length,1);
});

test('B4: product exposes missing facts and payment limit, while gallery has one keyboard entry',async()=>{
  const root=fakeElement(),detail=apiProduct({sku:'',energyClass:'',gallery:[{url:'https://www.gree.com.tr/a.jpg',alt:'A ön',width:960,height:540},{url:'https://www.gree.com.tr/b.jpg',alt:'A yan',width:960,height:540}]});
  const store=loadStorefront({path:'product.html',search:'?id='+detail.id,elements:{'[data-product-page]':root},api:{products:[detail],detail}});
  await store.fn<() => Promise<void>>('loadCatalog')();
  assert.match(root.innerHTML,/Model kodu <b>Paylaşılmamış/);
  assert.match(root.innerHTML,/Bu sayfada ödeme alınmaz/);
  assert.match(root.innerHTML,/gallery-help/);
  assert.match(root.innerHTML,/aria-pressed="true" tabindex="0"/);
  assert.match(root.innerHTML,/aria-pressed="false" tabindex="-1"/);
  assert.match(root.innerHTML,/aria-hidden="true" inert/);
});
