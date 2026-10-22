import type { LegalRenderContextVersion } from "@/lib/legal-preview-context";

/** Verified application evidence contract, persisted atomically by the P3-B transaction. */
export type AcceptedLegalEvidenceDocument = {
  slug: string;
  documentVersionId: string;
  title: string;
  version: number;
  templateContentHash: string;
  renderedBody: string;
  renderedSha256: string;
  renderContextVersion: LegalRenderContextVersion;
  /** Server time when the submitted required-document acceptance set passed verification. */
  acceptedAt: Date;
};

/** The complete typed input persisted atomically with its order. */
export type VerifiedLegalPreviewEvidence = {
  orderIssuedAt: Date;
  documents: readonly AcceptedLegalEvidenceDocument[];
};
import { digestRenderedLegalBody } from "./legal-preview-token.ts";

/** Persistence format 1 is distinct from the renderer/context format 2. */
export const LEGAL_EVIDENCE_VERSION = 1;
export class LegalEvidenceIntegrityError extends Error {
  constructor() { super("Persisted legal evidence integrity failure"); this.name = "LegalEvidenceIntegrityError"; }
}
export type EvidenceOrderIdentity = {
  legalEvidenceVersion?: number | null;
  orderIssuedAt?: Date | null;
  createdAt: Date;
};
export type PersistedLegalEvidenceRow = {
  slug: string | null; title: string | null; version: number | null;
  documentVersionId: string; templateContentHash: string | null;
  renderedBody: string | null; renderedSha256: string | null;
  renderContextVersion: number | null; acceptanceType: string | null; acceptedAt: Date;
};

export function validatePersistedLegalEvidence(identity: EvidenceOrderIdentity, rows: readonly PersistedLegalEvidenceRow[]) {
  const bad = () => { throw new LegalEvidenceIntegrityError(); };
  if (identity.legalEvidenceVersion !== LEGAL_EVIDENCE_VERSION || !(identity.orderIssuedAt instanceof Date)
    || !Number.isFinite(identity.orderIssuedAt.getTime()) || rows.length !== 2) bad();
  const slugs = new Set<string>();
  for (const row of rows) {
    if ((row.slug !== "distance-sales" && row.slug !== "pre-information") || slugs.has(row.slug)
      || !row.title || !row.documentVersionId || !row.version || !Number.isInteger(row.version) || row.version < 1
      || !row.templateContentHash || !/^[0-9a-f]{64}$/.test(row.templateContentHash)
      || !row.renderedBody || !row.renderedSha256 || !/^[0-9a-f]{64}$/.test(row.renderedSha256)
      || row.renderContextVersion !== 2 || row.acceptanceType !== "checkout_required"
      || !(row.acceptedAt instanceof Date) || row.acceptedAt.getTime() !== identity.createdAt.getTime()
      || identity.orderIssuedAt!.getTime() > row.acceptedAt.getTime()
      || digestRenderedLegalBody(row.renderedBody) !== row.renderedSha256) bad();
    slugs.add(row.slug!);
  }
  return rows.map((row) => ({ ...row, slug: row.slug!, title: row.title!, version: row.version! }));
}
