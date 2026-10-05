import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { resolveCheckoutCalculation, resolveCheckoutPreflight } from "@/lib/checkout-authority";
import { loadRequiredCheckoutLegalDocuments } from "@/lib/legal-db";
import { buildCanonicalLegalContext, canonicalContextDigest, renderLegalPreviewDocuments } from "@/lib/legal-preview-context";
import { LEGAL_PREVIEW_TTL_MS, legalPreviewSigningSecret, signLegalPreviewToken, type LegalPreviewDocument } from "@/lib/legal-preview-token";
import { createOrderIdentity } from "@/lib/order-identity";
import { orderRequestSchema } from "@/lib/order-domain";

/**
 * P3-LEGAL-3C.4 / P2 - pre-acceptance legal preview.
 *
 * The customer must be able to read the FULL order-specific legal text BEFORE ticking "I have read and accept".
 * This endpoint renders it server-side from the same authoritative calculation the order will use, mints the order
 * identity once, and returns a short-lived signed token proving what was shown.
 *
 * It creates NO order and writes NOTHING: the calculation layer is read-only, and the identity is logical until a
 * later `POST /api/orders` consumes the token.
 *
 * RATE LIMIT: reuses the existing `rateLimit` used by `POST /api/orders` (8 per 15 min per hashed client IP) - the
 * same abuse surface, since a preview triggers a full server-side pricing and legal render. No new limiter, no new
 * service, no new dependency.
 */
export const POST = publicRoute(async (request: Request) => {
  await rateLimit(request, "legal-preview", 8, 15 * 60_000);
  const parsed = orderRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Sipariş bilgilerinizi kontrol edin.", code: "INVALID_CHECKOUT" }, { status: 400 });

  const requested = new Map(parsed.data.items.map((item) => [item.productId, item.quantity]));
  // Layer 1 only: a preview legitimately happens BEFORE the customer has accepted anything.
  const preflight = await resolveCheckoutPreflight({ data: parsed.data }, requested);
  if (!preflight.ok) return Response.json(preflight.body, { status: preflight.status });
  const calculation = await resolveCheckoutCalculation({ data: parsed.data }, requested, preflight.requiredLegal);
  if (!calculation.ok) return Response.json(calculation.body, { status: calculation.status });

  // ONE timestamp for the whole preview, and the identity minted from it.
  const orderIssuedAt = new Date();
  const { orderNumber } = createOrderIdentity(orderIssuedAt);

  const documents = await loadRequiredCheckoutLegalDocuments(orderIssuedAt);
  if (!documents.ok) return Response.json({ error: "Yasal metinler şu anda yayında değil.", code: "LEGAL_DOCUMENTS_UNAVAILABLE" }, { status: 503 });

  const canonical = buildCanonicalLegalContext({
    calculation,
    data: parsed.data,
    billing: `${parsed.data.customerName} / ${parsed.data.city}`,
    orderNumber,
    orderIssuedAt: orderIssuedAt.getTime(),
    renderContextVersion: 2,
  });
  // Fail-closed: renderOrderLegalDocument throws on any unresolved token, so nothing partial is ever returned.
  const rendered = renderLegalPreviewDocuments({ canonical, documents: documents.required });

  const secret = legalPreviewSigningSecret();
  const issuedAt = orderIssuedAt.getTime();
  const token = signLegalPreviewToken({
    v: 1,
    issuedAt,
    expiresAt: issuedAt + LEGAL_PREVIEW_TTL_MS,
    orderNumber,
    orderIssuedAt: issuedAt,
    renderContextVersion: 2,
    contextDigest: canonicalContextDigest(canonical),
    documents: rendered.map(({ slug, documentVersionId, renderedSha256, templateContentHash }): LegalPreviewDocument => ({ slug, documentVersionId, renderedSha256, templateContentHash })),
  }, secret);

  return Response.json({
    ok: true,
    orderNumber,
    orderIssuedAt: issuedAt,
    expiresAt: issuedAt + LEGAL_PREVIEW_TTL_MS,
    legalPreviewToken: token,
    // Only acceptance-required documents. KVKK stays notice-only and is never here.
    documents: rendered.map(({ slug, title, version, documentVersionId, renderedBody }) => ({ slug, title, version, documentVersionId, renderedBody })),
  }, { headers: { "cache-control": "no-store" } });
});
