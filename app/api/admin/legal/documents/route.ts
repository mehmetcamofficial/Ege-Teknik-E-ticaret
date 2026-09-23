import { legalAdminRoute } from "@/lib/legal-admin-http";
import { listLegalDocuments } from "@/lib/legal-admin-db";
import { LEGAL_DOCUMENT_SLUGS } from "@/lib/legal-admin";

export const GET = legalAdminRoute<Record<string, never>>(async () => {
  const documents = await listLegalDocuments();
  return Response.json({ documents, startableSlugs: LEGAL_DOCUMENT_SLUGS }, { headers: { "cache-control": "no-store" } });
});
