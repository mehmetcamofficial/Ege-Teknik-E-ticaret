import { legalAdminRoute } from "@/lib/legal-admin-http";
import { getLegalVersion } from "@/lib/legal-admin-db";
import { legalHtmlHeaders, renderLegalDraftPreview } from "@/lib/legal-render";

/** Authenticated preview of any version (draft included) exactly as the public viewer would render its body. */
export const GET = legalAdminRoute<{ id: string }>(async (_request, _admin, { id }) => {
  const version = await getLegalVersion(id);
  if (!version) return Response.json({ error: "Sürüm bulunamadı." }, { status: 404 });
  return new Response(renderLegalDraftPreview(version), { headers: { ...legalHtmlHeaders, "x-robots-tag": "noindex" } });
});
