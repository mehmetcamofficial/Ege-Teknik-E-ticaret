-- P3-LEGAL-USED-01: ikinci el (Spot) ürün teknik kontrol + kondisyon alanları.
-- ADDITIVE ONLY: yalnızca used_products tablosuna kolon ekler, mevcut satırlara dokunmaz.
-- inspection_* kolonları NULL bırakılır (taslak eksik bilgiyle kaydedilebilir);
-- yayın kapısı uygulama katmanındadır (lib/second-hand-policy.ts), bu yüzden
-- eksik kontrol kaydı bulunan eski ilanlar otomatik doğrulanmış sayılmaz.
-- UYGULANMADI: Neon/Preview/Production veritabanına uygulama.
ALTER TABLE "used_products" ADD COLUMN "inspection_date" text;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "inspection_result" text;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "cooling_test" text;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "heating_test" text;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "condition_grade" text;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "known_defects" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "missing_accessories" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "used_products" ADD COLUMN "warranty_months" integer DEFAULT 0 NOT NULL;
