import { loadCurrentLegalIndex } from "@/lib/legal-db";

/** Read-only public index of the currently effective legal documents: slug, title, version id. Never bodies. */
export async function GET() {
  return Response.json({ documents: await loadCurrentLegalIndex() }, { headers: { "cache-control": "no-store" } });
}
