import { z } from "zod";
import { secondHandHasRightsStripping } from "@/lib/second-hand-policy";

const inspectionFields = {
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Teknik kontrol tarihi YYYY-AA-GG biçiminde olmalı.").nullish(),
  inspectionResult: z.string().max(3000).nullish(),
  coolingTest: z.enum(["passed", "not_tested", "failed"]).nullish(),
  heatingTest: z.enum(["passed", "not_tested", "failed"]).nullish(),
  conditionGrade: z.enum(["cok_iyi", "iyi", "orta", "yedek_parca"]).nullish(),
  knownDefects: z.string().max(3000).default(""),
  missingAccessories: z.string().max(1000).default(""),
  warrantyMonths: z.coerce.number().int().min(0).max(120).default(0),
};

function rightsStrippingRefine(v: { warranty?: unknown; description?: unknown; testNotes?: unknown }, ctx: z.RefinementCtx) {
  for (const [key, label] of [["warranty", "Garanti"], ["description", "Açıklama"], ["testNotes", "Test notları"]] as const) {
    if (secondHandHasRightsStripping(String(v[key] ?? ""))) {
      ctx.addIssue({ code: "custom", path: [key], message: `${label} alanına "garanti yok / iade yok" gibi kanuni hakları ortadan kaldıran ifade yazılamaz.` });
    }
  }
}

const secondHandBase = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(2).max(160).regex(/^[a-z0-9-]+$/),
  category: z.string().min(2).max(80),
  condition: z.string().max(80).default("İyi"),
  testNotes: z.string().max(3000).default(""),
  warranty: z.string().max(160).default(""),
  price: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0).max(99),
  imageUrl: z.string().max(1000).default(""),
  status: z.enum(["draft", "published", "sold"]),
  description: z.string().max(4000).default(""),
  ...inspectionFields,
});

export const secondHandSchema = secondHandBase.superRefine(rightsStrippingRefine);
/** PATCH için kısmi şema: aynı alanlar + aynı hak-koruma kuralı. */
export const secondHandPatchSchema = secondHandBase.partial().superRefine(rightsStrippingRefine);
