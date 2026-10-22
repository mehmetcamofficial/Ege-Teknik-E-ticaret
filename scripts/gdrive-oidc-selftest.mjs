// GDRIVE-03: synthetic Drive connectivity test. Uploads ONE fixed, non-sensitive text file named H5C-OIDC-TEST-* and re-reads it
// to verify SHA-256. Touches no database, no backup, no delete. env: GDRIVE_ACCESS_TOKEN, GDRIVE_FOLDER_ID, GDRIVE_EXPECTED_ACCOUNT, RUN_ID
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriveClient } from '../lib/backup/drive-client.mjs';

const CONTENT = 'H5C-OIDC-TEST synthetic connectivity file. Not a backup. Contains no data. Safe to delete.\n';
const step = (name, code) => Object.assign(new Error(code), { step: name, code });

export async function selftest(env = process.env, client = createDriveClient({ getAccessToken: async () => env.GDRIVE_ACCESS_TOKEN })) {
  const { GDRIVE_FOLDER_ID: folder, GDRIVE_EXPECTED_ACCOUNT: account, RUN_ID: run = 'local' } = env;
  if (!env.GDRIVE_ACCESS_TOKEN) throw step('oidc_authentication', 'no_access_token');
  let about; try { about = await client.about(); } catch (e) { throw step('service_account_impersonation_or_token', e.code ?? 'about_failed'); }
  if (about.user?.emailAddress?.toLowerCase() !== account?.toLowerCase()) throw step('service_account_impersonation', 'unexpected_identity');
  let f; try { f = await client.getFolder(folder); } catch (e) { throw step('drive_folder_permission', e.code ?? 'folder_failed'); }
  if (!f.capabilities?.canAddChildren) throw step('drive_folder_permission', 'folder_not_writable');
  if ((f.permissions ?? []).some((p) => p.type === 'anyone' || p.type === 'domain')) throw step('drive_folder_permission', 'folder_shared_publicly');
  const name = `H5C-OIDC-TEST-${/^\d{1,20}$/.test(run) ? run : 'local'}.txt`;
  if ((await client.findByName(folder, name)).length) throw step('drive_upload', 'refusing_to_overwrite');
  const dir = await mkdtemp(join(tmpdir(), 'h5c-oidc-')), src = join(dir, name), back = join(dir, 'back.txt');
  try {
    await writeFile(src, CONTENT);
    let remote; try { remote = await client.uploadResumable(folder, name, src, { size: Buffer.byteLength(CONTENT) }); } catch (e) { throw step('drive_upload', e.code ?? 'upload_failed'); }
    try { await client.downloadToFile(remote.id, back); } catch (e) { throw step('sha256_roundtrip', e.code ?? 'download_failed'); }
    const h = (b) => createHash('sha256').update(b).digest('hex');
    if (h(await readFile(back)) !== h(CONTENT)) throw step('sha256_roundtrip', 'sha256_mismatch');
    return { name, sha256: h(CONTENT) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (process.argv[1]?.endsWith('gdrive-oidc-selftest.mjs')) {
  selftest().then((r) => console.log(`GDRIVE-03 SELFTEST: PASS file=${r.name} sha256=${r.sha256}`))
    .catch((e) => { console.error(`GDRIVE-03 SELFTEST: FAIL step=${e.step ?? 'unknown'} code=${/^[a-z_0-9]+$/.test(e.code ?? '') ? e.code : 'error'}`); process.exitCode = 1; });
}
