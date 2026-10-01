import { legalAdminRoute, readJson } from "@/lib/legal-admin-http";
import { createLegalDraft, listLegalVersions } from "@/lib/legal-admin-db";
import { deriveLegalStatus, legalDraftSchema } from "@/lib/legal-admin";
import { legacyFixtureHidingActive, partitionLegalVersions } from "@/lib/legal-fixtures";

export const GET = legalAdminRoute<{ slug: string }>(async (request, _admin, { slug }) => {
  const result = await listLegalVersions(slug);
  if (!result) return Response.json({ error: "Belge bulunamadı." }, { status: 404 });
  const now = new Date();
  // Status is derived from the COMPLETE history, before anything is hidden, so hiding a fixture can
  // never change how a real version's status is computed.
  const versions = result.versions.map((v) => ({ ...v, status: deriveLegalStatus(v, result.versions, now) }));
  const { visible, hidden } = partitionLegalVersions(versions);
  // Preview-only, and opt-in: `?legacy=1` lets an authorized admin inspect the hidden fixture history.
  const showLegacy = legacyFixtureHidingActive(process.env.APP_ENV) && new URL(request.url).searchParams.get("legacy") === "1";
  return Response.json(
    { document: result.document, versions: showLegacy ? versions : visible, hiddenLegacyCount: legacyFixtureHidingActive(process.env.APP_ENV) ? hidden.length : 0, legacyHidingActive: legacyFixtureHidingActive(process.env.APP_ENV) },
    { headers: { "cache-control": "no-store" } },
  );
});

export const POST = legalAdminRoute<{ slug: string }>(async (request, admin, { slug }) => {
  const parsed = legalDraftSchema.safeParse(await readJson(request, 60_000));
  if (!parsed.success) return Response.json({ error: "Başlık ve metin alanlarını kontrol edin." }, { status: 400 });
  const result = await createLegalDraft(slug, parsed.data, admin);
  return result.ok ? Response.json({ ok: true, id: result.id, version: result.version }, { status: 201 }) : Response.json({ error: result.error }, { status: result.status });
});
