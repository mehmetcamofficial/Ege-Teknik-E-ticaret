import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * P3-LEGAL-3C.4 / P2 - the stateless signed legal-preview token.
 *
 * The customer must see the exact order-specific legal text BEFORE accepting it. The preview endpoint renders that
 * text and hands the browser a compact, signed proof that it showed it; `POST /api/orders` then proves that the order
 * it is about to create is the same order context whose text was displayed.
 *
 * The token is deliberately STATELESS: no quote table, no preview table, no Redis, no reservation. The trade-off is
 * that an abandoned preview may "consume" its candidate order number, so order numbers are NOT contiguous - which is
 * acceptable because nothing may depend on contiguity.
 *
 * SECURITY RULES:
 *  - Stateless does NOT mean trustable. The signature is only checked with a constant-time comparison, and the
 *    payload is parsed and validated only AFTER the signature verifies.
 *  - The payload carries NO customer data at all: no name, e-mail, phone, address, billing details, product names,
 *    rendered legal text or prices. Those are bound by the context digest and the per-document SHA-256 digests, which
 *    are one-way, so the token can never leak or reconstruct what the customer entered.
 *  - A valid signature is never sufficient on its own: the server recomputes authority and re-renders before
 *    trusting anything.
 */

export const LEGAL_PREVIEW_TOKEN_VERSION = 1;
/** Locked for P2: a preview is valid for 15 minutes. */
export const LEGAL_PREVIEW_TTL_MS = 15 * 60 * 1000;
/** Generous slack so a small clock skew cannot fail a legitimate customer mid-checkout. */
export const LEGAL_PREVIEW_CLOCK_SKEW_MS = 60 * 1000;
/** Minimum secret length, mirroring the existing IP_HASH_SALT policy. */
export const LEGAL_PREVIEW_SECRET_MIN_LENGTH = 32;

export const LEGAL_PREVIEW_SIGNING_SECRET_ENV = "LEGAL_PREVIEW_SIGNING_SECRET";

/** One acceptance-required document, bound by the SHA-256 of the EXACT plain text shown to the customer. */
export type LegalPreviewDocument = { slug: string; documentVersionId: string; renderedSha256: string };

export type LegalPreviewTokenPayload = {
  v: number;
  /** Issued-at of the token itself (epoch ms). */
  issuedAt: number;
  /** Expiry of the token itself (epoch ms). */
  expiresAt: number;
  orderNumber: string;
  /** The frozen order timestamp the legal document was rendered with (epoch ms). */
  orderIssuedAt: number;
  /** SHA-256 of the canonical checkout/legal context. */
  contextDigest: string;
  /** Deterministically sorted, so the signed bytes are stable. */
  documents: LegalPreviewDocument[];
};

export type LegalPreviewTokenFailure =
  | "malformed"
  | "bad_signature"
  | "unsupported_version"
  | "expired"
  | "not_yet_valid"
  | "invalid_payload";

export type LegalPreviewTokenResult = { ok: true; payload: LegalPreviewTokenPayload } | { ok: false; reason: LegalPreviewTokenFailure };

/**
 * The signing secret. Fails closed: a missing or too-short secret is a server configuration error, never a silently
 * unsigned token. `IP_HASH_SALT` is deliberately NOT reused - it is scoped to hashing client IPs for rate limiting,
 * and reusing it here would couple contract integrity to an unrelated operational secret.
 */
export function legalPreviewSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env[LEGAL_PREVIEW_SIGNING_SECRET_ENV];
  if (!secret || secret.length < LEGAL_PREVIEW_SECRET_MIN_LENGTH) {
    throw new Error(`${LEGAL_PREVIEW_SIGNING_SECRET_ENV} must contain at least ${LEGAL_PREVIEW_SECRET_MIN_LENGTH} characters`);
  }
  return secret;
}


const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON with sorted object keys and no incidental whitespace, so equal semantics always produce equal bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const sha256Hex = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const fromB64url = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
};

/** Documents are sorted by slug so the signed bytes never depend on DB row order. */
export function canonicalPreviewDocuments(documents: readonly LegalPreviewDocument[]): LegalPreviewDocument[] {
  return [...documents].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function signLegalPreviewToken(payload: LegalPreviewTokenPayload, secret: string): string {
  const bytes = Buffer.from(canonicalJson({ ...payload, documents: canonicalPreviewDocuments(payload.documents) }), "utf8");
  return `${bytes.toString("base64url")}.${createHmac("sha256", secret).update(bytes).digest("base64url")}`;
}

function parsePayload(value: unknown): LegalPreviewTokenPayload | null {
  if (!isPlainObject(value)) return null;
  const { v, issuedAt, expiresAt, orderNumber, orderIssuedAt, contextDigest, documents } = value;
  if (v !== LEGAL_PREVIEW_TOKEN_VERSION) return null;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  if (typeof orderNumber !== "string" || orderNumber.length < 4 || orderNumber.length > 100) return null;
  if (typeof orderIssuedAt !== "number" || !Number.isFinite(orderIssuedAt)) return null;
  if (typeof contextDigest !== "string" || !/^[0-9a-f]{64}$/.test(contextDigest)) return null;
  if (!Array.isArray(documents) || documents.length === 0 || documents.length > 20) return null;
  const seen = new Set<string>();
  const parsed: LegalPreviewDocument[] = [];
  for (const entry of documents) {
    if (!isPlainObject(entry)) return null;
    const { slug, documentVersionId, renderedSha256 } = entry;
    if (typeof slug !== "string" || !/^[a-z0-9-]{1,100}$/.test(slug)) return null;
    if (typeof documentVersionId !== "string" || documentVersionId.length < 1 || documentVersionId.length > 200) return null;
    if (typeof renderedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(renderedSha256)) return null;
    if (seen.has(slug)) return null; // a slug may never be bound twice
    seen.add(slug);
    parsed.push({ slug, documentVersionId, renderedSha256 });
  }
  return { v, issuedAt, expiresAt, orderNumber, orderIssuedAt, contextDigest, documents: canonicalPreviewDocuments(parsed) };
}

/**
 * Verify and decode. The signature is compared in constant time BEFORE the payload is trusted or parsed, and every
 * rejection returns a generic reason so nothing about the secret, the signing scheme or internal state leaks.
 */
export function verifyLegalPreviewToken(token: unknown, secret: string, now: number = Date.now()): LegalPreviewTokenResult {
  if (typeof token !== "string" || token.length < 16 || token.length > 8000) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1 || token.indexOf(".", dot + 1) !== -1) return { ok: false, reason: "malformed" };
  const payloadBytes = fromB64url(token.slice(0, dot));
  const signatureBytes = fromB64url(token.slice(dot + 1));
  if (!payloadBytes || !signatureBytes || signatureBytes.length !== 32) return { ok: false, reason: "malformed" };
  if (!timingSafeEqual(signatureBytes, createHmac("sha256", secret).update(payloadBytes).digest())) return { ok: false, reason: "bad_signature" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isPlainObject(decoded) || decoded.v !== LEGAL_PREVIEW_TOKEN_VERSION) return { ok: false, reason: "unsupported_version" };
  const payload = parsePayload(decoded);
  if (!payload) return { ok: false, reason: "invalid_payload" };
  if (payload.expiresAt <= now) return { ok: false, reason: "expired" };
  if (payload.issuedAt - LEGAL_PREVIEW_CLOCK_SKEW_MS > now) return { ok: false, reason: "not_yet_valid" };
  return { ok: true, payload };
}

/** SHA-256 of the exact plain-text document the customer was shown. */
export const digestRenderedLegalBody = (body: string): string => sha256Hex(Buffer.from(body, "utf8"));

/** SHA-256 of the canonical context bytes. */
export const digestCanonicalContext = (canonical: string): string => sha256Hex(Buffer.from(canonical, "utf8"));
