import type { CheckoutAuthorityContext } from "@/lib/checkout-authority";
import { buildCanonicalLegalContext, canonicalContextDigest, renderLegalPreviewDocuments } from "@/lib/legal-preview-context";
import { digestRenderedLegalBody, verifyLegalPreviewToken, type LegalPreviewDocument } from "@/lib/legal-preview-token";
import { isReservedPreviewFixtureVersionId } from "@/lib/legal-fixture-registry";
import type { VerifiedLegalPreviewEvidence } from "@/lib/legal-evidence";
import { hashLegalDocument } from "./legal.ts";
import { timingSafeEqual } from "node:crypto";

/**
 * P3-LEGAL-3C.4 / P2 - binding a signed preview to the order that is about to be created.
 *
 * A valid signature is NEVER sufficient. The server recomputes authority from current state, rebuilds the canonical
 * context using the token's frozen identity, re-renders every required document, and compares everything. Any drift -
 * price, quantity, address, tariff, legal version, template text - changes a digest and the submission fails closed,
 * forcing the customer to take a fresh preview and accept again.
 *
 * Every failure returns one opaque reason: nothing about which hash, signature or field failed may leak to a client.
 */

export type LegalPreviewBinding = {
  ok: true;
  /** The order number minted at preview time - reused verbatim, never regenerated. */
  orderNumber: string;
  /** One verified representation, ready for a future P3-B transaction; not persisted in P3-A. */
  evidence: VerifiedLegalPreviewEvidence;
};

const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; compare digests of different lengths without throwing.
  return left.length === right.length && timingSafeEqual(left, right);
};

export function resolveLegalPreviewBinding(input: {
  data: { customerName: string; email: string; phone: string; address: string; city: string; district: string; legalAcceptances: string[] };
  calculation: CheckoutAuthorityContext;
  documents: readonly { slug: string; title: string; versionId: string; version: number; contentHash: string; body: string }[];
  token: unknown;
  secret: string;
  billing: string;
  acceptedAt: Date;
  now?: number;
}): LegalPreviewBinding | { ok: false } {
  const verified = verifyLegalPreviewToken(input.token, input.secret, input.now ?? Date.now());
  if (!verified.ok) return { ok: false };
  const payload = verified.payload;
  if (payload.documents.some((doc) => isReservedPreviewFixtureVersionId(doc.documentVersionId))) return { ok: false };
  const renderContextVersion = payload.renderContextVersion ?? 1;

  // Rebuild the canonical context with the token's FROZEN identity - never a freshly minted one.
  const canonical = buildCanonicalLegalContext({
    calculation: input.calculation,
    data: input.data,
    billing: input.billing,
    orderNumber: payload.orderNumber,
    orderIssuedAt: payload.orderIssuedAt,
    renderContextVersion,
  });
  if (!equal(canonicalContextDigest(canonical), payload.contextDigest)) return { ok: false };

  if (renderContextVersion === 2 && input.documents.some((doc) => hashLegalDocument({ title: doc.title, body: doc.body }) !== doc.contentHash)) return { ok: false };

  // Re-render from CURRENT server state and require byte-identical text.
  const rendered = renderLegalPreviewDocuments({ canonical, documents: input.documents });
  const current: LegalPreviewDocument[] = rendered.map((doc) => ({ slug: doc.slug, documentVersionId: doc.documentVersionId, renderedSha256: doc.renderedSha256, templateContentHash: doc.templateContentHash }));
  if (current.length !== payload.documents.length) return { ok: false };
  for (const expected of payload.documents) {
    const actual = current.find((doc) => doc.slug === expected.slug);
    if (!actual) return { ok: false };
    if (actual.documentVersionId !== expected.documentVersionId) return { ok: false };
    if (!equal(actual.renderedSha256, expected.renderedSha256)) return { ok: false };
    if (renderContextVersion === 2 && (!expected.templateContentHash || !actual.templateContentHash || !equal(actual.templateContentHash, expected.templateContentHash))) return { ok: false };
  }

  // The submitted acceptance must be exactly the token-bound document set - no more, no fewer.
  const boundIds = payload.documents.map((doc) => doc.documentVersionId).sort();
  const submitted = [...input.data.legalAcceptances].sort();
  if (boundIds.length !== submitted.length || boundIds.some((id, index) => id !== submitted[index])) return { ok: false };

  const acceptedAt = input.acceptedAt;
  return {
    ok: true,
    orderNumber: payload.orderNumber,
    evidence: {
      orderIssuedAt: new Date(payload.orderIssuedAt),
      documents: rendered.map((doc) => ({ ...doc, acceptedAt })),
    },
  };
}

/** The digest a preview must bind, exposed so the preview endpoint and the tests build it identically. */
export const previewContextDigest = (input: {
  calculation: CheckoutAuthorityContext;
  data: { customerName: string; email: string; phone: string; address: string; city: string; district: string };
  billing: string;
  orderNumber: string;
  orderIssuedAt: number;
  renderContextVersion?: 1 | 2;
}): string => canonicalContextDigest(buildCanonicalLegalContext(input));

export { digestRenderedLegalBody };
