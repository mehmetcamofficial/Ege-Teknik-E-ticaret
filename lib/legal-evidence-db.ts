import { getDb } from "@/db";
import { orderLegalAcceptances } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadOrderAcceptedLegalDocuments } from "@/lib/legal-db";
import { validatePersistedLegalEvidence, type EvidenceOrderIdentity } from "./legal-evidence.ts";

/** Internal-only read. Never return evidence bodies through the order response projection. */
export async function loadOrderLegalEvidenceSummary(orderId: string, identity: EvidenceOrderIdentity, db: Pick<ReturnType<typeof getDb>, "select"> = getDb()) {
  if (identity.legalEvidenceVersion == null) return loadOrderAcceptedLegalDocuments(orderId, db);
  const rows = await db.select().from(orderLegalAcceptances).where(eq(orderLegalAcceptances.orderId, orderId));
  return validatePersistedLegalEvidence(identity, rows).map(({ slug, title, version, documentVersionId }) => ({ slug, title, version, documentVersionId }));
}
