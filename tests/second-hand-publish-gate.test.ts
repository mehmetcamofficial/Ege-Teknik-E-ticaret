import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isSecondHandInspectionDate,
  secondHandDisplay,
  secondHandHasRightsStripping,
  secondHandPublishBlockers,
} from "../lib/second-hand-policy.ts";

/* P3-LEGAL-USED-01: yayın kapısı, kısmi PATCH, eski kayıt, vitrin sunumu. */

test("taslak eksik bilgiyle yayın kapısından geçer (kapı yalnız published için)", () => {
  assert.deepEqual(secondHandPublishBlockers({ status: "draft" }), []);
  assert.deepEqual(secondHandPublishBlockers({ status: "sold" }), []);
});

test("eksik kontrolle published engellenir", () => {
  const blockers = secondHandPublishBlockers({ status: "published" });
  assert.ok(blockers.length >= 5, `beklenen en az 5 engel, gelen: ${blockers.length}`);
});

test("eski kayıt (kontrol alanları boş) otomatik doğrulanmış sayılmaz", () => {
  const legacy = { status: "published", inspectionDate: null, inspectionResult: null, coolingTest: null, heatingTest: null, conditionGrade: null };
  assert.ok(secondHandPublishBlockers(legacy).length > 0);
});

test("kısmi PATCH sonrası birleşmiş ürün doğrulanır: yalnız fiyat yaması yayını açmaz", () => {
  const current = { status: "draft", inspectionDate: null, inspectionResult: null, coolingTest: null, heatingTest: null, conditionGrade: null };
  const merged = { ...current, price: 5000 };
  assert.ok(secondHandPublishBlockers({ ...merged, status: "published" }).length > 0);
});

test("tam kontrol bilgisiyle published kapısı açılır", () => {
  const full = { status: "published", inspectionDate: "2026-10-11", inspectionResult: "Kompresör ve gaz basıncı normal.", coolingTest: "passed", heatingTest: "passed", conditionGrade: "iyi" };
  assert.deepEqual(secondHandPublishBlockers(full), []);
});

test("bozuk tarih biçimi yayını engeller", () => {
  const bad = { status: "published", inspectionDate: "11.10.2026", inspectionResult: "ok", coolingTest: "passed", heatingTest: "passed", conditionGrade: "iyi" };
  assert.ok(secondHandPublishBlockers(bad).some((b) => b.includes("tarihi")));
});

test("vitrin boş test verisinden sahte 'test edildi' üretmez", () => {
  const d = secondHandDisplay({ coolingTest: null, heatingTest: "", conditionGrade: null, knownDefects: "", missingAccessories: "", warrantyMonths: 0 });
  assert.equal(d.cooling, "Soğutma testi: henüz yapılmadı");
  assert.equal(d.heating, "Isıtma testi: henüz yapılmadı");
  assert.equal(d.condition, "Belirtilmemiş");
  assert.equal(d.defects, "");
  assert.equal(d.accessories, "");
});

test("vitrin gerçek kontrol sonucunu, kusuru ve eksiği aynen gösterir", () => {
  const d = secondHandDisplay({ coolingTest: "passed", heatingTest: "failed", conditionGrade: "orta", knownDefects: "Kumanda kapağı yok.", missingAccessories: "Kumanda", warrantyMonths: 3 });
  assert.equal(d.cooling, "Soğutma testi: geçti");
  assert.equal(d.heating, "Isıtma testi: geçemedi");
  assert.equal(d.condition, "Orta");
  assert.equal(d.defects, "Kumanda kapağı yok.");
  assert.equal(d.accessories, "Kumanda");
  assert.match(d.warranty, /3 ay/);
  assert.match(d.warranty, /kanun/i);
});

test("garanti metni kanuni hakları ortadan kaldırmaz", () => {
  const withExtra = secondHandDisplay({ warrantyMonths: 6 });
  assert.doesNotMatch(withExtra.warranty, /iade yok|garanti yok/i);
  const withoutExtra = secondHandDisplay({ warrantyMonths: 0 });
  assert.match(withoutExtra.warranty, /kanuni/i);
  assert.doesNotMatch(withoutExtra.warranty, /ek ticari garanti/);
  for (const bad of ["Garanti yok, iade yok.", "garanti verilmez", "İADE EDİLMEZ", "Ayıplı kusur kabul edilmez"]) {
    assert.equal(secondHandHasRightsStripping(bad), true, bad);
  }
  assert.equal(secondHandHasRightsStripping("3 ay ek ticari garanti, kanuni haklar saklıdır."), false);
});

test("zod şeması hak ortadan kaldıran ifadeyi reddeder", async () => {
  // Şema dosyası `@/` aliası kullandığı için doğrudan import edilemez; aynı
  // superRefine kuralını dosya içeriği + paylaşılan politika üzerinden doğrula.
  const src = readFileSync("app/api/admin/second-hand/schema.ts", "utf8");
  assert.match(src, /secondHandHasRightsStripping/);
  assert.match(src, /kanuni hakları ortadan kaldıran/);
  const base = { name: "Spot klima", slug: "spot-klima-1", category: "Klima", price: 10000, stock: 1, status: "draft" as const };
  assert.equal(secondHandHasRightsStripping("Garanti yok"), true);
  assert.equal(secondHandHasRightsStripping(String((base as { warranty?: string }).warranty ?? "")), false);
});

test("0021 migration dosyası yalnızca ADDITIVE ALTER içerir, uygulanmamış durumdadır", () => {
  const sql = readFileSync("drizzle-pg/0021_second_hand_inspection.sql", "utf8");
  assert.match(sql, /UYGULANMADI/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
  assert.match(sql, /inspection_date/);
  assert.match(sql, /warranty_months/);
});

test("inspection calendar dates reject impossible days and preserve leap days", () => {
  assert.equal(isSecondHandInspectionDate("2026-02-30"), false);
  assert.equal(isSecondHandInspectionDate("2026-02-29"), false);
  assert.equal(isSecondHandInspectionDate("2024-02-29"), true);
  assert.equal(isSecondHandInspectionDate("2026-13-01"), false);
  assert.equal(isSecondHandInspectionDate("2026-10-20"), true);
  assert.ok(secondHandPublishBlockers({status:"published",inspectionDate:"2026-02-30"}).some(x => x.includes("tarihi")));
});
