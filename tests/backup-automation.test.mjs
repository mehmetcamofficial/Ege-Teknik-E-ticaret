import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { uploadDrive } from '../scripts/backup-upload-drive.mjs';

const crypto = resolve('scripts/backup-crypto-gcm.mjs');
const recover = resolve('scripts/backup-decrypt.mjs');
const sha = b => createHash('sha256').update(b).digest('hex');
const cli = (script, args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8',
});
async function fixture(t, bytes = randomBytes(4096)) {
  const dir = await mkdtemp(join(tmpdir(), 'et-backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'input.dump'), enc = join(dir, 'archive.dump.enc'), key = randomBytes(32).toString('base64');
  await writeFile(input, bytes);
  assert.equal(cli(crypto, ['encrypt', input, enc], { BACKUP_GCM_KEY_B64: key }).status, 0);
  return { dir, input, enc, key, bytes, env: { BACKUP_GCM_KEY_B64: key } };
}
async function noPartials(dir) { assert.deepEqual((await readdir(dir)).filter(n => n.includes('.partial-')), []); }

test('ETGCM002 multi-megabyte streaming roundtrip and restrictive output permissions', async t => {
  const f = await fixture(t, randomBytes(3 * 1024 * 1024));
  assert.equal((await readFile(f.enc)).subarray(0, 8).toString(), 'ETGCM002');
  const output = join(f.dir, 'out');
  assert.equal(cli(crypto, ['decrypt', f.enc, output], f.env).status, 0);
  assert.deepEqual(await readFile(output), f.bytes);
  assert.equal((await stat(output)).mode & 0o777, 0o600); await noPartials(f.dir);
});
test('empty input is authenticated and recovers as empty', async t => {
  const f = await fixture(t, Buffer.alloc(0)), output = join(f.dir, 'empty');
  assert.equal(cli(crypto, ['decrypt', f.enc, output], f.env).status, 0);
  assert.equal((await stat(output)).size, 0);
});
test('wrong key leaves no plaintext or partial file', async t => {
  const f = await fixture(t), out = join(f.dir, 'wrong');
  assert.notEqual(cli(crypto, ['decrypt', f.enc, out], { BACKUP_GCM_KEY_B64: randomBytes(32).toString('base64') }).status, 0);
  await assert.rejects(stat(out), { code: 'ENOENT' }); await noPartials(f.dir);
});
test('header, nonce, ciphertext and tag corruption are rejected without plaintext', async t => {
  const f = await fixture(t), original = await readFile(f.enc);
  for (const offset of [0, 8, 20, original.length - 1]) {
    const b = Buffer.from(original); b[offset] ^= 1;
    const changed = join(f.dir, `bad-${offset}`), out = changed + '.out'; await writeFile(changed, b);
    assert.notEqual(cli(crypto, ['decrypt', changed, out], f.env).status, 0);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
  await noPartials(f.dir);
});
test('truncation is rejected and leaves no published plaintext', async t => {
  const f = await fixture(t), bytes = await readFile(f.enc);
  for (const length of [0, 7, 35, bytes.length - 1]) {
    const file = join(f.dir, `truncated-${length}`); await writeFile(file, bytes.subarray(0, length));
    assert.notEqual(cli(crypto, ['decrypt', file, file + '.out'], f.env).status, 0);
    await assert.rejects(stat(file + '.out'), { code: 'ENOENT' });
  }
  await noPartials(f.dir);
});
test('missing, malformed, noncanonical keys and extra CLI args fail closed', async t => {
  const f = await fixture(t);
  for (const key of ['', 'not-a-key', Buffer.alloc(32).toString('base64').slice(0, -2) + 'B=']) {
    assert.notEqual(cli(crypto, ['decrypt', f.enc, join(f.dir, 'out')], { BACKUP_GCM_KEY_B64: key }).status, 0);
  }
  assert.notEqual(cli(crypto, ['decrypt', f.enc, join(f.dir, 'out'), 'extra'], f.env).status, 0);
  await noPartials(f.dir);
});
test('existing output and same input/output are never overwritten', async t => {
  const f = await fixture(t), output = join(f.dir, 'existing'); await writeFile(output, 'keep');
  assert.notEqual(cli(crypto, ['decrypt', f.enc, output], f.env).status, 0);
  assert.equal(await readFile(output, 'utf8'), 'keep');
  assert.notEqual(cli(crypto, ['encrypt', f.input, f.input], f.env).status, 0);
  assert.deepEqual(await readFile(f.input), f.bytes); await noPartials(f.dir);
});
test('new decrypt wrapper verifies trusted checksum and does not downgrade damaged GCM to CBC', async t => {
  const f = await fixture(t), output = join(f.dir, 'wrapped'), bytes = await readFile(f.enc);
  assert.notEqual(cli(recover, [f.enc, output, '0'.repeat(64)], f.env).status, 0);
  assert.equal(cli(recover, [f.enc, output, sha(bytes)], f.env).status, 0);
  assert.deepEqual(await readFile(output), f.bytes);
  bytes[bytes.length - 1] ^= 1; const damaged = join(f.dir, 'damaged'); await writeFile(damaged, bytes);
  assert.notEqual(cli(recover, [damaged, output + '.bad', sha(bytes), '--allow-legacy-cbc'], { ...f.env, BACKUP_ENCRYPTION_PASSWORD: 'synthetic-only' }).status, 0);
  await noPartials(f.dir);
});
test('legacy CBC recovery requires explicit opt-in, trusted hash and original password', async t => {
  const f = await fixture(t), old = join(f.dir, 'legacy.enc'), output = join(f.dir, 'legacy.out');
  const pass = randomBytes(32).toString('hex'), env = { BACKUP_ENCRYPTION_PASSWORD: pass };
  const enc = spawnSync('openssl', ['enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '200000', '-in', f.input, '-out', old, '-pass', 'env:BACKUP_ENCRYPTION_PASSWORD'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  assert.equal(enc.status, 0); const checksum = sha(await readFile(old));
  assert.notEqual(cli(recover, [old, output, checksum], env).status, 0);
  const wrong = cli(recover, [old, output, checksum, '--allow-legacy-cbc'], { BACKUP_ENCRYPTION_PASSWORD: 'wrong' });
  // CBC is not authenticated: wrong passwords can rarely pass padding. They must
  // never recover the expected bytes; archive validation remains mandatory.
  if (wrong.status === 0) {
    assert.notDeepEqual(await readFile(output), f.bytes);
    await rm(output);
  }
  assert.equal(cli(recover, [old, output, checksum, '--allow-legacy-cbc'], env).status, 0);
  assert.deepEqual(await readFile(output), f.bytes);
  assert.notEqual(cli(recover, [old, output, checksum, '--allow-legacy-cbc'], env).status, 0);
  await noPartials(f.dir);
});

async function driveFixture(t, scenario = {}) {
  const f = await fixture(t), checksum = f.enc + '.sha256', metadata = f.enc + '.metadata.json';
  await writeFile(checksum, `${sha(await readFile(f.enc))}  ${basename(f.enc)}\n`);
  await writeFile(metadata, JSON.stringify({ format: 'ETGCM002', algorithm: 'AES-256-GCM', key_id: 'test-1', postgres_major: 18 }));
  const config = '[ege_teknik_backup]\ntype = drive\ntoken = {"access_token":"synthetic-token"}\n';
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: f.dir,
    RCLONE_CONFIG_B64: Buffer.from(config).toString('base64'), EGE_GDRIVE_FOLDER_ID: 'synthetic-folder-id',
    ENCRYPTED_FILE: f.enc, CHECKSUM_FILE: checksum, METADATA_FILE: metadata, BACKUP_GCM_KEY_B64: f.key };
  const calls = [], remote = new Map();
  const run = (args, childEnv) => {
    calls.push(args);
    assert.equal(childEnv.BACKUP_GCM_KEY_B64, undefined); assert.equal(childEnv.DATABASE_URL, undefined);
    assert.ok(args.includes('synthetic-folder-id'));
    if (scenario.transportError) throw Error('synthetic transport failure');
    if (args[0] === 'copyto') {
      if (args[1].startsWith('ege_teknik_backup:')) {
        const b = Buffer.from(remote.get(args[1])); if (scenario.corrupt) b[0] ^= 1;
        return writeFile(args[2], b); // Upload helper supports sync production and async test transport.
      }
      return readFile(args[1]).then(b => remote.set(args[2], b));
    }
    return '';
  };
  const request = async url => ({ ok: !scenario.httpError, json: async () => url.includes('/about?')
    ? { user: { emailAddress: scenario.wrongAccount ? 'wrong@example.test' : 'info@egeteknik.tr' } }
    : { id: 'synthetic-folder-id', mimeType: 'application/vnd.google-apps.folder', trashed: false,
      capabilities: { canAddChildren: !scenario.readOnly }, permissions: [{ type: scenario.public ? 'anyone' : 'user' }] } });
  return { ...f, env, deps: { run, request }, calls, remote };
}
for (const [name, scenario] of Object.entries({ 'wrong account': { wrongAccount: true }, 'public folder': { public: true }, 'read-only folder': { readOnly: true }, 'HTTP authorization error': { httpError: true }, 'transport error': { transportError: true } })) {
  test(`Drive refuses ${name} and cleans temporary OAuth config`, async t => {
    const f = await driveFixture(t, scenario); await assert.rejects(uploadDrive(f.env, f.deps));
    assert.equal(f.calls.filter(a => a[0] === 'copyto').length, 0);
    assert.deepEqual((await readdir(f.dir)).filter(n => n.startsWith('ege-drive-')), []);
  });
}
test('Drive mocked upload/download checks all three objects and leaves no temp OAuth config', async t => {
  const f = await driveFixture(t); const r = await uploadDrive(f.env, f.deps);
  assert.equal(r.status, 'PASS'); assert.equal(f.remote.size, 3);
  assert.equal(f.calls.filter(a => a[0] === 'copyto').length, 6);
  assert.ok(f.calls.filter(a => a[0] === 'copyto' && !a[1].startsWith('ege_teknik_backup:')).every(a => a.includes('--immutable')));
  assert.deepEqual((await readdir(f.dir)).filter(n => n.startsWith('ege-drive-')), []);
});
test('Drive corrupted downloaded object fails and temp files are removed', async t => {
  const f = await driveFixture(t, { corrupt: true }); await assert.rejects(uploadDrive(f.env, f.deps));
  assert.deepEqual((await readdir(f.dir)).filter(n => n.startsWith('ege-drive-')), []);
});
test('Drive missing config, folder, altered checksum or secret-bearing metadata refuses before provider calls', async t => {
  const f = await driveFixture(t);
  for (const patch of [{ RCLONE_CONFIG_B64: '' }, { EGE_GDRIVE_FOLDER_ID: '' }]) await assert.rejects(uploadDrive({ ...f.env, ...patch }, f.deps));
  await writeFile(f.env.CHECKSUM_FILE, '0'.repeat(64) + '  ' + basename(f.enc) + '\n');
  await assert.rejects(uploadDrive(f.env, f.deps));
  await writeFile(f.env.CHECKSUM_FILE, `${sha(await readFile(f.enc))}  ${basename(f.enc)}\n`);
  await writeFile(f.env.METADATA_FILE, JSON.stringify({ format: 'ETGCM002', secret: 'synthetic' }));
  await assert.rejects(uploadDrive(f.env, f.deps)); assert.equal(f.calls.length, 0);
});

test('workflow producer executes GCM self-check, retains ACL flags and cleans plaintext', async t => {
  const f = await fixture(t), bin = join(f.dir, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'pg_dump'), `#!/usr/bin/env bash\nset -eu\nif [[ "$*" == '--version' ]]; then echo 'pg_dump (PostgreSQL) 18.6'; exit; fi\n[[ "$PGDATABASE" == disposable && "$PGHOST" == 127.0.0.1 && "$PGUSER" == synthetic ]]\nfor ARG in "$@"; do case "$ARG" in --no-owner|--no-privileges) exit 90;; --file=*) FILE="\u0024{ARG#--file=}";; esac; done\nprintf 'PGDMP synthetic fixture' > "$FILE"\n`, { mode: 0o755 });
  await writeFile(join(bin, 'pg_restore'), `#!/usr/bin/env bash\nset -eu\nif [[ "$*" == '--version' ]]; then echo 'pg_restore (PostgreSQL) 18.6'; exit; fi\n[[ "$1" == '--list' ]]\n`, { mode: 0o755 });
  const output = join(f.dir, 'github-output');
  const env = { PATH: bin + ':' + process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: f.dir,
    GITHUB_OUTPUT: output, DATABASE_URL: 'postgresql://synthetic@127.0.0.1/disposable', BACKUP_GCM_KEY_B64: f.key, BACKUP_GCM_KEY_ID: 'test-1' };
  const run = spawnSync('bash', ['scripts/create-encrypted-backup.sh'], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const entries = Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(l => l.split('=')));
  assert.equal((await readFile(entries.encrypted_file)).subarray(0, 8).toString(), 'ETGCM002');
  await assert.rejects(stat(join(entries.backup_dir, 'source.dump')), { code: 'ENOENT' });
  await assert.rejects(stat(join(entries.backup_dir, 'check.dump')), { code: 'ENOENT' });
  assert.equal(cli(recover, [entries.encrypted_file, join(f.dir, 'producer-decrypt'), sha(await readFile(entries.encrypted_file))], f.env).status, 0);
  assert.equal(await readFile(join(f.dir, 'producer-decrypt'), 'utf8'), 'PGDMP synthetic fixture');
});
test('producer rejects missing key before running a database tool', async t => {
  const f = await fixture(t);
  const r = spawnSync('bash', ['scripts/create-encrypted-backup.sh'], { env: { PATH: process.env.PATH, DATABASE_URL: 'synthetic', RUNNER_TEMP: f.dir, GITHUB_OUTPUT: join(f.dir, 'o'), BACKUP_GCM_KEY_ID: 'id' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0); await assert.rejects(stat(join(f.dir, 'o')), { code: 'ENOENT' });
});

test('dump adapter preserves URI TLS fields, excludes credentials from argv and refuses unknown options', async t => {
  const f = await fixture(t), bin = join(f.dir, 'adapter-bin'); await mkdir(bin);
  await writeFile(join(bin, 'pg_dump'), `#!/usr/bin/env bash
set -eu
[[ "$PGHOST" == 127.0.0.1 && "$PGPORT" == 55432 && "$PGUSER" == test && "$PGPASSWORD" == 'p@ss' && "$PGDATABASE" == fixture ]]
[[ "$PGSSLMODE" == require && "$PGCHANNELBINDING" == require ]]
[[ "$*" != *postgresql* && "$*" != *p@ss* && -z "\${DATABASE_URL:-}" && -z "\${BACKUP_GCM_KEY_B64:-}" ]]
`, { mode: 0o755 });
  const adapter = resolve('scripts/backup-dump.mjs');
  const env = { PATH: bin + ':' + process.env.PATH, DATABASE_URL: 'postgresql://test:p%40ss@127.0.0.1:55432/fixture?sslmode=require&channel_binding=require' };
  assert.equal(cli(adapter, [join(f.dir, 'dump')], env).status, 0);
  assert.notEqual(cli(adapter, [join(f.dir, 'dump')], { ...env, DATABASE_URL: env.DATABASE_URL + '&unknown_option=bad' }).status, 0);
});
test('workflow gates backup on tests and scopes GCM and OAuth secrets to separate steps', async () => {
  const workflow = await readFile('.github/workflows/neon-production-backup.yml', 'utf8');
  assert.match(workflow, /needs: tests/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /backup:\n\s+if: \$\{\{ github.event_name != 'pull_request' \}\}/);
  assert.match(workflow, /notify-failure:/);
  assert.match(workflow, /postgresql-client-18/);
  assert.doesNotMatch(workflow, /BACKUP_ENCRYPTION_PASSWORD/);
  assert.doesNotMatch(workflow, /--no-owner|--no-privileges/);
  const drive = workflow.slice(workflow.indexOf('- name: Upload and verify Google Drive'), workflow.indexOf('- name: Optionally'));
  assert.doesNotMatch(drive, /BACKUP_GCM_KEY_B64|DATABASE_URL/);
  assert.match(drive, /EGE_GDRIVE_FOLDER_ID/);
});
