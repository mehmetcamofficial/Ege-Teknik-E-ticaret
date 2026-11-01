#!/usr/bin/env node
/**
 * Offline, read-only prepublication gate. Does not connect to DB, Vercel, or a network.
 * Run: node scripts/verify-legal-publication.mjs [--structural-only]
 * The default MUST fail while human signoffs are incomplete.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const VALID_SLUGS = ["distance-sales", "pre-information", "kvkk"];
export const ADDRESS = "Cumhuriyet Mah. Ant Sk. No: 7 B, Kuşadası / Aydın";
export const TOKENS = new Set(["ALICI_AD_SOYAD","ALICI_EPOSTA","ALICI_TELEFON","TESLIMAT_ADRESI","TESLIMAT_YONTEMI","SIPARIS_NO","SIPARIS_TARIHI","URUN_SATIRLARI","URUN_TOPLAMI","TOPLAM_TUTAR","KARGO_UCRETI","DIGER_EK_MASRAFLAR","FATURA_BILGILERI"]);
const INTERNAL_MARKERS = /RELEASE CANDIDATE|LEGAL REVIEW REQUIRED|NOT YET PUBLISHED|DOĞRULAMA BEKLİYOR|\bTBD\b|\bTODO\b|Sürüm notu:|\[PLACEHOLDER\]|KEP adresi doğrulandığında|Bu bölümdeki standart kapsam listesi ve 4 metre sınırı henüz iş tarafından/iu;
const PENDING_MOUNT = "> [DOĞRULAMA BEKLİYOR: standart montaj paketi kapsamı] — Bu bölümdeki standart kapsam listesi ve 4 metre sınırı henüz iş tarafından ve hukuken doğrulanmamıştır; yayından önce teyit edilmelidir.\n\n";
const KVKK_FOOTER = "\n---\n\n**Sürüm notu:** Bu Release Candidate, doğrulanmış şirket kimliği ve mevcut uygulama veri akışıyla uyumlu hale getirilmiştir. MERSİS/KEP, e-belge sağlayıcısı, ödeme kuruluşu ve teslimat/kargo sağlayıcısı kesinleştiğinde ilgili alanlar yeni belge sürümünde güncellenmelidir.\n";

export function candidateFromSource(slug, source) {
  if (!VALID_SLUGS.includes(slug)) throw Error("Unknown document slug");
  const titles = {
    "distance-sales":"MESAFELİ SATIŞ SÖZLEŞMESİ",
    "pre-information":"ÖN BİLGİLENDİRME FORMU",
    "kvkk":"KİŞİSEL VERİLERİN İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ"
  };
  const prefix = "# " + titles[slug];
  const start = source.indexOf(prefix);
  if (start < 0 || source.indexOf(prefix, start+1) !== -1) throw Error("Missing/ambiguous heading");
  let s = source.slice(start);
  if (slug === "distance-sales") {
    if (!s.includes(PENDING_MOUNT)) throw Error("Missing required source blocker: installation scope");
    s = s.replace(PENDING_MOUNT, "");
  }
  if (slug === "kvkk") {
    if (!s.includes(KVKK_FOOTER)) throw Error("Missing required KVKK source release note");
    s = s.replace(KVKK_FOOTER, "");
  }
  const kep = slug === "kvkk"
    ? "KEP adresi doğrulandığında bu metnin sonraki sürümüne eklenir; doğrulanmamış bilgi yayımlanmaz.\n\n"
    : "KEP adresi doğrulandığında ilgili belge sürümüne eklenir; doğrulanmamış bilgi yayımlanmaz.\n\n";
  if (!s.includes(kep)) throw Error("Missing expected editorial KEP note");
  s = s.replace(kep, "");
  return s.trim()+"\n";
}

const sha = text => createHash("sha256").update(text,"utf8").digest("hex");

export function auditCandidates({root=process.cwd(), structuralOnly=false} = {}) {
  const failures = [];
  const manifest = JSON.parse(readFileSync(resolve(root,"docs/legal-publication-candidates/release-gates.json"),"utf8"));
  const listed = manifest.documents.map(d=>d.slug);
  if (new Set(listed).size !== 3 || VALID_SLUGS.some(s=>!listed.includes(s))) failures.push("DOCUMENT_SET_MISMATCH");
  if (manifest.sellerAddress !== ADDRESS) failures.push("SELLER_ADDRESS_MANIFEST_CHANGED");
  const observed=[];
  for(const slug of VALID_SLUGS) {
    const item=manifest.documents.find(d=>d.slug===slug);
    if (!item) continue;
    const sourcePath="docs/legal-drafts/"+slug+".md";
    const candidatePath="docs/legal-publication-candidates/"+slug+".md";
    if (item.source!==sourcePath || item.candidate!==candidatePath) {failures.push(slug+":UNEXPECTED_PATH");continue;}
    const source=readFileSync(resolve(root,sourcePath),"utf8");
    const body=readFileSync(resolve(root,candidatePath),"utf8");
    try {if(body!==candidateFromSource(slug,source)) failures.push(slug+":SOURCE_CANDIDATE_DRIFT");}
    catch(e){failures.push(slug+":SOURCE_TRANSFORM_FAILED:"+e.message)}
    if(INTERNAL_MARKERS.test(body)) failures.push(slug+":INTERNAL_MARKER_PRESENT");
    if(!body.includes(ADDRESS)) failures.push(slug+":SELLER_ADDRESS_MISSING");
    if(body.includes("İkiçeşmelik")) failures.push(slug+":LEGACY_ADDRESS_PRESENT");
    const variables=[...body.matchAll(/\{\{([^{}]+)\}\}/g)].map(m=>m[1]);
    if(slug==="kvkk" && variables.length) failures.push("kvkk:NOTICE_MUST_HAVE_NO_TOKENS");
    for (const variable of variables) if(!TOKENS.has(variable)) failures.push(slug+":UNKNOWN_TOKEN:"+variable);
    if(slug!=="kvkk" && !variables.includes("SIPARIS_NO")) failures.push(slug+":ORDER_ID_TOKEN_MISSING");
    if(body.includes("{{") && !variables.length) failures.push(slug+":MALFORMED_TOKEN");
    observed.push({slug,sha256:sha(body),tokens:variables.length});
  }
  if (!structuralOnly) {
    if(manifest.status!=="APPROVED_FOR_PUBLICATION") failures.push("RELEASE_STATUS_NOT_APPROVED");
    for(const d of manifest.documents) if(d.approval!==true) failures.push(d.slug+":LEGAL_DOCUMENT_APPROVAL_MISSING");
    for(const b of manifest.releaseBlockers) if(b.cleared!==true || typeof b.evidence!=="string" || b.evidence.trim().length<8) failures.push("UNRESOLVED_GATE:"+b.id);
    // This script can verify a manifest flag, not authenticity of human approval.
    // An operator MUST separately verify approval evidence out of band.
  }
  return {ok:failures.length===0,failures,observed};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const structuralOnly=process.argv.includes("--structural-only");
  try{
    const result=auditCandidates({structuralOnly});
    for(const v of result.observed) console.log("[legal-prepublish] "+v.slug+" sha256="+v.sha256+" tokens="+v.tokens);
    for(const issue of result.failures) console.error("[legal-prepublish] BLOCKED: "+issue);
    console.log("[legal-prepublish] "+(result.ok?"PASS":"BLOCKED")+(structuralOnly?" (STRUCTURAL ONLY; NOT PUBLICATION APPROVAL)":" (PRODUCTION PUBLISH GATE)"));
    process.exitCode=result.ok?0:1;
  }catch(e){console.error("[legal-prepublish] BLOCKED: "+e.message);process.exitCode=1;}
}
