import { legalAdminRoute, readJson } from "@/lib/legal-admin-http";
import { publishLegalDraft } from "@/lib/legal-admin-db";
import { legalPublishSchema } from "@/lib/legal-admin";

// The body carries only the explicit effective date. Hash, published_at and published_by are server-side.
export const POST = legalAdminRoute<{ id: string }>(async (request, admin, { id }) => {
  const parsed = legalPublishSchema.safeParse(await readJson(request, 2_000));
  if (!parsed.success) return Response.json({ error: "Yürürlük tarihi zorunludur (ISO 8601)." }, { status: 400 });
  const result = await publishLegalDraft(id, new Date(parsed.data.effectiveAt), admin);
  return result.ok ? Response.json({ ok: true, contentHash: result.contentHash, publishedAt: result.publishedAt }) : Response.json({ error: result.error }, { status: result.status });
});
