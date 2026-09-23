import "server-only";
import { getDb } from "@/db";
import { legalDocumentVersions, legalDocuments } from "@/db/schema";
import { CHECKOUT_LEGAL_SLUGS, resolvePublicLegalVersion, selectCurrentLegalVersions, selectRequiredLegalVersions } from "@/lib/legal";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

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
