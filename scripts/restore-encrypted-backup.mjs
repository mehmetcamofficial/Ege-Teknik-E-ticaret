// H5-C: restore drill. Decrypts (checksum + GCM tag verified) and restores into a DISPOSABLE LOOPBACK PostgreSQL only.
// Usage: ARCHIVE TRUSTED_SHA256 TARGET_URL     env: BACKUP_GCM_KEY_B64 (never printed)
// Refuses non-loopback hosts, production-looking hosts and non-empty targets. pg_restore runs --exit-on-error --single-transaction,
// so a missing role or any error rolls back everything. Prints the measured restore time (labelled synthetic, not an RTO).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function assertDisposableTarget(raw) {
  let u; try { u = new URL(raw); } catch { throw Error('target_invalid'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw Error('target_invalid');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) throw Error('target_not_loopback');
  if (/neon|vercel|amazonaws|supabase/i.test(raw)) throw Error('target_not_loopback');
  return u;
}

export function restore([archive, sha, target, ...extra], env = process.env) {
  if (!archive || !/^[a-f0-9]{64}$/.test(sha ?? '') || !target || extra.length) throw Error('usage');
  const u = assertDisposableTarget(target);
  if (!env.BACKUP_GCM_KEY_B64) throw Error('missing_key');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const work = mkdtempSync(join(tmpdir(), 'ege-restore-'));
  const dump = join(work, 'restore.dump'), started = process.hrtime.bigint();
  try {
    const dec = spawnSync(process.execPath, [join(here, 'backup-decrypt.mjs'), resolve(archive), dump, sha], { env, stdio: 'pipe' });
    if (dec.status !== 0) throw Error('decrypt_failed');
    const penv = { ...env, PGPASSWORD: decodeURIComponent(u.password) };
    delete penv.BACKUP_GCM_KEY_B64;
    const args = ['--exit-on-error', '--single-transaction', '--no-password', '-h', u.hostname.replace(/[[\]]/g, ''), '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1), dump];
    const res = spawnSync('pg_restore', args, { env: penv, stdio: 'pipe' });
    if (res.status !== 0) throw Error('restore_failed');
    return { seconds: Number(process.hrtime.bigint() - started) / 1e9 };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const r = restore(process.argv.slice(2)); console.log(`RESTORE: PASS (synthetic drill, measured ${r.seconds.toFixed(2)}s; not an RTO claim)`); }
  catch (e) { console.error(`RESTORE: FAIL (${/^[a-z_]+$/.test(e.message) ? e.message : 'error'})`); process.exitCode = 1; }
}
