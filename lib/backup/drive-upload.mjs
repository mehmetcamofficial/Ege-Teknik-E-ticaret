/**
 * H5-C: upload one backup SET (archive, checksum, manifest) to Drive and prove it arrived intact.
 *
 * Order: archive -> checksum -> manifest. The manifest is the COMMIT MARKER: until it is verified in Drive the set is incomplete and
 * is never reported as a success. Nothing is ever overwritten (a name that already exists aborts before any upload), and a failure
 * returns the names already uploaded so an operator can clean them by hand - this code never deletes.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { assertManifestMatchesArchive } from './manifest.mjs';
import { assessFolderSafety } from './drive-folder-safety.mjs';

export class BackupUploadError extends Error {
  constructor(code, uploaded = []) { super(`Backup upload failed: ${code}`); this.name = 'BackupUploadError'; this.code = code; this.uploaded = uploaded; this.manifestUploaded = false; }
}
const hashFile = async (file, algorithm) => { const h = createHash(algorithm); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };

export async function uploadBackupSet({ client, folderId, expectedAccount, files, workRoot = tmpdir(), log = () => {}, folderEvidence, evidencePublicKey, now = new Date() }) {
  const uploaded = [];
  const fail = (code) => { throw new BackupUploadError(code, [...uploaded]); };
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId ?? '')) fail('invalid_folder_id');
  if (!/^[^\s@]+@[^\s@]+$/.test(expectedAccount ?? '')) fail('missing_expected_account');
  const { archive, checksum, manifest } = files;
  const names = [archive, checksum, manifest].map((f) => basename(f ?? ''));
  if (names.some((n) => !n) || new Set(names).size !== 3) fail('ambiguous_files');

  // ---- local validation before any network call ----
  const head = Buffer.alloc(8), fh = await open(archive, 'r');
  try { await fh.read(head, 0, 8, 0); } finally { await fh.close(); }
  if (head.toString() !== 'ETGCM002') fail('not_an_authenticated_archive');
  const sha256 = await hashFile(archive, 'sha256'), sizeBytes = (await stat(archive)).size;
  if ((await readFile(checksum, 'utf8')) !== `${sha256}  ${names[0]}\n`) fail('checksum_file_mismatch');
  let parsed; try { parsed = JSON.parse(await readFile(manifest, 'utf8')); assertManifestMatchesArchive(parsed, { name: names[0], sha256, sizeBytes }); } catch (e) { fail(e?.code === 'manifest_mismatch' ? 'manifest_mismatch' : 'invalid_manifest'); }

  // ---- identity and destination ----
  let about; try { about = await client.about(); } catch { fail('identity_check_failed'); }
  if (about.user?.emailAddress?.toLowerCase() !== expectedAccount.toLowerCase()) fail('unexpected_identity');
  let folder; try { folder = await client.getFolder(folderId); } catch { fail('folder_check_failed'); }
  if (folder.id !== folderId || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed) fail('unsafe_folder');
  if (!folder.capabilities?.canAddChildren) fail('folder_not_writable');
  // A folder visible to "anyone" or a whole domain is never a backup location. A missing permission list (Shared Drive items, callers
  // who cannot share) is UNKNOWN and needs verified administrator evidence; it is not treated as safe and not reported as public.
  try { assessFolderSafety(folder, { evidenceB64: folderEvidence, publicKeyPem: evidencePublicKey, now }); } catch (e) { fail(e?.code ?? 'folder_check_failed'); }
  for (const name of names) { let found; try { found = await client.findByName(folderId, name); } catch { fail('existence_check_failed'); } if (found.length) fail('refusing_to_overwrite'); }

  // ---- upload + verify each file, manifest last ----
  const work = await mkdtemp(join(workRoot, 'ege-drive-verify-'));
  try {
    for (const [index, file] of [archive, checksum, manifest].entries()) {
      const name = names[index], size = (await stat(file)).size;
      let remote; try { remote = await client.uploadResumable(folderId, name, file, { size }); } catch { fail(`upload_failed:${index === 2 ? 'manifest' : index === 1 ? 'checksum' : 'archive'}`); }
      uploaded.push(name);
      if (remote.name !== name || Number(remote.size) !== size) fail('remote_metadata_mismatch');
      if (remote.md5Checksum && remote.md5Checksum !== await hashFile(file, 'md5')) fail('remote_md5_mismatch'); // transport check supplied by Drive
      const copy = join(work, `${index}-${name}`);
      try { await client.downloadToFile(remote.id, copy); } catch { fail('verification_download_failed'); }
      if (await hashFile(copy, 'sha256') !== await hashFile(file, 'sha256')) fail('roundtrip_sha256_mismatch');
      log(`verified ${index === 2 ? 'manifest' : index === 1 ? 'checksum' : 'archive'} (${size} bytes)`);
    }
  } finally { await rm(work, { recursive: true, force: true }); }
  return { status: 'PASS', backup_id: parsed.backup_id, sha256, size_bytes: sizeBytes, files: names.length, commit_marker: 'manifest verified' };
}
