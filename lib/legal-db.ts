import "server-only";
import { getDb } from "@/db";
import { legalDocumentVersions, legalDocuments, orderLegalAcceptances } from "@/db/schema";
import { CHECKOUT_LEGAL_SLUGS, hashLegalDocument, resolvePublicLegalVersion, selectCurrentLegalVersions, selectRequiredLegalVersions, toAcceptedLegalDocuments } from "@/lib/legal";
import { inspectLegalFixtureContamination, isLegalFixtureContaminated, reservedPreviewCheckoutDocuments } from "@/lib/legal-fixture-registry";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

/** Drafts (null publication columns) are excluded in SQL; this narrows the types and drops them again defensively. */
function publishedOnly<T extends { effectiveAt: Date | null; publishedAt: Date | null }>(rows: readonly T[]) {
  return rows.filter((row): row is T & { effectiveAt: Date; publishedAt: Date } => row.effectiveAt !== null && row.publishedAt !== null);
}

/**
 * P2-FIXTURE-A: the COMPLETE legal version inventory, read before ANY filtering - no slug filter, no published or
 * effective filter, no highest-version selection, no admin visibility rule.
 *
 * Containment has to see every row. If this query filtered to checkout slugs or to published-and-effective rows, a
 * fixture could hide behind being superseded, future-effective, sitting on a non-checkout slug, or shadowed by an
 * ordinary version - and the boundary would stop covering precisely the rows that need covering.
 */
async function loadCompleteLegalVersionInventory() {
  return getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, publishedBy: legalDocumentVersions.publishedBy, contentHash: legalDocumentVersions.contentHash })
    .from(legalDocumentVersions)
    .innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId));
}

/**
 * Fail-closed fixture containment. Returns true when legal authority must NOT be established.
 *
 * The environment is read from server-owned process env only. It is never taken from a hostname, a request header or
 * any client input, because a caller-supplied signal would let a request opt itself into the fixture branch.
 */
async function legalFixtureContaminated(): Promise<boolean> {
  const inventory = await loadCompleteLegalVersionInventory();
  return isLegalFixtureContaminated(inspectLegalFixtureContamination(inventory, process.env));
}

/** The single refusal result shared by every fixture-contaminated path. Mapped to LEGAL_DOCUMENTS_UNAVAILABLE by callers. */
const FIXTURE_CONTAMINATION_REFUSAL = { ok: false as const, missing: [...CHECKOUT_LEGAL_SLUGS] };

/** Read-only: loads the versions of the checkout legal documents and applies the deterministic selection rule. */
export async function loadRequiredCheckoutLegalVersions(now = new Date()) {
  if (await legalFixtureContaminated()) return FIXTURE_CONTAMINATION_REFUSAL;
  // P2-FIXTURE-B: in the verified Preview environment the checkout authority is served from the CODE-OWNED reserved
  // fixtures instead of the legacy Preview DB rows. This is the ONLY path that can serve them. The ids returned here
  // are the same ones `loadRequiredCheckoutLegalDocuments` renders and the same ones `checkLegalAcceptance` later
  // demands, so the preview token and the order submission agree on identity without any special-casing.
  const reserved = reservedPreviewCheckoutDocuments(process.env);
  if (reserved) return { ok: true as const, required: reserved.map((d) => ({ slug: d.slug, title: d.title, versionId: d.versionId })) };
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
  if (await legalFixtureContaminated()) return FIXTURE_CONTAMINATION_REFUSAL;
  // P2-FIXTURE-B: the same code-owned substitution, so the BODIES rendered into the preview token and the ids bound
  // into the order are the reserved fixtures - never the legacy Preview rows and never the unpublished RC v3.
  const reserved = reservedPreviewCheckoutDocuments(process.env);
  if (reserved) return { ok: true as const, required: reserved.map(({ versionId, slug, title, version, body }) => ({ slug, title, version, versionId, contentHash: hashLegalDocument({ title, body }), body })) };
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, contentHash: legalDocumentVersions.contentHash, body: legalDocumentVersions.body, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(and(inArray(legalDocuments.slug, [...CHECKOUT_LEGAL_SLUGS]), isNotNull(legalDocumentVersions.publishedAt), isNotNull(legalDocumentVersions.effectiveAt)));
  const selected = selectRequiredLegalVersions(publishedOnly(rows), now);
  if (!selected.ok) return selected;
  const byId = new Map(publishedOnly(rows).map((row) => [row.id, row]));
  return {
    ok: true as const,
    required: selected.required.map((doc) => {
      const row = byId.get(doc.versionId)!;
      return { slug: doc.slug, title: doc.title, versionId: doc.versionId, version: row.version, contentHash: row.contentHash, body: row.body };
    }),
  };
}

/** Read-only: all versions of one document, resolved for public viewing (published versions only). */
export async function loadPublicLegalVersion(slug: string, requestedVersionId: string | null, now = new Date()) {
  // P2-FIXTURE-A: a classified fixture must never be readable through the public exact-version route either.
  if (await legalFixtureContaminated()) return { ok: false as const, missing: [slug] };
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, body: legalDocumentVersions.body, contentHash: legalDocumentVersions.contentHash, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(and(eq(legalDocuments.slug, slug), isNotNull(legalDocumentVersions.publishedAt), isNotNull(legalDocumentVersions.effectiveAt)));
  return resolvePublicLegalVersion(publishedOnly(rows), requestedVersionId, now);
}

/** Read-only: metadata of the currently effective version of every document (no bodies). */
export async function loadCurrentLegalIndex(now = new Date()) {
  // P2-FIXTURE-A: the public index resolves the CURRENT version per slug, which is exactly how a published fixture
  // under cookies/terms would be advertised. Serve nothing rather than advertise fixture content.
  if (await legalFixtureContaminated()) return [];
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
