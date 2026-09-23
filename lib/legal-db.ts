import "server-only";
import { getDb } from "@/db";
import { legalDocumentVersions, legalDocuments } from "@/db/schema";
import { CHECKOUT_LEGAL_SLUGS, selectRequiredLegalVersions } from "@/lib/legal";
import { eq, inArray } from "drizzle-orm";

/** Read-only: loads the versions of the checkout legal documents and applies the deterministic selection rule. */
export async function loadRequiredCheckoutLegalVersions(now = new Date()) {
  const rows = await getDb()
    .select({ id: legalDocumentVersions.id, slug: legalDocuments.slug, version: legalDocumentVersions.version, title: legalDocumentVersions.title, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId))
    .where(inArray(legalDocuments.slug, [...CHECKOUT_LEGAL_SLUGS]));
  return selectRequiredLegalVersions(rows, now);
}
