// GDRIVE-03: independent proof half. Downloads the synthetic backup set that was uploaded to the ISOLATED Drive test folder,
// re-verifies SHA-256 and manifest, decrypts with the per-run test key, restores into a DISPOSABLE LOOPBACK PostgreSQL and compares
// a content/schema fingerprint with the synthetic source. Also proves a wrong key, a tampered archive and an invalid token are refused.
// env: GDRIVE_ACCESS_TOKEN, GDRIVE_FOLDER_ID, GDRIVE_EXPECTED_ACCOUNT, BACKUP_NAME (no extension), BACKUP_GCM_KEY_B64 (never printed),
//      SOURCE_URL, RESTORE_URL (both loopback). Prints step names and PASS/FAIL only: no token, key, URL, row data or provider message.
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDriveClient } from '../lib/backup/drive-client.mjs';
import { assertManifestMatchesArchive } from '../lib/backup/manifest.mjs';
import { assertDisposableTarget, restore } from './restore-encrypted-backup.mjs';

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const fail = (step, code) => Object.assign(new Error(code), { step, code });

const FINGERPRINT_SQL = `
SELECT 'table|' || c.relname || '|' ||
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text || '|' ||
  (xpath('/row/h/text()', query_to_xml(format('select coalesce(md5(string_agg(t::text, ''|'' order by t::text)), ''empty'') as h from public.%I t', c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'r'
UNION ALL SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL SELECT 'constraint|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
UNION ALL SELECT 'index|' || indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL SELECT 'view|' || viewname || '|' || definition FROM pg_views WHERE schemaname = 'public'
ORDER BY 1`;

/** Row counts, per-table content hash and schema shape of the public schema, as an ordered list of lines. */
export function fingerprint(rawUrl, run = spawnSync) {
  const u = assertDisposableTarget(rawUrl);
  const env = { PATH: process.env.PATH, PGPASSWORD: decodeURIComponent(u.password) };
  const args = ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--no-password', '-h', u.hostname.replace(/[[\]]/g, ''), '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1), '-c', FINGERPRINT_SQL];
  const res = run('psql', args, { env, encoding: 'utf8' });
  if (res.status !== 0) throw fail('fingerprint', 'psql_failed');
  const lines = res.stdout.split('\n').filter(Boolean);
  if (!lines.some((l) => l.startsWith('table|'))) throw fail('fingerprint', 'no_tables');
  return lines;
}

/** Download archive + checksum + manifest by name from the folder and prove they are the set that was uploaded. */
export async function downloadAndVerifySet({ client, folderId, expectedAccount, backupName, dir }) {
  if (!/^ege-teknik-synthetic-[A-Za-z0-9_-]+$/.test(backupName ?? '')) throw fail('download', 'not_a_synthetic_backup');
  let about; try { about = await client.about(); } catch (e) { throw fail('identity', e.code ?? 'about_failed'); }
  if (about.user?.emailAddress?.toLowerCase() !== expectedAccount?.toLowerCase()) throw fail('identity', 'unexpected_identity');
  const names = { archive: `${backupName}.dump.enc`, checksum: `${backupName}.dump.enc.sha256`, manifest: `${backupName}.dump.enc.manifest.json` };
  const paths = {};
  for (const [kind, name] of Object.entries(names)) {
    let found; try { found = await client.findByName(folderId, name); } catch (e) { throw fail('download', e.code ?? 'find_failed'); }
    if (found.length !== 1) throw fail('download', found.length ? 'ambiguous_remote_file' : 'remote_file_missing');
    paths[kind] = join(dir, name);
    try { await client.downloadToFile(found[0].id, paths[kind]); } catch (e) { throw fail('download', e.code ?? 'download_failed'); }
  }
  const digest = await sha256(paths.archive);
  if ((await readFile(paths.checksum, 'utf8')) !== `${digest}  ${names.archive}\n`) throw fail('sha256', 'checksum_file_mismatch');
  const size = (await readFile(paths.archive)).length;
  try { assertManifestMatchesArchive(JSON.parse(await readFile(paths.manifest, 'utf8')), { name: names.archive, sha256: digest, sizeBytes: size }); }
  catch { throw fail('sha256', 'manifest_mismatch'); }
  return { ...paths, sha256: digest };
}

export async function negativeChecks({ archive, digest, restoreUrl, dir, env, makeClient = (token) => createDriveClient({ getAccessToken: async () => token, retries: 0 }) }) {
  // 1. wrong key: GCM authentication must refuse before anything touches the target
  const wrong = { ...env, BACKUP_GCM_KEY_B64: randomBytes(32).toString('base64') };
  let refused = false; try { restore([archive, digest, restoreUrl], wrong); } catch (e) { refused = e.message === 'decrypt_failed'; }
  if (!refused) throw fail('wrong_key_refused', 'wrong_key_accepted');
  // 2. tampered archive: the trusted checksum must no longer match
  const tampered = join(dir, 'tampered.dump.enc');
  await copyFile(archive, tampered);
  const bytes = await readFile(tampered); bytes[bytes.length - 1] ^= 0xff; await writeFile(tampered, bytes);
  refused = false; try { restore([tampered, digest, restoreUrl], env); } catch (e) { refused = e.message === 'decrypt_failed'; }
  if (!refused) throw fail('tamper_refused', 'tampered_archive_accepted');
  // 3. invalid access token: Drive must answer 401/403, mapped to "forbidden"
  refused = false; try { await makeClient('invalid-token-for-negative-test').about(); } catch (e) { refused = e.code === 'forbidden'; }
  if (!refused) throw fail('unauthorized_refused', 'invalid_token_not_refused');
}

export async function main(env = process.env, deps = {}) {
  const { GDRIVE_FOLDER_ID: folderId, GDRIVE_EXPECTED_ACCOUNT: expectedAccount, BACKUP_NAME: backupName, SOURCE_URL: sourceUrl, RESTORE_URL: restoreUrl } = env;
  if (!env.GDRIVE_ACCESS_TOKEN) throw fail('configuration', 'missing_access_token');
  if (!env.BACKUP_GCM_KEY_B64) throw fail('configuration', 'missing_key');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId ?? '')) throw fail('configuration', 'invalid_folder_id');
  assertDisposableTarget(sourceUrl); assertDisposableTarget(restoreUrl);
  if (sourceUrl === restoreUrl) throw fail('configuration', 'source_equals_target');
  const client = deps.client ?? createDriveClient({ getAccessToken: async () => env.GDRIVE_ACCESS_TOKEN });
  const dir = await mkdtemp(join(tmpdir(), 'gdrive03-verify-'));
  const report = [];
  const step = (name) => { report.push(name); console.log(`GDRIVE-03 ${name}: PASS`); };
  try {
    const set = await downloadAndVerifySet({ client, folderId, expectedAccount, backupName, dir });
    step('drive_download'); step('sha256_integrity');
    const before = fingerprint(sourceUrl, deps.run);
    await negativeChecks({ archive: set.archive, digest: set.sha256, restoreUrl, dir, env, makeClient: deps.makeClient });
    step('wrong_key_refused'); step('tamper_refused'); step('unauthorized_refused');
    try { restore([set.archive, set.sha256, restoreUrl], env); } catch (e) { throw fail('decrypt_restore', /^[a-z_]+$/.test(e.message) ? e.message : 'restore_failed'); }
    step('decrypt_and_restore');
    const after = fingerprint(restoreUrl, deps.run);
    if (before.length !== after.length || before.some((line, i) => line !== after[i])) throw fail('data_integrity', 'fingerprint_mismatch');
    step('data_integrity');
    console.log(`GDRIVE-03 CHAIN: PASS (${before.filter((l) => l.startsWith('table|')).length} tables, rows+content+schema identical)`);
    return report;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`GDRIVE-03 CHAIN: FAIL step=${e.step ?? 'unknown'} code=${/^[a-z_0-9]+$/.test(e.code ?? '') ? e.code : 'error'}`); process.exitCode = 1; });
}
