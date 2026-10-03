import "server-only";
import { getDb } from "@/db";
import { legalDocumentVersions, legalDocuments, orderLegalAcceptances } from "@/db/schema";
import { CHECKOUT_LEGAL_SLUGS, resolvePublicLegalVersion, selectCurrentLegalVersions, selectRequiredLegalVersions, toAcceptedLegalDocuments } from "@/lib/legal";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

/** Drafts (null publication columns) are excluded in SQL; this narrows the types and drops them again defensively. */
function publishedOnly<T extends { effectiveAt: Date | null; publishedAt: Date | null }>(rows: readonly T[]) {
  return rows.filter((row): row is T & { effectiveAt: Date; publishedAt: Date } => row.effectiveAt !== null && row.publishedAt !== null);
}

/** Read-only: loads the versions of the checkout legal documents and applies the deterministic selection rule. */
export async function loadRequiredCheckoutLegalVersions(now = new Date()) {
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(and(inArray(legalDocuments.slug, [...CHECKOUT_LEGAL_SLUGS]), isNotNull(legalDocumentVersions.publishedAt), isNotNull(legalDocumentVersions.effectiveAt)));
  return selectRequiredLegalVersions(publishedOnly(rows), now);
}

/**
 * Read-only: the acceptance-required checkout legal versions WITH their bodies, for server-side rendering.
 *
 * Mirrors `loadRequiredCheckoutLegalVersions` exactly - same rows, same deterministic selection rule - so the
 * preview and the order submission always agree on WHICH version is required. `/api/legal/required` still returns
 * ids and titles only, never bodies; bodies leave the server solely through the preview response.
 */
export async function loadRequiredCheckoutLegalDocuments(now = new Date()) {
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, body: legalDocumentVersions.body, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(and(inArray(legalDocuments.slug, [...CHECKOUT_LEGAL_SLUGS]), isNotNull(legalDocumentVersions.publishedAt), isNotNull(legalDocumentVersions.effectiveAt)));
  const selected = selectRequiredLegalVersions(publishedOnly(rows), now);
  if (!selected.ok) return selected;
  const byId = new Map(publishedOnly(rows).map((row) => [row.id, row]));
  return {
    ok: true as const,
    required: selected.required.map((doc) => {
      const row = byId.get(doc.versionId)!;
      return { slug: doc.slug, title: doc.title, versionId: doc.versionId, version: row.version, body: row.body };
    }),
  };
}

/** Read-only: all versions of one document, resolved for public viewing (published versions only). */
export async function loadPublicLegalVersion(slug: string, requestedVersionId: string | null, now = new Date()) {
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, body: legalDocumentVersions.body, contentHash: legalDocumentVersions.contentHash, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(and(eq(legalDocuments.slug, slug), isNotNull(legalDocumentVersions.publishedAt), isNotNull(legalDocumentVersions.effectiveAt)));
  return resolvePublicLegalVersion(publishedOnly(rows), requestedVersionId, now);
}

/** Read-only: metadata of the currently effective version of every document (no bodies). */
export async function loadCurrentLegalIndex(now = new Date()) {
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(and(isNotNull(legalDocumentVersions.publishedAt), isNotNull(legalDocumentVersions.effectiveAt)));
  return selectCurrentLegalVersions(publishedOnly(rows), now);
}

/**
 * Read-only: the legal documents ONE order actually accepted, joined through
 * order_legal_acceptances -> legal_document_versions -> legal_documents.
 *
 * The legal BODY is deliberately never selected: the exact historical text is already reachable, immutable,
 * through the public exact-version route, so an order payload never carries a full legal text. Returns an
 * empty array for pre-feature orders that have no acceptance rows - that is real history, not an error.
 */
export async function loadOrderAcceptedLegalDocuments(orderId: string) {
  const rows = await getDb()
    .select({
      documentVersionId: orderLegalAcceptances.documentVersionId,
      acceptedAt: orderLegalAcceptances.acceptedAt,
      slug: legalDocuments.slug,
      title: legalDocumentVersions.title,
      version: legalDocumentVersions.version,
      publishedAt: legalDocumentVersions.publishedAt,
      effectiveAt: legalDocumentVersions.effectiveAt,
    })
    .from(orderLegalAcceptances)
    .innerJoin(legalDocumentVersions, eq(legalDocumentVersions.id, orderLegalAcceptances.documentVersionId))
    .innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(eq(orderLegalAcceptances.orderId, orderId))
    .orderBy(asc(orderLegalAcceptances.acceptedAt), asc(orderLegalAcceptances.id));
  return rows.map((row) => ({ ...toAcceptedLegalDocuments([row])[0], acceptedAt: row.acceptedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null, effectiveAt: row.effectiveAt?.toISOString() ?? null }));
}
