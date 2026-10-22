// P3-LEGAL-USED-01: ikinci el (Spot) klima yayınlama kuralları.
// Yayınlama kapısı (publish gate) + sunum türetimleri için tek doğruluk kaynağı.
// Admin UI, POST/PATCH API ve müşteri vitrini bu modülü kullanır; kural burada yaşar.
export type SecondHandCoolingTest = "passed" | "not_tested" | "failed";
export type SecondHandHeatingTest = "passed" | "not_tested" | "failed";
export type SecondHandCondition = "cok_iyi" | "iyi" | "orta" | "yedek_parca";

export const SECOND_HAND_COOLING_LABEL: Record<SecondHandCoolingTest, string> = {
  passed: "Soğutma testi: geçti",
  not_tested: "Soğutma testi: henüz yapılmadı",
  failed: "Soğutma testi: geçemedi",
};
export const SECOND_HAND_HEATING_LABEL: Record<SecondHandHeatingTest, string> = {
  passed: "Isıtma testi: geçti",
  not_tested: "Isıtma testi: henüz yapılmadı",
  failed: "Isıtma testi: geçemedi",
};
export const SECOND_HAND_CONDITION_LABEL: Record<SecondHandCondition, string> = {
  cok_iyi: "Çok iyi",
  iyi: "İyi",
  orta: "Orta",
  yedek_parca: "Yedek parça / çalışmıyor",
};

const CONDITION_VALUES: readonly string[] = ["cok_iyi", "iyi", "orta", "yedek_parca"];
const TEST_VALUES: readonly string[] = ["passed", "not_tested", "failed"];

export type SecondHandPublishCandidate = {
  status?: unknown;
  inspectionDate?: unknown;
  inspectionResult?: unknown;
  coolingTest?: unknown;
  heatingTest?: unknown;
  conditionGrade?: unknown;
};

/**
 * Yayınlanabilirlik kapısı. Taslaklar eksik bilgiyle kaydedilebilir; ancak
 * `published` durumu için teknik kontrol tarihi + sonucu, soğutma/ısıtma testi
 * ve kondisyon derecesi zorunludur. Eski kayıtlar (kontrol alanı boş) otomatik
 * doğrulanmış sayılmaz: `inspectionResult` boşsa kapı kapalıdır.
 */
export function isSecondHandInspectionDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function secondHandPublishBlockers(p: SecondHandPublishCandidate): string[] {
  if (p.status !== "published") return [];
  const blockers: string[] = [];
  if (!isSecondHandInspectionDate(p.inspectionDate)) {
    blockers.push("Teknik kontrol tarihi (YYYY-AA-GG) girilmeden yayınlanamaz.");
  }
  if (typeof p.inspectionResult !== "string" || !p.inspectionResult.trim()) {
    blockers.push("Teknik kontrol sonucu girilmeden yayınlanamaz.");
  }
  if (!TEST_VALUES.includes(p.coolingTest as string)) {
    blockers.push("Soğutma testi sonucu seçilmeden yayınlanamaz.");
  }
  if (!TEST_VALUES.includes(p.heatingTest as string)) {
    blockers.push("Isıtma testi sonucu seçilmeden yayınlanamaz.");
  }
  if (!CONDITION_VALUES.includes(p.conditionGrade as string)) {
    blockers.push("Kondisyon derecesi seçilmeden yayınlanamaz.");
  }
  return blockers;
}

/**
 * Vitrin sunumu. Boş veriden sahte "test edildi" üretilmez: test alanı boşsa
 * "henüz yapılmadı" etiketi gösterilir, kusur/eksik alanlar boşsa satır gizlenir
 * ("" döndürülür), garanti yalnızca pozitif ek ticari süre + kanuni hak notudur.
 */
export function secondHandDisplay(p: {
  coolingTest?: string | null;
  heatingTest?: string | null;
  conditionGrade?: string | null;
  knownDefects?: string | null;
  missingAccessories?: string | null;
  warrantyMonths?: number | null;
}): { cooling: string; heating: string; condition: string; defects: string; accessories: string; warranty: string } {
  const pick = (v: string | null | undefined, labels: Record<string, string>, missingKey: "not_tested") =>
    (v && labels[v]) || labels[missingKey];
  const text = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");
  const months = typeof p.warrantyMonths === "number" && Number.isFinite(p.warrantyMonths) && p.warrantyMonths > 0 ? Math.floor(p.warrantyMonths) : 0;
  return {
    cooling: pick(p.coolingTest, SECOND_HAND_COOLING_LABEL, "not_tested"),
    heating: pick(p.heatingTest, SECOND_HAND_HEATING_LABEL, "not_tested"),
    condition: (p.conditionGrade && SECOND_HAND_CONDITION_LABEL[p.conditionGrade as SecondHandCondition]) || "Belirtilmemiş",
    defects: text(p.knownDefects),
    accessories: text(p.missingAccessories),
    warranty: months > 0
      ? `Satıcı tarafından verilen ek ticari garanti: ${months} ay. Tüketici kanunundan doğan haklarınız saklıdır.`
      : "Kanuni tüketici haklarınız saklıdır.",
  };
}

/** "Garanti yok / iade yok" gibi kanuni hakları ortadan kaldıran ifade taraması. */
export function secondHandHasRightsStripping(text: string): boolean {
  // Türkçe büyük İ/i uyumu için locale-aware normalize (JS `i` flag'i İ→i eşleştirmez).
  const t = (text ?? "").toLocaleLowerCase("tr");
  return /garanti\s*(yok|yoktur|verilmez|verilmemektedir)|iade\s*(yok|yoktur|alınmaz|edilmez)|değişim\s*(yok|yoktur)|ay[ıi]pl[ıi]\s*kusur/.test(t);
}
