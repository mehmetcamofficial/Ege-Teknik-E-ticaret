// GDRIVE-03 folder safety: a MISSING permission list (Shared Drive, non-sharing caller) is told apart from a PUBLIC folder; unknown is never
// accepted without verified administrator evidence; anyone/domain is always refused. No network, no Drive, no secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessFolderSafety, canonicalJson, EVIDENCE_MAX_AGE_MS } from '../lib/backup/drive-folder-safety.mjs';
import { uploadBackupSet } from '../lib/backup/drive-upload.mjs';
import { buildManifest } from '../lib/backup/manifest.mjs';
import { collectEvidence, signEvidence, main as adminMain } from '../scripts/gdrive03-admin-folder-evidence.mjs';

const FOLDER = 'F'.repeat(24), DRIVE = '0AAbCdEfGhIjKlUk9PVA', SA = 'gdrive03-test@example.invalid';
const NOW = new Date('2026-10-22T12:00:00.000Z');
const keys = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };
const K = keys(), OTHER = keys();
const evidence = (over = {}, findings = {}) => ({ kind: 'gdrive03-folder-evidence', version: 1, folder_id: FOLDER, drive_id: DRIVE, observed_at: NOW.toISOString(), service_account_role: 'writer',
  findings: { folder_anyone: false, folder_domain: false, drive_anyone: false, drive_domain: false, ...findings }, summary: {}, ...over });
const signed = (e, key = K.priv) => signEvidence(e, key);
const sharedDriveFolder = (extra = {}) => ({ id: FOLDER, driveId: DRIVE, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: true }, ...extra });
const assess = (folder, evidenceB64, publicKeyPem = K.pub, now = NOW) => assessFolderSafety(folder, { evidenceB64, publicKeyPem, now });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'NO_ERROR'; };

test('API permission list present: restricted sharing (user/group, direct or inherited) is accepted', () => {
  const perms = [{ type: 'user', role: 'owner' }, { type: 'group', role: 'writer' }, { type: 'user', role: 'writer', permissionDetails: [{ inherited: true }] }];
  assert.deepEqual(assess({ id: FOLDER, permissions: perms }, undefined), { basis: 'api_permissions' });
});

test('API permission list present: anyone or domain is always refused as publicly shared, even with valid private-looking evidence', () => {
  const good = signed(evidence());
  for (const bad of [{ type: 'anyone', role: 'reader' }, { type: 'domain', role: 'reader' }]) {
    const f = sharedDriveFolder({ permissions: [{ type: 'user', role: 'writer' }, bad] });
    assert.equal(code(() => assess(f, undefined)), 'folder_is_shared_publicly');
    assert.equal(code(() => assess(f, good)), 'folder_is_shared_publicly'); // evidence can never override what the API itself lists
  }
  const inheritedAnyone = sharedDriveFolder({ permissions: [{ type: 'anyone', role: 'reader', permissionDetails: [{ inherited: true }] }] });
  assert.equal(code(() => assess(inheritedAnyone, undefined)), 'folder_is_shared_publicly');
});

test('MISSING permission list (Shared Drive folder) is "unknown", NOT public, and is refused without evidence', () => {
  for (const permissions of [undefined, null, [], 'x']) {
    const c = code(() => assess(sharedDriveFolder({ permissions }), undefined));
    assert.equal(c, 'folder_permissions_unavailable');
    assert.notEqual(c, 'folder_is_shared_publicly');
  }
  assert.equal(code(() => assess(sharedDriveFolder(), signed(evidence()), '')), 'folder_permissions_unavailable'); // no trust anchor configured
});

test('MISSING permission list + valid administrator evidence is accepted', () => {
  assert.deepEqual(assess(sharedDriveFolder(), signed(evidence())), { basis: 'admin_evidence' });
});

test('evidence that does not verify is refused with its own codes', () => {
  const e = evidence();
  const ok = signed(e);
  const decoded = JSON.parse(Buffer.from(ok, 'base64').toString());
  const forge = (mutate) => { const c = JSON.parse(JSON.stringify(decoded)); mutate(c); return Buffer.from(JSON.stringify(c)).toString('base64'); };
  const cases = [
    ['signed by another key', signed(e, OTHER.priv), 'folder_evidence_invalid'],
    ['content edited after signing', forge((c) => { c.evidence.findings.folder_anyone = false; c.evidence.drive_id = '0Bother'; }), 'folder_evidence_invalid'],
    ['signature removed', Buffer.from(JSON.stringify({ evidence: e })).toString('base64'), 'folder_evidence_invalid'],
    ['not base64 json', 'bm90IGpzb24=', 'folder_evidence_invalid'],
    ['garbage', '%%%', 'folder_evidence_invalid'],
    ['wrong kind', signed(evidence({ kind: 'other' })), 'folder_evidence_invalid'],
    ['wrong version', signed(evidence({ version: 2 })), 'folder_evidence_invalid'],
    ['other folder', signed(evidence({ folder_id: 'G'.repeat(24) })), 'folder_evidence_mismatch'],
    ['other shared drive', signed(evidence({ drive_id: '0Bother0000000000' })), 'folder_evidence_mismatch'],
    ['service account is not a plain contributor', signed(evidence({ service_account_role: 'fileOrganizer' })), 'folder_evidence_invalid'],
    ['service account role missing', signed(evidence({ service_account_role: undefined })), 'folder_evidence_invalid'],
    ['expired', signed(evidence({ observed_at: new Date(NOW.getTime() - EVIDENCE_MAX_AGE_MS - 1000).toISOString() })), 'folder_evidence_expired'],
    ['dated in the future', signed(evidence({ observed_at: new Date(NOW.getTime() + 3600_000).toISOString() })), 'folder_evidence_invalid'],
    ['findings missing', signed(evidence({ findings: undefined })), 'folder_evidence_invalid'],
    ['a finding is null, not false', signed(evidence({}, { drive_domain: null })), 'folder_evidence_invalid'],
    ['a finding is the string "false"', signed(evidence({}, { folder_anyone: 'false' })), 'folder_evidence_invalid'],
    ['a finding is absent', signed(evidence({ findings: { folder_anyone: false, folder_domain: false, drive_anyone: false } })), 'folder_evidence_invalid'],
  ];
  for (const [name, b64, expected] of cases) assert.equal(code(() => assess(sharedDriveFolder(), b64)), expected, name);
  assert.equal(code(() => assess({ ...sharedDriveFolder(), driveId: undefined }, ok)), 'folder_evidence_mismatch'); // folder is not in the drive the evidence names
  assert.equal(code(() => assess(sharedDriveFolder(), ok, OTHER.pub)), 'folder_evidence_invalid'); // wrong trust anchor
});

test('verified evidence that reports sharing is refused as publicly shared: folder or Shared Drive, anyone or domain, direct or inherited', () => {
  for (const flag of ['folder_anyone', 'folder_domain', 'drive_anyone', 'drive_domain']) {
    assert.equal(code(() => assess(sharedDriveFolder(), signed(evidence({}, { [flag]: true })))), 'folder_is_shared_publicly', flag);
  }
});

test('canonical JSON is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }), canonicalJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
});

// ---------------------------------------------------------------- administrator script (fake HTTP, GET only)

function fakeGoogle({ folder, folderPerms, drivePerms, drive = { id: DRIVE, restrictions: { domainUsersOnly: true, driveMembersOnly: false } }, pages = false, status } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, auth: init.headers?.authorization });
    const u = new URL(url), p = decodeURIComponent(u.pathname.replace('/drive/v3', ''));
    const respond = (body, s = status ?? 200) => ({ status: s, json: async () => body });
    if (p === `/files/${FOLDER}`) return respond(folder ?? { id: FOLDER, mimeType: 'application/vnd.google-apps.folder', trashed: false, driveId: DRIVE, capabilities: { canShare: true } });
    if (p === `/files/${FOLDER}/permissions`) {
      const list = folderPerms ?? [{ type: 'user', role: 'writer', emailAddress: SA }, { type: 'group', role: 'organizer', permissionDetails: [{ inherited: true }] }];
      if (pages && !u.searchParams.get('pageToken')) return respond({ permissions: list.slice(0, 1), nextPageToken: 't2' });
      return respond({ permissions: pages ? list.slice(1) : list });
    }
    if (p === `/files/${DRIVE}/permissions`) return respond({ permissions: drivePerms ?? [{ type: 'group', role: 'organizer' }, { type: 'user', role: 'writer', emailAddress: SA }] });
    if (p === `/drives/${DRIVE}`) return respond(drive);
    return respond({}, 404);
  };
  return { fetchImpl, calls };
}
const collect = (g, over = {}) => collectEvidence({ token: 'ADMIN-TOKEN-VALUE', folderId: FOLDER, serviceAccount: SA, fetchImpl: g.fetchImpl, now: NOW, ...over });

test('admin script: restricted folder and drive -> all findings false, only counts (no e-mail, no token), GET requests only', async () => {
  const g = fakeGoogle({ pages: true });
  const e = await collect(g);
  assert.deepEqual(e.findings, { folder_anyone: false, folder_domain: false, drive_anyone: false, drive_domain: false });
  assert.equal(e.service_account_role, 'writer');
  assert.equal(e.summary.folder_permissions.inherited, 1);
  assert.equal(e.summary.drive_restrictions.domain_users_only, true);
  const text = JSON.stringify(e);
  assert.ok(!text.includes('ADMIN-TOKEN-VALUE') && !text.includes('@'), 'no token and no e-mail address in the document');
  assert.ok(g.calls.every((c) => c.method === 'GET'));
  assert.ok(g.calls.some((c) => /pageToken=t2/.test(c.url)), 'follows pagination');
  assert.deepEqual(assess(sharedDriveFolder(), signed(e)), { basis: 'admin_evidence' }); // end to end: collected evidence passes the job check
});

test('admin script: anyone / domain on the folder or on the Shared Drive (including inherited) are reported, and the job then refuses', async () => {
  const mine = { type: 'user', role: 'writer', emailAddress: SA };
  const scenarios = [
    ['folder anyone (direct)', { folderPerms: [mine, { type: 'anyone', role: 'reader' }] }, 'folder_anyone'],
    ['folder domain (inherited)', { folderPerms: [mine, { type: 'domain', role: 'reader', permissionDetails: [{ inherited: true }] }] }, 'folder_domain'],
    ['drive anyone', { drivePerms: [{ type: 'anyone', role: 'reader' }] }, 'drive_anyone'],
    ['drive domain', { drivePerms: [{ type: 'domain', role: 'reader' }] }, 'drive_domain'],
  ];
  for (const [name, setup, flag] of scenarios) {
    const e = await collect(fakeGoogle(setup));
    assert.equal(e.findings[flag], true, name);
    assert.equal(code(() => assess(sharedDriveFolder(), signed(e))), 'folder_is_shared_publicly', name);
  }
});

test('admin script refuses to produce evidence it cannot stand behind', async () => {
  const rej = (g, c, over) => assert.rejects(collect(g, over), { code: c });
  await rej(fakeGoogle({ folder: { id: FOLDER, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canShare: true } } }), 'not_in_a_shared_drive');
  await rej(fakeGoogle({ folder: { id: FOLDER, mimeType: 'application/vnd.google-apps.folder', trashed: false, driveId: DRIVE, capabilities: { canShare: false } } }), 'caller_cannot_read_permissions');
  await rej(fakeGoogle({ folder: { id: FOLDER, mimeType: 'text/plain', trashed: false, driveId: DRIVE, capabilities: { canShare: true } } }), 'unsafe_folder');
  await rej(fakeGoogle({ folderPerms: [{ type: 'group', role: 'organizer' }] }), 'service_account_not_listed_on_folder');
  await rej(fakeGoogle({ status: 403 }), 'forbidden');
  await rej(fakeGoogle(), 'missing_admin_token', { token: '' });
  await rej(fakeGoogle(), 'invalid_folder_id', { folderId: '../x' });
});

test('admin script CLI: collect signs, exits 2 on sharing, prints no token; verify round trip works', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gd03-ev-'));
  try {
    const keyFile = join(dir, 'k.pem'), pubFile = join(dir, 'p.pem'); await writeFile(keyFile, K.priv); await writeFile(pubFile, K.pub);
    const run = async (argv, env, stdin = '') => { const out = [], err = []; const code = await adminMain(argv, env, { stdin: () => stdin, out: (s) => out.push(s), err: (s) => err.push(s) }); return { code, out: out.join(''), err: err.join('') }; };
    // collect uses global fetch; point it at the fake for this test only
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = fakeGoogle().fetchImpl;
      const r = await run(['collect', '--folder-id', FOLDER, '--service-account', SA, '--sign-key', keyFile], { GDRIVE_ADMIN_ACCESS_TOKEN: 'ADMIN-TOKEN-VALUE' });
      assert.equal(r.code, 0);
      assert.ok(!r.out.includes('ADMIN-TOKEN-VALUE') && !r.err.includes('ADMIN-TOKEN-VALUE'));
      const v = await run(['verify', '--folder-id', FOLDER, '--public-key', pubFile], {}, r.out);
      assert.equal(v.code, 0);
      globalThis.fetch = fakeGoogle({ drivePerms: [{ type: 'anyone', role: 'reader' }] }).fetchImpl;
      const bad = await run(['collect', '--folder-id', FOLDER, '--service-account', SA, '--sign-key', keyFile], { GDRIVE_ADMIN_ACCESS_TOKEN: 'ADMIN-TOKEN-VALUE' });
      assert.equal(bad.code, 2);
    } finally { globalThis.fetch = realFetch; }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('admin script source is read-only: GET only, no write endpoints, no upload client, never logs the token', async () => {
  const src = await readFile('scripts/gdrive03-admin-folder-evidence.mjs', 'utf8');
  assert.deepEqual([...src.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]), ['GET']);
  assert.doesNotMatch(src, /'(POST|PUT|PATCH|DELETE)'|drive-client|uploadResumable|permissions\.create|\/upload\//);
  assert.doesNotMatch(src, /console\.\w+\([^)]*token/i);
  assert.doesNotMatch(src, /process\.env\.GDRIVE_ADMIN_ACCESS_TOKEN[^)]*(out|err|log)/);
});

// ---------------------------------------------------------------- through the real uploader (fake Drive, nothing leaves the process)

async function uploadSet() {
  const dir = await mkdtemp(join(tmpdir(), 'gd03-up-'));
  const name = 'ege-teknik-synthetic-2026-10-22T11-08-35Z-gdrive03-test-abcdef12.dump.enc';
  const archive = join(dir, name); await writeFile(archive, Buffer.concat([Buffer.from('ETGCM002'), Buffer.alloc(120, 7)]));
  const bytes = await readFile(archive), sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(`${archive}.sha256`, `${sha256}  ${name}\n`);
  const manifest = buildManifest({ archiveName: name, sha256, sizeBytes: bytes.length, keyId: 'gdrive03-test', postgresMajor: 18, pgDumpVersion: 'pg_dump (PostgreSQL) 18.6', tocEntries: 3, tocSha256: 'a'.repeat(64), source: 'synthetic', createdAt: NOW });
  await writeFile(`${archive}.manifest.json`, JSON.stringify(manifest));
  return { dir, files: { archive, checksum: `${archive}.sha256`, manifest: `${archive}.manifest.json` } };
}
function fakeDrive(folder) {
  const calls = [], store = new Map();
  return { calls, store,
    async about() { return { user: { emailAddress: SA } }; },
    async getFolder() { return folder; },
    async listPermissions(id) { return id === DRIVE ? (folder.drivePermissions ?? [{ type: 'user', role: 'organizer' }]) : (folder.permissions ?? []); },
    async findByName() { return []; },
    async uploadResumable(_f, name, path, { size }) { calls.push('upload'); const id = `id${store.size}`; store.set(id, { name, data: await readFile(path) }); return { id, name, size: String(size) }; },
    async downloadToFile(id, dest) { await writeFile(dest, store.get(id).data, { flag: 'wx' }); } };
}
const upload = (client, set, extra = {}) => uploadBackupSet({ client, folderId: FOLDER, expectedAccount: SA, files: set.files, workRoot: set.dir, now: NOW, evidencePublicKey: K.pub, ...extra });

test('uploader: live Shared Drive and folder permissions fail closed, regardless of signed evidence', async () => {
  const set = await uploadSet();
  try {
    let c = fakeDrive(sharedDriveFolder());
    await assert.rejects(upload(c, set), { code: 'folder_permissions_unavailable' });
    assert.equal(c.calls.length, 0);
    c = fakeDrive(sharedDriveFolder({ permissions: [{ type: 'user', role: 'writer' }], drivePermissions: [{ type: 'domain', role: 'reader' }] }));
    await assert.rejects(upload(c, set, { folderEvidence: signed(evidence()) }), { code: 'folder_is_shared_publicly' });
    assert.equal(c.calls.length, 0);
    c = fakeDrive(sharedDriveFolder({ permissions: [{ type: 'anyone', role: 'reader' }] }));
    await assert.rejects(upload(c, set), { code: 'folder_is_shared_publicly' });
    assert.equal(c.calls.length, 0);
    c = fakeDrive(sharedDriveFolder({ permissions: [{ type: 'user', role: 'writer' }] }));
    const r = await upload(c, set);
    assert.equal(r.status, 'PASS'); assert.equal(c.calls.length, 3);
  } finally { await rm(set.dir, { recursive: true, force: true }); }
});

test('uploader: missing Shared Drive identity is refused; existing safety checks still apply', async () => {
  const set = await uploadSet();
  try {
    const c = fakeDrive({ id: FOLDER, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: true }, permissions: [{ type: 'user', role: 'writer' }] });
    await assert.rejects(upload(c, set), { code: 'drive_identity_missing' });
    await assert.rejects(upload(fakeDrive({ ...sharedDriveFolder(), capabilities: { canAddChildren: false } }), set), { code: 'folder_not_writable' });
    await assert.rejects(upload(fakeDrive({ ...sharedDriveFolder(), trashed: true }), set), { code: 'unsafe_folder' });
  } finally { await rm(set.dir, { recursive: true, force: true }); }
});
