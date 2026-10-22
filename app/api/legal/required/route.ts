import { loadRequiredCheckoutLegalVersions } from "@/lib/legal-db";

/** Read-only: the legal document versions checkout currently requires (ids and titles, never bodies). */
export async function GET() {
  const result = await loadRequiredCheckoutLegalVersions();
  if (!result.ok) return Response.json({ error: "Yasal metinler şu anda yayında değil.", code: "LEGAL_DOCUMENTS_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  return Response.json({ documents: result.required }, { headers: { "cache-control": "no-store" } });
}
