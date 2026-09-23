import { legalAdminRoute, readJson } from "@/lib/legal-admin-http";
import { deleteLegalDraft, getLegalVersion, listLegalVersions, updateLegalDraft } from "@/lib/legal-admin-db";
import { deriveLegalStatus, legalDraftPatchSchema } from "@/lib/legal-admin";

export const GET = legalAdminRoute<{ id: string }>(async (_request, _admin, { id }) => {
  const version = await getLegalVersion(id);
  if (!version) return Response.json({ error: "Sürüm bulunamadı." }, { status: 404 });
  const siblings = (await listLegalVersions(version.slug))?.versions ?? [];
  return Response.json({ version: { ...version, status: deriveLegalStatus(version, siblings, new Date()) } }, { headers: { "cache-control": "no-store" } });
});

// Only drafts can be changed or removed; there is deliberately no way to touch a published version.
export const PATCH = legalAdminRoute<{ id: string }>(async (request, admin, { id }) => {
  const parsed = legalDraftPatchSchema.safeParse(await readJson(request, 60_000));
  if (!parsed.success) return Response.json({ error: "Başlık ve metin alanlarını kontrol edin." }, { status: 400 });
  const result = await updateLegalDraft(id, parsed.data, admin);
  return result.ok ? Response.json({ ok: true, contentHash: result.contentHash }) : Response.json({ error: result.error }, { status: result.status });
});

export const DELETE = legalAdminRoute<{ id: string }>(async (_request, admin, { id }) => {
  const result = await deleteLegalDraft(id, admin);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
});
