import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, copyFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildManifest, validateManifest } from '../lib/backup/manifest.mjs';
import { uploadBackupSet } from '../lib/backup/drive-upload.mjs';
import { planRetention, loadPolicy, executeRetentionPlan, AUTOMATIC_DELETION_ENABLED } from '../lib/backup/retention.mjs';
import { assertDisposableTarget } from '../scripts/restore-encrypted-backup.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const ACCOUNT = 'backup@ege-backup.iam.gserviceaccount.com', FOLDER = 'folderid1234567890';

async function makeSet(t) {
  const dir = await mkdtemp(join(tmpdir(), 'h5c-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const name = 'ege-teknik-synthetic-2026-10-22T01-30-00Z-k1-abcdef12.dump.enc';
  const archive = join(dir, name), body = Buffer.concat([Buffer.from('ETGCM002'), randomBytes(2048)]);
  await writeFile(archive, body);
  await writeFile(`${archive}.sha256`, `${sha(body)}  ${name}\n`);
  const manifest = buildManifest({ archiveName: name, sha256: sha(body), sizeBytes: body.length, keyId: 'k1', postgresMajor: 18, pgDumpVersion: 'pg_dump (PostgreSQL) 18.1', tocEntries: 10, tocSha256: sha('toc'), source: 'synthetic' });
  await writeFile(`${archive}.manifest.json`, JSON.stringify(manifest));
  return { dir, name, body, files: { archive, checksum: `${archive}.sha256`, manifest: `${archive}.manifest.json` } };
}
function fakeDrive(o = {}) {
  const store = new Map(), calls = [];
  const client = {
    calls, store,
    about: async () => ({ user: { emailAddress: o.account ?? ACCOUNT } }),
    getFolder: async (id) => ({ id, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: true }, driveId: 'shared-drive-1234567890', permissions: o.permissions ?? [{ type: 'user' }] }),
    listPermissions: async (id) => id === 'shared-drive-1234567890' ? (o.drivePermissions ?? [{ type: 'user' }]) : (o.permissions ?? [{ type: 'user' }]),
    findByName: async (_f, n) => (o.existing === n || store.has(n) ? [{ name: n }] : []),
    uploadResumable: async (_f, name, path, { size }) => {
      calls.push(name);
      if (o.failOn === name.split('.').pop()) throw new Error('boom');
      let data = await readFile(path); if (o.corrupt && name.endsWith('.enc')) { data = Buffer.from(data); data[20] ^= 1; }
      store.set(name, data); return { id: `id-${name}`, name, size: String(size), md5Checksum: createHash('md5').update(await readFile(path)).digest('hex') };
    },
    downloadToFile: async (id, dest) => { await writeFile(dest, store.get(id.slice(3)), { flag: 'wx' }); },
  };
  return client;
}
const up = (c, s, extra = {}) => uploadBackupSet({ client: c, folderId: FOLDER, expectedAccount: ACCOUNT, files: s.files, workRoot: s.dir, ...extra });

test('fake Drive: full set uploads, manifest last, every file verified', async (t) => {
  const s = await makeSet(t), c = fakeDrive(), r = await up(c, s);
  assert.equal(r.status, 'PASS'); assert.equal(r.files, 3);
  assert.deepEqual(c.calls.map((n) => n.replace(s.name, 'A')), ['A', 'A.sha256', 'A.manifest.json']);
});
test('fake Drive: corrupted upload is detected and never PASS', async (t) => {
  const s = await makeSet(t);
  await assert.rejects(up(fakeDrive({ corrupt: true }), s), (e) => /md5|sha256/.test(e.code) || e.code === 'roundtrip_sha256_mismatch');
});
test('fake Drive: partial failure leaves no commit marker and reports uploaded names', async (t) => {
  const s = await makeSet(t), c = fakeDrive({ failOn: 'json' });
  await assert.rejects(up(c, s), (e) => e.code === 'upload_failed:manifest' && e.uploaded.length === 2 && e.manifestUploaded === false);
});
test('fake Drive: existing name is never overwritten', async (t) => {
  const s = await makeSet(t), c = fakeDrive({ existing: s.name });
  await assert.rejects(up(c, s), { code: 'refusing_to_overwrite' }); assert.equal(c.calls.length, 0);
});
test('fake Drive: wrong account and publicly shared folder are refused before upload', async (t) => {
  const s = await makeSet(t);
  for (const [o, code] of [[{ account: 'other@x.com' }, 'unexpected_identity'], [{ permissions: [{ type: 'anyone' }] }, 'folder_is_shared_publicly'], [{ permissions: [{ type: 'domain' }] }, 'folder_is_shared_publicly']]) {
    const c = fakeDrive(o); await assert.rejects(up(c, s), { code }); assert.equal(c.calls.length, 0);
  }
});
test('fake Drive: publicly shared Shared Drive or unavailable permissions fail closed', async (t) => {
  const s = await makeSet(t);
  for (const [o, code] of [
    [{ drivePermissions: [{ type: 'domain' }] }, 'folder_is_shared_publicly'],
    [{ drivePermissions: [] }, 'folder_permissions_unavailable'],
    [{ permissions: [] }, 'folder_permissions_unavailable'],
  ]) {
    const c = fakeDrive(o);
    await assert.rejects(up(c, s), { code });
    assert.equal(c.calls.length, 0);
  }
});
test('fake Drive: checksum file mismatch and non-authenticated archive are refused', async (t) => {
  const s = await makeSet(t); await writeFile(s.files.checksum, `${'0'.repeat(64)}  ${s.name}\n`);
  await assert.rejects(up(fakeDrive(), s), { code: 'checksum_file_mismatch' });
  const s2 = await makeSet(t); await writeFile(s2.files.archive, 'Salted__x');
  await assert.rejects(up(fakeDrive(), s2), { code: 'not_an_authenticated_archive' });
});
test('Drive client exposes no delete / trash / share methods', async () => {
  const { createDriveClient } = await import('../lib/backup/drive-client.mjs');
  const keys = Object.keys(createDriveClient({ getAccessToken: async () => 't' }));
  assert.deepEqual(keys.sort(), ['about', 'downloadToFile', 'findByName', 'getFolder', 'listChildren', 'listPermissions', 'uploadResumable']);
});

test('Drive permission reader paginates and refuses empty or unavailable lists', async () => {
  const { createDriveClient } = await import('../lib/backup/drive-client.mjs');
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const u = new URL(url);
    if (u.searchParams.get('pageToken') === 'next') return { status: 200, json: async () => ({ permissions: [{ type: 'user', role: 'writer' }] }) };
    return { status: 200, json: async () => ({ permissions: [{ type: 'user', role: 'organizer' }], nextPageToken: 'next' }) };
  };
  const client = createDriveClient({ getAccessToken: async () => 'fake', fetchImpl });
  assert.equal((await client.listPermissions('folderid1234567890')).length, 2);
  assert.equal(seen.length, 2);
  const empty = createDriveClient({ getAccessToken: async () => 'fake', fetchImpl: async () => ({ status: 200, json: async () => ({ permissions: [] }) }) });
  await assert.rejects(empty.listPermissions('folderid1234567890'), { code: 'permissions_unavailable' });
});

test('manifest rejects secret-shaped content and wrong postgres major', async (t) => {
  const s = await makeSet(t), m = JSON.parse(await readFile(s.files.manifest, 'utf8'));
  validateManifest(m);
  assert.throws(() => validateManifest({ ...m, extra: 'postgres://u:p@h/db' }));
  assert.throws(() => validateManifest({ ...m, database: { ...m.database, postgres_major: 16 } }));
});

test('retention is report-only and automatic deletion cannot be switched on', () => {
  assert.equal(AUTOMATIC_DELETION_ENABLED, false);
  assert.throws(() => executeRetentionPlan(), { code: 'automatic_deletion_disabled' });
  const now = new Date('2026-10-22T00:00:00Z'), listing = [];
  for (let d = 0; d < 90; d++) listing.push({ name: `ege-teknik-production-${new Date(now - d * 864e5).toISOString().replace(/:/g, '-').slice(0, 19)}Z-k1-abcdef12.dump.enc`, createdAt: new Date(now - d * 864e5).toISOString() });
  listing.push({ name: 'notes.txt', createdAt: '2020-01-01T00:00:00Z' });
  const p = planRetention(listing, loadPolicy({ BACKUP_RETENTION_DAILY: '30' }), now);
  assert.equal(p.mode, 'report-only'); assert.equal(p.automaticDeletionEnabled, false);
  assert.ok(p.candidates.length > 0); assert.ok(p.keep.length >= 7);
  assert.ok(!p.candidates.some((c) => (c.name ?? c) === 'notes.txt'));
  assert.throws(() => loadPolicy({ BACKUP_RETENTION_MIN_KEEP: '0' }), { code: 'invalid_policy' });
});

test('restore refuses non-loopback and production-looking targets', () => {
  for (const bad of ['postgres://u:p@ep-x.neon.tech/db', 'postgres://u:p@10.0.0.5/db', 'postgres://u:p@db.example.com/db', 'mysql://127.0.0.1/db', 'nope'])
    assert.throws(() => assertDisposableTarget(bad));
  assert.doesNotThrow(() => assertDisposableTarget('postgres://u:p@127.0.0.1:55490/postgres'));
});
test('restore CLI: wrong key and corrupted archive fail before touching any database', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'h5c-r-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const key = randomBytes(32).toString('base64'), src = join(dir, 'a.dump'), enc = join(dir, 'a.dump.enc');
  await writeFile(src, randomBytes(4096));
  assert.equal(spawnSync(process.execPath, ['scripts/backup-crypto-gcm.mjs', 'encrypt', src, enc], { env: { PATH: process.env.PATH, BACKUP_GCM_KEY_B64: key } }).status, 0);
  const run = (file, k) => spawnSync(process.execPath, ['scripts/restore-encrypted-backup.mjs', file, sha(require_sync(file)), 'postgres://u:p@127.0.0.1:1/x'], { env: { PATH: process.env.PATH, BACKUP_GCM_KEY_B64: k }, encoding: 'utf8' });
  const wrong = run(enc, randomBytes(32).toString('base64')); assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /decrypt_failed/);
  const bad = join(dir, 'bad.dump.enc'); await copyFile(enc, bad); const b = (await readFile(bad)); b[100] ^= 1; await writeFile(bad, b);
  const corrupt = run(bad, key); assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /decrypt_failed/);
  assert.ok(!(wrong.stdout + wrong.stderr + corrupt.stdout + corrupt.stderr).includes(key));
});
import { readFileSync } from 'node:fs';
function require_sync(f) { return readFileSync(f); }

test('workflow policy: no artifacts, pinned actions, gated backup job, secrets only there', async () => {
  const w = await readFile('.github/workflows/production-db-backup.yml', 'utf8');
  assert.match(w, /^permissions: \{\}$/m);
  assert.ok(!/upload-artifact|pull_request_target/.test(w));
  assert.match(w, /^  schedule:\n    - cron: "30 1 \* \* \*"$/m, 'daily backup schedule must be explicit');
  for (const m of w.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `unpinned action ${m[1]}`);
  const [head, rest] = w.split(/^  backup:$/m);
  assert.ok(!/secrets\./.test(head), 'tests job must not see secrets');
  assert.match(rest, /github\.ref == 'refs\/heads\/main'/); assert.match(rest, /vars\.BACKUP_ENABLED == 'true'/);
  assert.match(rest, /environment: production-backup/); assert.match(rest, /id-token: write/);
  assert.ok(!/id-token: write/.test(head));
  assert.ok(!/rclone|--delete|files\.delete|\.trash/.test(w));
});
test('scripts never print secret variables', async () => {
  for (const f of ['scripts/create-verified-backup.sh', 'scripts/backup-drive-upload.mjs', 'scripts/restore-encrypted-backup.mjs']) {
    const s = await readFile(f, 'utf8');
    assert.ok(!/echo[^\n]*(KEY_B64|DATABASE_URL|ACCESS_TOKEN)|console\.\w+\([^\n]*(env\.\w*(KEY|TOKEN|DATABASE)|process\.env\.\w*(KEY|TOKEN|DATABASE))/.test(s), f);
  }
});

test('Production Drive upload uses live permissions, not expiring signed evidence', async () => {
  const w = await readFile('.github/workflows/production-db-backup.yml', 'utf8');
  const [beforeBackup, backup] = w.split(/^  backup:$/m);
  const upload = backup.split('      - name: Upload to Drive and verify the uploaded copy')[1]?.split('      - name: Retention report')[0];
  assert.ok(upload, 'Drive upload step must exist');
  assert.doesNotMatch(upload, /GDRIVE_FOLDER_EVIDENCE|GDRIVE_EVIDENCE_PUBKEY/);
  assert.ok(!beforeBackup.includes('GDRIVE_FOLDER_EVIDENCE'));
  assert.ok(upload.includes('run: node scripts/backup-drive-upload.mjs'));
});

test('Production backup alert has an issue fallback when the label is unavailable', async () => {
  const w = await readFile('.github/workflows/production-db-backup.yml', 'utf8');
  const alert = w.split(/^  alert:$/m)[1];
  assert.ok(alert, 'alert job must exist');
  assert.ok(alert.includes('issues: write'));
  assert.ok(alert.includes('gh label create backup-failure'));
  assert.ok(alert.includes('if ! gh issue create'));
  assert.ok(alert.includes('--label backup-failure'));
  assert.ok(alert.includes('then\n            gh issue create'));
  assert.ok(alert.includes('No successful backup was recorded'));
});

// ---------------------------------------------------------------- backup role attestation (secret-free; fake psql / pg_dump / pg_restore)

const SECRET_URL = 'postgresql://backup_reader_ro:S3cr3t%40pw@ep-private-host.example.neon.tech:5432/neondb?sslmode=require&channel_binding=require';
async function attestBin(t, psqlBody) {
  const dir = await mkdtemp(join(tmpdir(), 'et-attest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); await mkdir(bin);
  // psql prints 't' only when the SQL names the role the connection really has (PGUSER); the SQL is checked, never the URL.
  await writeFile(join(bin, 'psql'), `#!/usr/bin/env bash\nset -u\n${psqlBody}\n`, { mode: 0o755 });
  await writeFile(join(bin, 'pg_dump'), `#!/usr/bin/env bash\nset -eu\nif [[ "$*" == '--version' ]]; then echo 'pg_dump (PostgreSQL) 18.6'; exit; fi\nfor A in "$@"; do case "$A" in --file=*) F="\${A#--file=}";; esac; done\nprintf 'PGDMP fixture %0200d' 0 > "$F"\ntouch "${dir}/pg_dump_ran"\n`, { mode: 0o755 });
  await writeFile(join(bin, 'pg_restore'), `#!/usr/bin/env bash\nset -eu\nif [[ "$*" == '--version' ]]; then echo 'pg_restore (PostgreSQL) 18.6'; exit; fi\nprintf '1; 0 0 TABLE public x o\\n'\n`, { mode: 0o755 });
  return { dir, bin, PATH: bin + ':' + process.env.PATH };
}
const REAL_ROLE_PSQL = `[[ "$PGUSER" == "backup_reader_ro" && "$*" == *"current_user = 'backup_reader_ro' AND session_user = 'backup_reader_ro'"* ]] && echo t || echo f`;
const dumpRun = (b, env) => spawnSync(process.execPath, [resolve('scripts/backup-dump.mjs'), join(b.dir, 'out.dump')], { env: { PATH: b.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8' });
const leaks = (r) => [SECRET_URL, 'S3cr3t', 'ep-private-host', 'neon.tech', 'backup_reader_ro:'].filter((x) => (r.stdout + r.stderr).includes(x));

test('attestation: correct role -> PASS, dump runs, only the fixed line is logged, URL never in argv', async (t) => {
  const b = await attestBin(t, `[[ "$*" != *postgresql* && "$*" != *S3cr3t* && "$PGSSLMODE" == require && "$PGCHANNELBINDING" == require && "$PGHOST" == ep-private-host.example.neon.tech ]] || exit 7\n${REAL_ROLE_PSQL}`);
  const r = dumpRun(b, { DATABASE_URL: SECRET_URL, BACKUP_EXPECTED_ROLE: 'backup_reader_ro' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'BACKUP ROLE ATTESTATION: PASS'); assert.equal(r.stderr, '');
  assert.deepEqual(leaks(r), []);
  assert.equal((await readdir(b.dir)).includes('pg_dump_ran'), true);
});
for (const [name, user, body] of [
  ['old backup_reader', 'backup_reader', null], ['unexpected other role', 'neondb_owner', null],
  ['current_user differs from session_user', 'backup_reader_ro', `echo f`], ['connection error', 'backup_reader_ro', `echo 'FATAL: password for ep-private-host' >&2; exit 2`],
  ['unexpected psql output', 'backup_reader_ro', `echo 'true'`], ['psql missing', null, null],
]) {
  test(`attestation: ${name} -> BLOCKED before any dump, nothing leaked`, async (t) => {
    const b = await attestBin(t, body ?? REAL_ROLE_PSQL);
    if (name === 'psql missing') await rm(join(b.bin, 'psql'));
    const url = SECRET_URL.replace('postgresql://backup_reader_ro:', `postgresql://${user ?? 'backup_reader_ro'}:`);
    const r = dumpRun(b, { DATABASE_URL: url, BACKUP_EXPECTED_ROLE: 'backup_reader_ro', PATH: name === 'psql missing' ? b.bin + ':/usr/bin:/bin' : b.PATH });
    assert.notEqual(r.status, 0); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim(), 'BACKUP ROLE ATTESTATION: BLOCKED');
    assert.deepEqual(leaks(r), []); assert.equal((await readdir(b.dir)).includes('pg_dump_ran'), false, 'pg_dump must not start');
  });
}
test('attestation: empty or malformed expected role is BLOCKED (no SQL injection through the role name)', async (t) => {
  const b = await attestBin(t, `echo t`);
  for (const role of ['', "x' OR '1'='1", 'Backup_Reader', 'a b']) {
    const r = dumpRun(b, { DATABASE_URL: SECRET_URL, BACKUP_EXPECTED_ROLE: role });
    assert.notEqual(r.status, 0, role); assert.equal(r.stderr.trim(), 'BACKUP ROLE ATTESTATION: BLOCKED');
  }
});
test('attestation: without BACKUP_EXPECTED_ROLE the adapter behaves exactly as before (no psql call, no attestation line)', async (t) => {
  const b = await attestBin(t, `exit 99`);
  const r = dumpRun(b, { DATABASE_URL: SECRET_URL });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '');
});
async function verifiedRun(t, { prefix, expected, psqlBody }) {
  const b = await attestBin(t, psqlBody);
  const env = { PATH: b.PATH, HOME: process.env.HOME, RUNNER_TEMP: b.dir, GITHUB_OUTPUT: join(b.dir, 'out'), DATABASE_URL: SECRET_URL,
    BACKUP_GCM_KEY_B64: randomBytes(32).toString('base64'), BACKUP_GCM_KEY_ID: 'test-1' };
  if (prefix) env.BACKUP_PREFIX = prefix;
  if (expected !== undefined) env.BACKUP_EXPECTED_ROLE = expected;
  await writeFile(env.GITHUB_OUTPUT, '');
  return { b, r: spawnSync('bash', [resolve('scripts/create-verified-backup.sh')], { env, encoding: 'utf8', cwd: resolve('.') }) };
}
test('verified backup, production prefix: role is forced to backup_reader_ro even if the environment says otherwise', async (t) => {
  const ok = await verifiedRun(t, { expected: 'backup_reader', psqlBody: REAL_ROLE_PSQL });
  assert.equal(ok.r.status, 0, ok.r.stderr); assert.match(ok.r.stdout, /^BACKUP ROLE ATTESTATION: PASS$/m); assert.deepEqual(leaks(ok.r), []);
  const bad = await verifiedRun(t, { psqlBody: `echo f` });
  assert.notEqual(bad.r.status, 0); assert.match(bad.r.stderr, /BACKUP ROLE ATTESTATION: BLOCKED/); assert.equal((await readdir(bad.b.dir)).includes('pg_dump_ran'), false);
  assert.equal((await readFile(join(bad.b.dir, 'out'), 'utf8')).includes('encrypted_file'), false, 'no backup output is produced');
});
test('verified backup, synthetic prefix: test sources are not forced to the Production role', async (t) => {
  const { r } = await verifiedRun(t, { prefix: 'ege-teknik-synthetic', psqlBody: `exit 99` });
  assert.equal(r.status, 0, r.stderr); assert.ok(!r.stdout.includes('ATTESTATION'));
});
test('production workflow cannot downgrade the check: it never sets the synthetic prefix or a role override', async () => {
  const w = await readFile('.github/workflows/production-db-backup.yml', 'utf8');
  const backup = w.split(/^  backup:$/m)[1];
  assert.ok(!/BACKUP_PREFIX|BACKUP_EXPECTED_ROLE/.test(backup));
  assert.ok(!/backup-dump\.mjs|pg_dump/.test(w), 'Production must reach the dump only through create-verified-backup.sh');
  assert.match(backup, /run: bash scripts\/create-verified-backup\.sh/);
  const s = await readFile('scripts/create-verified-backup.sh', 'utf8');
  assert.match(s, /\[\[ "\$BACKUP_PREFIX" == "ege-teknik-production" \]\]; then export BACKUP_EXPECTED_ROLE="backup_reader_ro"/);
});
