// Builds data/catalog-enrichment/catalog-enrichment.v1.json from the REVIEWED Product Enrichment Phase 2 artifacts.
// Offline and read-only: no network, no database. Usage:
//   node scripts/build-catalog-enrichment-data.mjs <phase2-dir> [--out <file>]
// Only review-approved, customer-safe data is written: REVIEW_REQUIRED specifications/documents and internal review metadata are dropped.
import { readFileSync, writeFileSync } from "node:fs";
import { datasetSchema } from "../lib/product-enrichment.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build-catalog-enrichment-data.mjs <phase2-dir> [--out file]");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "data/catalog-enrichment/catalog-enrichment.v1.json";
const read = (name) => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
const review = read("review/product-data-review-final.json"), snapshot = read("ege-products.json").products, audit = read("image-audit.json"), slugMap = read("slug-map.json");

const T = (key, label, unit = null) => ({ key, label, unit });
const SPEC_MAP = {
  capacity_btu: T("capacity_btu", "Kapasite", "BTU/h"), heating_capacity_min_nom_max: T("heating_capacity_btuh", "Isıtma kapasitesi", "BTU/h"), cooling_capacity_min_nom_max: T("cooling_capacity_btuh", "Soğutma kapasitesi", "BTU/h"),
  power_input_cooling_min_nom_max: T("power_input_cooling_w", "Soğutma güç tüketimi", "W"), power_input_heating_min_nom_max: T("power_input_heating_w", "Isıtma güç tüketimi", "W"),
  energy_class_seer_scop: T("energy_class", "Sezonsal enerji sınıfı (SEER / SCOP)"), multi_function_filter: T("multi_function_filter", "Çok fonksiyonlu filtre"), wifi: T("wifi", "Wi-Fi kontrol"),
  colour: T("colour", "Renk"), refrigerant: T("refrigerant", "Soğutucu akışkan"), product_type: T("product_type", "Ürün tipi"),
  indoor_dimensions: T("indoor_dimensions", "İç ünite net ölçüleri (G×Y×D)"), indoor_weight: T("indoor_weight", "İç ünite net ağırlığı"),
  catalog_cooling_capacity_kw: T("cooling_capacity_kw", "Soğutma kapasitesi", "kW"), catalog_heating_capacity_kw: T("heating_capacity_kw", "Isıtma kapasitesi", "kW"),
  catalog_cooling_capacity_btuh: T("cooling_capacity_btuh", "Soğutma kapasitesi", "BTU/h"), catalog_heating_capacity_btuh: T("heating_capacity_btuh", "Isıtma kapasitesi", "BTU/h"),
  catalog_power_input_cooling: T("power_input_cooling_kw", "Soğutma güç tüketimi", "kW"), catalog_power_input_heating: T("power_input_heating_kw", "Isıtma güç tüketimi", "kW"),
  catalog_operating_current: T("operating_current", "Çalışma akımı (nominal / maks.)", "A"), catalog_seer: T("seer", "SEER"), catalog_scop: T("scop", "SCOP"),
  catalog_power_supply: T("power_supply", "Güç kaynağı"), catalog_indoor_airflow: T("indoor_airflow", "İç ünite hava debisi", "m³/h"), catalog_outdoor_airflow: T("outdoor_airflow", "Dış ünite hava debisi", "m³/h"),
  catalog_indoor_sound_pressure_db_a: T("indoor_sound_pressure", "İç ünite ses basınç seviyesi", "dB(A)"), catalog_outdoor_sound_pressure_db_a: T("outdoor_sound_pressure", "Dış ünite ses basınç seviyesi", "dB(A)"),
  catalog_indoor_dimensions_mm: T("indoor_dimensions", "İç ünite net ölçüleri (G×Y×D)", "mm"), catalog_outdoor_dimensions_mm: T("outdoor_dimensions", "Dış ünite net ölçüleri (G×Y×D)", "mm"),
  catalog_indoor_weight_kg: T("indoor_weight", "İç ünite net ağırlığı", "kg"), catalog_outdoor_weight_kg: T("outdoor_weight", "Dış ünite net ağırlığı", "kg"),
  catalog_operating_temperature_cooling: T("operating_temperature_cooling", "Soğutmada dış hava çalışma sıcaklık aralığı", "°C"), catalog_operating_temperature_heating: T("operating_temperature_heating", "Isıtmada dış hava çalışma sıcaklık aralığı", "°C"),
  catalog_connectable_indoor_units: T("connectable_indoor_units", "Bağlanabilir iç ünite sayısı"),
};
const LABEL_MAP = { seer: T("seer", "SEER (enerji etiketi)"), seer_class: T("energy_class_seer", "Soğutma enerji sınıfı (SEER, enerji etiketi)"), indoor_sound_db: T("indoor_sound_db", "İç ünite ses seviyesi (enerji etiketi)", "dB"), outdoor_sound_db: T("outdoor_sound_db", "Dış ünite ses seviyesi (enerji etiketi)", "dB") };
const DOC_MAP = { "Ürün Kataloğu": ["catalog", "Ürün kataloğu"], "Kullanım Kılavuzu": ["manual", "Kullanım kılavuzu"], "Enerji Etiketi": ["energy_label", "Enerji etiketi"], "Wifi Kurulum Kılavuzu": ["wifi_guide", "Wi-Fi kurulum kılavuzu"], ERP: ["erp", "Ürün bilgi formu (ERP)"] };
const NEUTRAL = "Garanti bilgisi için Ege Teknik ile iletişime geçebilirsiniz.";
const norm = (v) => { const t = String(v).replace(/\s+/g, "").replace(",", "."); return /^-?\d+(\.\d+)?$/.test(t) ? String(Number(t)) : t; };

const decisions = [], records = {}, baseline = {}, specConflicts = [], excluded = new Set();
const byId = Object.fromEntries(snapshot.map((p) => [p.id, p]));
for (const [id, r] of Object.entries(review)) {
  const p = byId[id];
  for (const x of r.images.excluded_images) excluded.add(x.url);
  if (r.images.original_primary.status !== "OK") excluded.add(r.images.original_primary.url);
  decisions.push({ productId: id, importStatus: r.import_status, reasons: r.import_status_reasons.map((x) => String(x).slice(0, 300)) });
  baseline[id] = { id, slug: p.slug, name: p.name, price: p.price, vatRateBps: p.vatRateBps, saleMode: p.saleMode, status: p.status, sku: p.sku, description: p.description, imageUrl: p.imageUrl, energyClass: p.energyClass, wifi: p.wifi };
  if (!["READY_FOR_PREVIEW_IMPORT", "READY_WITH_LIMITED_SPECS"].includes(r.import_status)) continue;

  const specs = {}, drop = new Set();
  const add = (def, entry, source, dynamicRange) => {
    const label = dynamicRange && String(entry.value).includes("~") ? `${def.label} (min ~ nominal ~ maks.)` : def.label;
    const next = { label, value: String(entry.value), unit: def.unit ?? entry.unit ?? null, status: entry.status === "VERIFIED" ? "verified" : "partial", source };
    if (drop.has(def.key)) return;
    const cur = specs[def.key];
    if (cur && norm(cur.value) !== norm(next.value)) { delete specs[def.key]; drop.add(def.key); specConflicts.push({ productId: id, key: def.key, a: cur.value, b: next.value }); return; }
    if (!cur || (cur.status === "partial" && next.status === "verified")) specs[def.key] = next;
  };
  for (const [k, e] of Object.entries(r.specifications)) {
    const def = SPEC_MAP[k]; if (!def || !["VERIFIED", "PARTIAL"].includes(e.status)) continue;
    const kind = k.startsWith("catalog_") ? "catalog" : "product_page";
    const source = kind === "catalog" ? { kind, url: e.source.url, ...(e.source.page ? { page: e.source.page } : {}) } : { kind, url: e.source.url };
    add(def, e, source, kind === "catalog");
  }
  const lab = r.energy_label;
  if (lab && !lab.system_configuration_label) for (const f of lab.fields) { const def = LABEL_MAP[f.field]; if (def && ["VERIFIED", "PARTIAL"].includes(f.status)) add(def, { value: f.raw_visible_value, unit: f.unit, status: f.status }, { kind: "energy_label", url: lab.label_url }, false); }

  const w = r.warranty, cls = w.classification === "VERIFIED_PRODUCT_SPECIFIC" ? w.classification : w.classification === "GENERAL_TERMS_ONLY" ? w.classification : "CONFLICT_REVIEW_REQUIRED";
  const warranty = { classification: cls, displayText: cls === "CONFLICT_REVIEW_REQUIRED" ? NEUTRAL : w.customer_copy, pageValue: w.page_value ?? null, conditions: w.conditions ?? null, sourceUrl: w.source_url, generalTermsUrl: w.general_terms_url, retrievedAt: w.retrieved_at };
  const gallery = r.images.gallery.map((url, i) => ({ url, alt: i === 0 ? p.name : `${p.name} - görsel ${i + 1}`, width: audit[url].width, height: audit[url].height }));
  const pageEnergy = specs.energy_class?.status === "verified" ? specs.energy_class.value : null;
  const pageWifi = specs.wifi?.status === "verified" && specs.wifi.value.toLowerCase() === "var" ? "Var" : null;
  records[id] = {
    productId: id, shortDescription: r.descriptions.short_description, description: r.descriptions.long_description, sku: r.identity.model_code,
    imageUrl: r.images.primary_image, gallery, specifications: specs,
    documents: r.documents.filter((d) => d.status === "PROPOSE").map((d) => ({ type: DOC_MAP[d.type][0], label: DOC_MAP[d.type][1], url: d.url })),
    manufacturerWarranty: warranty, sourceUrl: r.identity.official_url, energyClass: pageEnergy, wifi: pageWifi,
  };
}
const slugRedirects = slugMap.entries.filter((e) => e.priority === "REQUIRED").map((e) => ({ oldId: e.product_id, newSlug: e.proposed_slug }));
decisions.sort((a, b) => a.productId.localeCompare(b.productId));
// an excluded URL must not be a gallery image of any record
const approved = new Set(Object.values(records).flatMap((r) => r.gallery.map((g) => g.url)));
for (const u of excluded) if (approved.has(u)) throw new Error(`excluded image is also approved: ${u}`);
const dataset = datasetSchema.parse({ version: 1, decisions, records, baseline, slugRedirects, excludedImageUrls: [...excluded].sort() });
writeFileSync(out, JSON.stringify(dataset, null, 1) + "\n");
console.log(`wrote ${out}: ${decisions.length} decisions, ${Object.keys(records).length} import records, ${slugRedirects.length} slug redirects, ${specConflicts.length} spec conflicts dropped`);
for (const c of specConflicts) console.log("  spec conflict dropped:", c.productId, c.key, c.a, "vs", c.b);
