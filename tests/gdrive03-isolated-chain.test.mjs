// GDRIVE-03 isolated chain: static safety policy (always runs) + full local chain against a fake Drive (runs when a disposable
// loopback PostgreSQL 18 admin URL is provided in GDRIVE03_LOCAL_PG_ADMIN_URL; otherwise reported as skipped, never as passed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DriveError } from '../lib/backup/drive-client.mjs';
import { uploadBackupSet } from '../lib/backup/drive-upload.mjs';
import { main, fingerprint } from '../scripts/gdrive03-verify-restore.mjs';

const raw = await readFile('.github/workflows/gdrive03-isolated-chain.yml', 'utf8');
const w = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // comments are not behaviour

test('static: manual only, main only, own environment, nothing scheduled or pull-request driven', () => {
  assert.match(w, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(w, /pull_request|schedule:|push:|workflow_run|repository_dispatch/);
  assert.match(w, /github\.ref == 'refs\/heads\/main'/);
  assert.match(w, /environment: production-backup-test\b/);
  assert.match(w, /^permissions: \{\}$/m);
});

test('static: no secret of any kind and no production identifier can reach this workflow', () => {
  assert.doesNotMatch(w, /secrets\./);
  for (const forbidden of ['NEON_PRODUCTION', 'BACKUP_GCM_KEY_B64: ${{', 'BACKUP_ENABLED', 'GDRIVE_BACKUP_FOLDER_ID', 'GDRIVE_WIF_PROVIDER', 'GDRIVE_SERVICE_ACCOUNT', 'EGE_GDRIVE', 'production-backup\n', 'neon.tech', 'vercel']) {
    assert.ok(!w.includes(forbidden), `must not contain ${forbidden}`);
  }
  for (const needed of ['GDRIVE_TEST_WIF_PROVIDER', 'GDRIVE_TEST_SERVICE_ACCOUNT', 'GDRIVE_TEST_FOLDER_ID']) assert.ok(w.includes(`vars.${needed}`));
  assert.ok(!/vars\.(?!GDRIVE_TEST_)/.test(w), 'only GDRIVE_TEST_* variables may be read');
  assert.deepEqual([...new Set(w.match(/vars\.[A-Z_]+/g))].sort(), ['vars.GDRIVE_TEST_EVIDENCE_PUBKEY', 'vars.GDRIVE_TEST_FOLDER_EVIDENCE', 'vars.GDRIVE_TEST_FOLDER_ID', 'vars.GDRIVE_TEST_SERVICE_ACCOUNT', 'vars.GDRIVE_TEST_WIF_PROVIDER']);
  // evidence variables are public data (a signed document and a public key) and are handed to the upload step only
  const uploadStep = w.slice(w.indexOf('Upload to the Drive TEST folder'), w.indexOf('Download from Drive'));
  assert.ok(uploadStep.includes('vars.GDRIVE_TEST_FOLDER_EVIDENCE') && uploadStep.includes('vars.GDRIVE_TEST_EVIDENCE_PUBKEY'));
  assert.equal((w.match(/GDRIVE_TEST_(FOLDER_EVIDENCE|EVIDENCE_PUBKEY)/g) ?? []).length, 2);
});

test('static: databases are loopback and synthetic, key is generated and masked in-run, prefix is synthetic', () => {
  const urls = [...w.matchAll(/postgres(?:ql)?:\/\/[^\s"']+/g)].map((m) => m[0]);
  assert.ok(urls.length >= 2);
  for (const u of urls) assert.match(u, /@127\.0\.0\.1:5432\/gd03_(src|restore)$/);
  assert.match(w, /openssl rand -base64 32/);
  assert.ok(w.indexOf('::add-mask::') > -1 && w.indexOf('::add-mask::') < w.indexOf('GITHUB_ENV'));
  assert.match(w, /BACKUP_PREFIX: ege-teknik-synthetic/);
  assert.doesNotMatch(w, /upload-artifact|actions\/cache|set-output|echo "\$key"|echo "\$\{?key/);
});

test('static: id-token only on the one job, third-party actions pinned to SHAs, no delete of remote files', () => {
  assert.equal((w.match(/id-token: write/g) ?? []).length, 1);
  for (const m of w.matchAll(/uses: ([^\s@]+)@(\S+)/g)) assert.match(m[2], /^[0-9a-f]{40}$/, `${m[1]} must be pinned`);
  assert.doesNotMatch(w, /\bdelete\b|\brm -rf -- "\$\{\{ vars/);
});

test('static: seed fixture is synthetic and the verifier refuses non-loopback or equal databases', async () => {
  const seed = await readFile('tests/fixtures/gdrive03-synthetic-seed.sql', 'utf8');
  assert.doesNotMatch(seed, /@|\+90|iban|password|token/i);
  const base = { GDRIVE_ACCESS_TOKEN: 'x', BACKUP_GCM_KEY_B64: randomBytes(32).toString('base64'), GDRIVE_FOLDER_ID: 'a'.repeat(20), GDRIVE_EXPECTED_ACCOUNT: 'sa@example.invalid', BACKUP_NAME: 'ege-teknik-synthetic-x' };
  const local = 'postgresql://postgres:p@127.0.0.1:5432/a';
  await assert.rejects(main({ ...base, SOURCE_URL: 'postgresql://u:p@ep-x.neon.tech/db', RESTORE_URL: local }), /target_not_loopback/);
  await assert.rejects(main({ ...base, SOURCE_URL: local, RESTORE_URL: 'postgresql://u:p@db.example.com/db' }), /target_not_loopback/);
  await assert.rejects(main({ ...base, SOURCE_URL: local, RESTORE_URL: local }), /source_equals_target/);
});

// ---------------------------------------------------------------- full local chain with a fake Drive

const ADMIN = process.env.GDRIVE03_LOCAL_PG_ADMIN_URL;
const skip = ADMIN ? false : 'set GDRIVE03_LOCAL_PG_ADMIN_URL (disposable loopback PostgreSQL 18) to run the chain';

function fakeDrive(account) {
  const files = new Map();
  return {
    files,
    async about() { return { user: { emailAddress: account } }; },
    async getFolder(id) { return { id, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: true }, permissions: [{ type: 'user', role: 'writer' }] }; },
    async findByName(_f, name) { return [...files.entries()].filter(([, v]) => v.name === name).map(([id, v]) => ({ id, name: v.name })); },
    async uploadResumable(_f, name, path, { size }) { const id = `id-${files.size}`; files.set(id, { name, data: await readFile(path) }); return { id, name, size: String(size) }; },
    async downloadToFile(id, dest) { await writeFile(dest, files.get(id).data, { flag: 'wx' }); },
  };
}
const psql = (url, args) => { const u = new URL(url); return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--no-password', '-h', u.hostname, '-p', u.port, '-U', u.username, '-d', u.pathname.slice(1), ...args], { env: { PATH: process.env.PATH, PGPASSWORD: decodeURIComponent(u.password) }, encoding: 'utf8' }); };

test('chain (fake Drive): synthetic DB -> encrypt -> upload -> download -> sha256 -> decrypt -> restore -> identical fingerprint', { skip }, async () => {
  const id = randomBytes(4).toString('hex'), src = `gd03_src_${id}`, dst = `gd03_restore_${id}`;
  const at = (db) => ADMIN.replace(/\/[^/?]*$/, `/${db}`);
  const key = randomBytes(32).toString('base64'), account = 'gd03-test@example.invalid', folder = 'f'.repeat(24);
  const dir = await mkdtemp(join(tmpdir(), 'gd03-test-')), out = join(dir, 'out');
  await writeFile(out, '');
  try {
    assert.equal(psql(ADMIN, ['-c', `CREATE DATABASE ${src}`, '-c', `CREATE DATABASE ${dst}`]).status, 0);
    assert.equal(psql(at(src), ['-f', 'tests/fixtures/gdrive03-synthetic-seed.sql']).status, 0);
    const env = { ...process.env, DATABASE_URL: at(src), BACKUP_PREFIX: 'ege-teknik-synthetic', BACKUP_GCM_KEY_B64: key, BACKUP_GCM_KEY_ID: 'gdrive03-test', RUNNER_TEMP: dir, GITHUB_OUTPUT: out };
    const made = spawnSync('bash', ['scripts/create-verified-backup.sh'], { env, encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const o = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const drive = fakeDrive(account);
    await uploadBackupSet({ client: drive, folderId: folder, expectedAccount: account, files: { archive: o.encrypted_file, checksum: o.checksum_file, manifest: o.manifest_file }, workRoot: dir });

    const rawKey = key;
    const logs = []; const origLog = console.log; console.log = (m) => logs.push(m);
    const forbiddenToken = { about: async () => { throw new DriveError('forbidden', 401); } };
    let report; try {
      report = await main({ GDRIVE_ACCESS_TOKEN: 'tok', GDRIVE_FOLDER_ID: folder, GDRIVE_EXPECTED_ACCOUNT: account, BACKUP_NAME: o.backup_name, BACKUP_GCM_KEY_B64: key, SOURCE_URL: at(src), RESTORE_URL: at(dst), PATH: process.env.PATH, HOME: process.env.HOME },
        { client: drive, makeClient: () => forbiddenToken });
    } finally { console.log = origLog; }
    assert.deepEqual(report, ['drive_download', 'sha256_integrity', 'wrong_key_refused', 'tamper_refused', 'unauthorized_refused', 'decrypt_and_restore', 'data_integrity']);
    assert.ok(logs.some((l) => /CHAIN: PASS \(2 tables/.test(l)));
    assert.ok(!logs.join('\n').includes(rawKey) && !made.stdout.includes(rawKey) && !made.stderr.includes(rawKey), 'key must never be printed');
    assert.ok(fingerprint(at(dst)).some((l) => /^table\|gd03_orders\|2000\|/.test(l)));

    // a corrupted remote copy must be refused before any restore
    const [aid] = [...drive.files.entries()].find(([, v]) => v.name.endsWith('.dump.enc'));
    drive.files.get(aid).data[100] ^= 0xff;
    await assert.rejects(main({ GDRIVE_ACCESS_TOKEN: 'tok', GDRIVE_FOLDER_ID: folder, GDRIVE_EXPECTED_ACCOUNT: account, BACKUP_NAME: o.backup_name, BACKUP_GCM_KEY_B64: key, SOURCE_URL: at(src), RESTORE_URL: at(dst), PATH: process.env.PATH }, { client: drive, makeClient: () => forbiddenToken }), /checksum_file_mismatch/);
  } finally {
    psql(ADMIN, ['-c', `DROP DATABASE IF EXISTS ${src}`, '-c', `DROP DATABASE IF EXISTS ${dst}`]);
    await rm(dir, { recursive: true, force: true });
  }
});
