import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, legalDocuments, legalDocumentVersions } from "@/db/schema";
import { hashLegalDocument } from "@/lib/legal";
import { LEGAL_DOCUMENT_SLUGS, validateEffectiveAt, type LegalAuditAction } from "@/lib/legal-admin";

/**
 * The ONLY module that writes legal_document_versions. Every UPDATE/DELETE is restricted to drafts
 * (`published_at IS NULL`); the database trigger in migration 0005 enforces the same rule independently.
 * Version identity, content_hash, published_at and published_by are always produced here, never by the client.
 */
type Actor = { userId: string; email: string };
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type LegalMutation<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const versionColumns = { id: legalDocumentVersions.id, version: legalDocumentVersions.version, title: legalDocumentVersions.title, contentHash: legalDocumentVersions.contentHash, effectiveAt: legalDocumentVersions.effectiveAt, publishedAt: legalDocumentVersions.publishedAt, publishedBy: legalDocumentVersions.publishedBy, createdAt: legalDocumentVersions.createdAt };

async function audit(tx: Tx, actor: Actor, action: LegalAuditAction, versionId: string, payload: Record<string, unknown>) {
  // Safe identifiers only - never the legal body.
  await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.userId, actorEmail: actor.email, action, entityType: "legal_document_version", entityId: versionId, payload });
}

export async function listLegalDocuments() {
  const db = getDb();
  const docs = await db.select().from(legalDocuments).orderBy(asc(legalDocuments.slug));
  const versions = await db.select({ documentId: legalDocumentVersions.documentId, version: legalDocumentVersions.version }).from(legalDocumentVersions);
  return docs.map((doc) => ({ id: doc.id, slug: doc.slug, versionCount: versions.filter((v) => v.documentId === doc.id).length }));
}

export async function listLegalVersions(slug: string) {
  const db = getDb();
  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.slug, slug)).limit(1);
  if (!doc) return null;
  const versions = await db.select(versionColumns).from(legalDocumentVersions).where(eq(legalDocumentVersions.documentId, doc.id)).orderBy(desc(legalDocumentVersions.version));
  return { document: { id: doc.id, slug: doc.slug }, versions };
}

export async function getLegalVersion(id: string) {
  const [row] = await getDb().select({ ...versionColumns, body: legalDocumentVersions.body, documentId: legalDocumentVersions.documentId, slug: legalDocuments.slug })
    .from(legalDocumentVersions).innerJoin(legalDocuments, eq(legalDocuments.id, legalDocumentVersions.documentId)).where(eq(legalDocumentVersions.id, id)).limit(1);
  return row ?? null;
}

/** Creates the next draft. The document row is locked so concurrent creators are serialized; the unique (document, version) index is the backstop. */
export async function createLegalDraft(slug: string, input: { title: string; body: string }, actor: Actor): Promise<LegalMutation<{ id: string; version: number }>> {
  if (!(LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(slug)) return { ok: false, status: 404, error: "Bilinmeyen belge." };
  return getDb().transaction(async (tx) => {
    await tx.insert(legalDocuments).values({ id: crypto.randomUUID(), slug }).onConflictDoNothing({ target: legalDocuments.slug });
    const [doc] = await tx.select().from(legalDocuments).where(eq(legalDocuments.slug, slug)).for("update");
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${legalDocumentVersions.version}), 0)` }).from(legalDocumentVersions).where(eq(legalDocumentVersions.documentId, doc.id));
    const version = Number(max) + 1, id = crypto.randomUUID();
    await tx.insert(legalDocumentVersions).values({ id, documentId: doc.id, version, title: input.title, body: input.body, contentHash: hashLegalDocument(input) });
    await audit(tx, actor, "LEGAL_VERSION_CREATED", id, { documentId: doc.id, slug, version, versionId: id, contentHash: hashLegalDocument(input) });
    return { ok: true as const, id, version };
  });
}

export async function updateLegalDraft(id: string, patch: { title?: string; body?: string }, actor: Actor): Promise<LegalMutation<{ contentHash: string }>> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(legalDocumentVersions).where(eq(legalDocumentVersions.id, id)).for("update");
    if (!row) return { ok: false as const, status: 404, error: "Sürüm bulunamadı." };
    if (row.publishedAt !== null) return { ok: false as const, status: 409, error: "Yayınlanmış sürüm değiştirilemez; yeni bir sürüm oluşturun." };
    const next = { title: patch.title ?? row.title, body: patch.body ?? row.body }, contentHash = hashLegalDocument(next);
    const updated = await tx.update(legalDocumentVersions).set({ ...next, contentHash }).where(and(eq(legalDocumentVersions.id, id), isNull(legalDocumentVersions.publishedAt))).returning({ id: legalDocumentVersions.id });
    if (!updated.length) return { ok: false as const, status: 409, error: "Yayınlanmış sürüm değiştirilemez; yeni bir sürüm oluşturun." };
    const [doc] = await tx.select().from(legalDocuments).where(eq(legalDocuments.id, row.documentId));
    await audit(tx, actor, "LEGAL_DRAFT_UPDATED", id, { documentId: row.documentId, slug: doc.slug, version: row.version, versionId: id, contentHash });
    return { ok: true as const, contentHash };
  });
}

export async function deleteLegalDraft(id: string, actor: Actor): Promise<LegalMutation> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(legalDocumentVersions).where(eq(legalDocumentVersions.id, id)).for("update");
    if (!row) return { ok: false as const, status: 404, error: "Sürüm bulunamadı." };
    if (row.publishedAt !== null) return { ok: false as const, status: 409, error: "Yayınlanmış sürüm silinemez." };
    const removed = await tx.delete(legalDocumentVersions).where(and(eq(legalDocumentVersions.id, id), isNull(legalDocumentVersions.publishedAt))).returning({ id: legalDocumentVersions.id });
    if (!removed.length) return { ok: false as const, status: 409, error: "Yayınlanmış sürüm silinemez." };
    const [doc] = await tx.select().from(legalDocuments).where(eq(legalDocuments.id, row.documentId));
    await audit(tx, actor, "LEGAL_DRAFT_DELETED", id, { documentId: row.documentId, slug: doc.slug, version: row.version, versionId: id });
    return { ok: true as const };
  });
}

/** Draft -> published in ONE statement inside a transaction: hash, published_at, published_by, effective_at are set together. */
export async function publishLegalDraft(id: string, effectiveAt: Date, actor: Actor, now = new Date()): Promise<LegalMutation<{ contentHash: string; publishedAt: Date }>> {
  const valid = validateEffectiveAt(effectiveAt, now);
  if (!valid.ok) return { ok: false, status: 400, error: valid.error };
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(legalDocumentVersions).where(eq(legalDocumentVersions.id, id)).for("update");
    if (!row) return { ok: false as const, status: 404, error: "Sürüm bulunamadı." };
    if (row.publishedAt !== null) return { ok: false as const, status: 409, error: "Sürüm zaten yayınlanmış." };
    if (row.title.trim().length < 3 || row.body.trim().length < 10) return { ok: false as const, status: 400, error: "Başlık ve metin yayın için yetersiz." };
    const contentHash = hashLegalDocument({ title: row.title, body: row.body });
    const published = await tx.update(legalDocumentVersions).set({ contentHash, publishedAt: now, publishedBy: actor.userId, effectiveAt }).where(and(eq(legalDocumentVersions.id, id), isNull(legalDocumentVersions.publishedAt))).returning({ id: legalDocumentVersions.id });
    if (!published.length) return { ok: false as const, status: 409, error: "Sürüm zaten yayınlanmış." };
    const [doc] = await tx.select().from(legalDocuments).where(eq(legalDocuments.id, row.documentId));
    await audit(tx, actor, "LEGAL_VERSION_PUBLISHED", id, { documentId: row.documentId, slug: doc.slug, version: row.version, versionId: id, contentHash, effectiveAt: effectiveAt.toISOString() });
    return { ok: true as const, contentHash, publishedAt: now };
  });
}
