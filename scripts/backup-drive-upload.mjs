// H5-C: uploads one verified backup set to the dedicated Drive folder and proves it arrived intact (manifest last).
// env: GDRIVE_ACCESS_TOKEN (short-lived, from workload identity federation), GDRIVE_FOLDER_ID, GDRIVE_EXPECTED_ACCOUNT (service account e-mail),
//      ENCRYPTED_FILE, CHECKSUM_FILE, MANIFEST_FILE, optional RUNNER_TEMP, optional GDRIVE_FOLDER_EVIDENCE + GDRIVE_EVIDENCE_PUBKEY (only
//      needed when Drive does not return the folder's permission list, e.g. Shared Drive folders). Never prints a token, key, URL or provider message.
import { createDriveClient } from '../lib/backup/drive-client.mjs';
import { uploadBackupSet } from '../lib/backup/drive-upload.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function run(env = process.env, deps = {}) {
  const token = env.GDRIVE_ACCESS_TOKEN ?? '';
  if (!token) { const e = new Error('no token'); e.code = 'missing_access_token'; throw e; }
  const client = deps.client ?? createDriveClient({ getAccessToken: async () => token });
  // Public data only (signed administrator evidence and its public key); kept apart from the logging callback on purpose.
  const evidence = { folderEvidence: env.GDRIVE_FOLDER_EVIDENCE, evidencePublicKey: env.GDRIVE_EVIDENCE_PUBKEY };
  return uploadBackupSet({ client, folderId: env.GDRIVE_FOLDER_ID, expectedAccount: env.GDRIVE_EXPECTED_ACCOUNT, files: { archive: env.ENCRYPTED_FILE, checksum: env.CHECKSUM_FILE, manifest: env.MANIFEST_FILE }, workRoot: env.RUNNER_TEMP, log: (m) => console.log(m), ...evidence });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().then((r) => { console.log(`GOOGLE DRIVE BACKUP: PASS (${r.files} files verified, manifest committed, backup_id=${r.backup_id})`); })
    .catch((e) => { console.error(`GOOGLE DRIVE BACKUP: FAIL (${/^[a-z_:]+$/.test(e?.code ?? '') ? e.code : 'error'})${e?.uploaded?.length ? ` — ${e.uploaded.length} file(s) uploaded but the set is NOT committed (no manifest); clean up manually` : ''}`); process.exitCode = 1; });
}
