/** H4-A: builds docs/h4/legal-review/inventory.json from the repository only (RC files + code registries). Reads no database. */
import{readFileSync,writeFileSync,readdirSync}from'node:fs';import{createHash}from'node:crypto';
const rc=(f)=>readFileSync(`docs/legal-drafts/${f}.md`,'utf8');
const registry=readFileSync('lib/legal-fixture-registry.ts','utf8');
const legacyIds=[...registry.slice(registry.indexOf('LEGACY_FIXTURE_VERSION_IDS'),registry.indexOf('const LEGACY_FIXTURE_ID_SET')).matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const reservedIds=[...new Set([...registry.matchAll(/"(p2-preview-fixture-[a-z-]+-render-1)"/g)].map(m=>m[1]))];
const adminSlugs=[...readFileSync('lib/legal-admin.ts','utf8').match(/LEGAL_DOCUMENT_SLUGS = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const legalTs=readFileSync('lib/legal.ts','utf8');
const checkboxSlugs=[...legalTs.match(/CHECKOUT_LEGAL_SLUGS = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const noticeSlugs=[...legalTs.match(/CHECKOUT_NOTICE_SLUGS = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const docs=[
 ['distance-sales','distance-sales','Mesafeli Satış Sözleşmesi','Checkout: zorunlu kabul kutusu (sürüm kimliğiyle kaydedilir), sipariş önizlemesi, onay ekranı, /legal/[slug]'],
 ['pre-information','pre-information','Ön Bilgilendirme Formu','Checkout: zorunlu kabul kutusu (sürüm kimliğiyle kaydedilir), sipariş önizlemesi, onay ekranı, /legal/[slug]'],
 ['kvkk','kvkk','KVKK Aydınlatma Metni','Checkout: bilgilendirme bağlantısı (kutu değil); yayınlanmadan sipariş alınmaz; /legal/[slug]'],
 ['privacy','privacy','Gizlilik Politikası','Yalnızca /legal dizini ve /legal/[slug]'],
 ['cookies','cookies','Çerez ve Tarayıcı Depolama Bilgilendirmesi','Çerez bildirimi "Ayrıntılı bilgi" bağlantısı policies.html#privacy’e gider; /legal dizini'],
 ['delivery-returns','delivery-returns','Teslimat, Montaj, İade ve Cayma Koşulları','Yalnızca /legal dizini ve /legal/[slug]'],
 ['terms','terms','İnternet Sitesi Kullanım Koşulları','Yalnızca /legal dizini ve /legal/[slug]'],
 ['installation','—','Kurulum ve Montaj Bilgilendirmesi','Admin dilim listesinde YOK; yayın yolu tanımlı değil'],
 ['marketing-consent','—','Ticari Elektronik İleti (Pazarlama) İzni','Özellik KAPALI; admin dilim listesinde YOK'],
 ['warranty','—','Garanti Bilgilendirme Modeli','Model taslağı; admin dilim listesinde YOK'],
];
const out=docs.map(([file,slug,title,usedIn])=>{const t=rc(file),tokens=[...new Set([...t.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m=>m[1]))].sort();
 const banner=(t.split('\n').find(l=>/RELEASE CANDIDATE|NOT PUBLISHED|DRAFT/.test(l))||'').replace(/^>\s*/,'').replace(/\*\*/g,'').trim();
 const inAdmin=adminSlugs.includes(slug);
 return{file:`docs/legal-drafts/${file}.md`,sha256:createHash('sha256').update(t).digest('hex'),words:t.split(/\s+/).length,title,dbSlug:inAdmin?slug:null,adminCanCreateDraft:inAdmin,
  acceptance:checkboxSlugs.includes(slug)?'checkbox (required, version id recorded)':noticeSlugs.includes(slug)?'notice only (must be published; never a checkbox)':'none',
  orderTokens:tokens,rcBanner:banner,usedIn}});
const registryIds=new Set([...legacyIds,...reservedIds]);
const result={generatedFrom:'repository only (no database read)',adminSlugs,checkboxSlugs,noticeSlugs,legacyFixtureIdCount:legacyIds.length,reservedFixtureIds:reservedIds,legacyFixtureIds:legacyIds,documents:out};
writeFileSync('docs/h4/legal-review/inventory.json',JSON.stringify(result,null,1)+'\n');
// Preview observation (read-only GET results captured by hand-run curl; ids classified against the registry here)
const preview=JSON.parse(readFileSync('docs/h4/legal-review/preview-observation.json','utf8'));
for(const key of ['documents','required'])for(const d of preview[key])d.registryClass=reservedIds.includes(d.versionId)?'reserved_preview_fixture':legacyIds.includes(d.versionId)?'legacy_fixture':'NOT IN REGISTRY (inspect)';
writeFileSync('docs/h4/legal-review/preview-observation.json',JSON.stringify(preview,null,1)+'\n');
console.log(out.length,'documents;',legacyIds.length,'legacy ids;',reservedIds.length,'reserved ids');
for(const d of preview.documents.concat(preview.required))console.log(d.slug.padEnd(16),d.registryClass.padEnd(26),d.versionId);
