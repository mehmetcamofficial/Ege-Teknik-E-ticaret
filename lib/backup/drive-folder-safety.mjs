/**
 * GDRIVE-03: decide whether a Drive folder may receive an encrypted backup, and tell the reasons apart.
 *
 * Drive does not return `permissions` for items in a Shared Drive (and not to a caller who cannot share the item), so a missing
 * list is "UNKNOWN", never "public" and never "safe":
 *   - list present, `anyone` or `domain` in it ........ folder_is_shared_publicly (always refused)
 *   - list present, neither ............................ accepted (type `user`/`group`, direct or inherited)
 *   - list missing, no admin evidence .................. folder_permissions_unavailable (refused)
 *   - list missing, evidence that does not verify ...... folder_evidence_invalid | folder_evidence_expired | folder_evidence_mismatch (refused)
 *   - list missing, verified evidence says public ...... folder_is_shared_publicly (refused)
 *   - list missing, verified evidence says private ..... accepted
 *
 * Admin evidence is a JSON document produced by scripts/gdrive03-admin-folder-evidence.mjs under an administrator's own identity and
 * signed with an Ed25519 key that only the administrator holds. The matching PUBLIC key is the trust anchor, kept in a repository
 * environment variable. Evidence carries no e-mail address, token or secret.
 */
import { createPublicKey, verify } from 'node:crypto';

export const EVIDENCE_KIND = 'gdrive03-folder-evidence';
export const EVIDENCE_VERSION = 1;
export const EVIDENCE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const REQUIRED_FALSE = ['folder_anyone', 'folder_domain', 'drive_anyone', 'drive_domain'];

export class FolderSafetyError extends Error {
  constructor(code) { super(`Folder safety check failed: ${code}`); this.name = 'FolderSafetyError'; this.code = code; }
}

/** Stable serialisation that both signer and verifier use. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Evidence is shipped as base64(JSON({ evidence, signature })). */
export function decodeEvidence(b64) {
  let container;
  try { container = JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8')); } catch { throw new FolderSafetyError('folder_evidence_invalid'); }
  if (!container || typeof container !== 'object' || typeof container.signature !== 'string' || !container.evidence || typeof container.evidence !== 'object') throw new FolderSafetyError('folder_evidence_invalid');
  return container;
}

export function verifyEvidence({ evidenceB64, publicKeyPem, folderId, driveId, now = new Date() }) {
  const bad = (code = 'folder_evidence_invalid') => { throw new FolderSafetyError(code); };
  if (!evidenceB64 || !publicKeyPem) throw new FolderSafetyError('folder_permissions_unavailable');
  const { evidence: e, signature } = decodeEvidence(evidenceB64);
  let signatureOk = false;
  try { signatureOk = verify(null, Buffer.from(canonicalJson(e)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64')); } catch { signatureOk = false; }
  if (!signatureOk) bad();
  if (e.kind !== EVIDENCE_KIND || e.version !== EVIDENCE_VERSION) bad();
  const observed = Date.parse(e.observed_at);
  if (typeof e.observed_at !== 'string' || Number.isNaN(observed) || new Date(observed).toISOString() !== e.observed_at) bad();
  if (observed > now.getTime() + 5 * 60 * 1000) bad();
  if (now.getTime() - observed > EVIDENCE_MAX_AGE_MS) bad('folder_evidence_expired');
  if (e.folder_id !== folderId || !driveId || e.drive_id !== driveId) bad('folder_evidence_mismatch');
  if (e.service_account_role !== 'writer') bad();
  const f = e.findings;
  if (!f || typeof f !== 'object') bad();
  // Anything but an explicit boolean is a malformed document, not "probably fine".
  for (const k of REQUIRED_FALSE) if (typeof f[k] !== 'boolean') bad();
  if (REQUIRED_FALSE.some((k) => f[k] === true)) throw new FolderSafetyError('folder_is_shared_publicly');
  return { observed_at: e.observed_at };
}

/**
 * @param folder  result of files.get (id, driveId, permissions?)
 * @returns { basis: 'api_permissions' | 'admin_evidence' } or throws FolderSafetyError
 */
export function assessFolderSafety(folder, { evidenceB64, publicKeyPem, now } = {}) {
  // A folder always has at least one permission (owner or drive member), so an empty list means "not populated", i.e. unknown.
  if (Array.isArray(folder.permissions) && folder.permissions.length > 0) {
    if (folder.permissions.some((p) => p?.type === 'anyone' || p?.type === 'domain')) throw new FolderSafetyError('folder_is_shared_publicly');
    return { basis: 'api_permissions' };
  }
  verifyEvidence({ evidenceB64, publicKeyPem, folderId: folder.id, driveId: folder.driveId, now });
  return { basis: 'admin_evidence' };
}
