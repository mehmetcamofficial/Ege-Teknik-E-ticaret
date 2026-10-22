import { loadPublicLegalVersion } from "@/lib/legal-db";
import { legalHtmlHeaders, renderLegalNotFound, renderLegalPage } from "@/lib/legal-render";

/**
 * Public, read-only legal document viewer. `?version=<id>` shows exactly that published version
 * (never a substitute); without it, the currently effective version. Unpublished/unknown => 404.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const requested = new URL(request.url).searchParams.get("version");
  if (requested !== null && (requested.length < 1 || requested.length > 100)) return new Response(renderLegalNotFound(), { status: 404, headers: legalHtmlHeaders });
  const result = slug.length <= 100 ? await loadPublicLegalVersion(slug, requested) : { ok: false as const, reason: "not_found" as const };
  if (!result.ok) return new Response(renderLegalNotFound(), { status: 404, headers: legalHtmlHeaders });
  return new Response(renderLegalPage(result.version, result.status, requested !== null), { headers: legalHtmlHeaders });
}
