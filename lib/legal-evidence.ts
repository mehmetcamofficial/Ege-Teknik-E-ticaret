import type { LegalRenderContextVersion } from "@/lib/legal-preview-context";

/** Application contract for a future P3-B transaction. This type does not imply that evidence is persisted. */
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

/** The complete typed input a future P3-B transaction will persist atomically with its order. */
export type VerifiedLegalPreviewEvidence = {
  orderIssuedAt: Date;
  documents: readonly AcceptedLegalEvidenceDocument[];
};