import { legalAdminRoute, readJson } from "@/lib/legal-admin-http";
import { createLegalDraft, listLegalVersions } from "@/lib/legal-admin-db";
import { deriveLegalStatus, legalDraftSchema } from "@/lib/legal-admin";

export const GET = legalAdminRoute<{ slug: string }>(async (_request, _admin, { slug }) => {
  const result = await listLegalVersions(slug);
  if (!result) return Response.json({ error: "Belge bulunamadı." }, { status: 404 });
  const now = new Date();
  return Response.json({ document: result.document, versions: result.versions.map((v) => ({ ...v, status: deriveLegalStatus(v, result.versions, now) })) }, { headers: { "cache-control": "no-store" } });
});

export const POST = legalAdminRoute<{ slug: string }>(async (request, admin, { slug }) => {
  const parsed = legalDraftSchema.safeParse(await readJson(request, 60_000));
  if (!parsed.success) return Response.json({ error: "Başlık ve metin alanlarını kontrol edin." }, { status: 400 });
  const result = await createLegalDraft(slug, parsed.data, admin);
  return result.ok ? Response.json({ ok: true, id: result.id, version: result.version }, { status: 201 }) : Response.json({ error: result.error }, { status: result.status });
});
