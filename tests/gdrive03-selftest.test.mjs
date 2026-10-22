import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDriveClient, isTrustedUploadSession } from '../lib/backup/drive-client.mjs';
import { selftest } from '../scripts/gdrive-oidc-selftest.mjs';

const TOKEN = 'ya29.SECRET-TOKEN-VALUE', ACCOUNT = 'uploader@ege-teknik-backup.iam.gserviceaccount.com', FOLDER = 'folder1234567890abc';
const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc123';
const res = (status, body, headers = {}) => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const noSleep = async () => {};
const mk = (fetchImpl, o = {}) => createDriveClient({ getAccessToken: async () => TOKEN, fetchImpl, sleep: noSleep, chunkBytes: 262144, ...o });
async function tmpFile(t, bytes) { const d = await mkdtemp(join(tmpdir(), 'g3-')); t.after(() => rm(d, { recursive: true, force: true })); const f = join(d, 'f.bin'); await writeFile(f, bytes); return { d, f }; }
const folderOk = { id: FOLDER, mimeType: 'application/vnd.google-apps.folder', trashed: false, driveId: 'sd1', capabilities: { canAddChildren: true, canDeleteChildren: false, canTrashChildren: false }, permissions: [{ type: 'user', role: 'writer' }] };

// ---- selftest with a fake client (OIDC token output simulated) ----
function fake(o = {}) {
  const store = new Map();
  return {
    about: async () => { if (o.aboutErr) throw Object.assign(new Error('x'), { code: o.aboutErr }); return { user: { emailAddress: o.account ?? ACCOUNT } }; },
    getFolder: async () => { if (o.folderErr) throw Object.assign(new Error('x'), { code: o.folderErr }); return { ...folderOk, ...o.folder }; },
    findByName: async (_f, n) => (o.exists || store.has(n) ? [{ name: n }] : []),
    uploadResumable: async (_f, n, p) => { if (o.uploadErr) throw Object.assign(new Error('x'), { code: o.uploadErr }); const { readFile } = await import('node:fs/promises'); store.set('id1', await readFile(p)); return { id: 'id1' }; },
    downloadToFile: async (_i, d) => { const b = Buffer.from(store.get('id1')); if (o.corrupt) b[0] ^= 1; await writeFile(d, b, { flag: 'wx' }); },
  };
}
const env = (x = {}) => ({ GDRIVE_ACCESS_TOKEN: TOKEN, GDRIVE_FOLDER_ID: FOLDER, GDRIVE_EXPECTED_ACCOUNT: ACCOUNT, RUN_ID: '42', ...x });
const failsAt = (e, step, code) => assert.rejects(selftest(e.env, e.client), (x) => x.step === step && (!code || x.code === code));

test('selftest: success names the file H5C-OIDC-TEST and verifies SHA-256', async () => {
  const r = await selftest(env(), fake()); assert.equal(r.name, 'H5C-OIDC-TEST-42.txt'); assert.match(r.sha256, /^[a-f0-9]{64}$/);
});
test('selftest: missing token, wrong service account, missing config', async () => {
  await failsAt({ env: env({ GDRIVE_ACCESS_TOKEN: '' }), client: fake() }, 'oidc_authentication', 'no_access_token');
  await failsAt({ env: env(), client: fake({ account: 'other@x.com' }) }, 'service_account_impersonation', 'unexpected_identity');
  await failsAt({ env: env(), client: fake({ aboutErr: 'forbidden' }) }, 'service_account_impersonation_or_token', 'forbidden');
  await failsAt({ env: env({ GDRIVE_EXPECTED_ACCOUNT: '' }), client: fake() }, 'configuration', 'missing_expected_account');
  await failsAt({ env: env({ GDRIVE_FOLDER_ID: 'x' }), client: fake() }, 'configuration', 'invalid_folder_id');
});
test('selftest: wrong folder, no write permission, public/domain sharing, trashed/non-folder', async () => {
  await failsAt({ env: env(), client: fake({ folderErr: 'not_found' }) }, 'drive_folder_permission', 'not_found');
  await failsAt({ env: env(), client: fake({ folder: { capabilities: { canAddChildren: false } } }) }, 'drive_folder_permission', 'folder_not_writable');
  await failsAt({ env: env(), client: fake({ folder: { permissions: [{ type: 'anyone' }] } }) }, 'drive_folder_permission', 'folder_shared_publicly');
  await failsAt({ env: env(), client: fake({ folder: { permissions: [{ type: 'domain' }] } }) }, 'drive_folder_permission', 'folder_shared_publicly');
  await failsAt({ env: env(), client: fake({ folder: { trashed: true } }) }, 'drive_folder_permission', 'unsafe_folder');
  await failsAt({ env: env(), client: fake({ folder: { mimeType: 'text/plain' } }) }, 'drive_folder_permission', 'unsafe_folder');
});
test('selftest: second upload of the same name is refused; corruption detected', async () => {
  await failsAt({ env: env(), client: fake({ exists: true }) }, 'drive_upload', 'refusing_to_overwrite');
  await failsAt({ env: env(), client: fake({ corrupt: true }) }, 'sha256_roundtrip', 'sha256_mismatch');
  await failsAt({ env: env(), client: fake({ uploadErr: 'forbidden' }) }, 'drive_upload', 'forbidden');
});
test('selftest: warns (does not leak) when identity can delete', async (t) => {
  const logs = []; t.mock.method(console, 'log', (m) => logs.push(m));
  await selftest(env(), fake({ folder: { driveId: undefined, capabilities: { canAddChildren: true, canDeleteChildren: true } } }));
  assert.ok(logs.some((l) => /WARN least_privilege/.test(l))); assert.ok(!logs.join('').includes(TOKEN));
});

// ---- client over a fake fetch ----
test('session URL trust: only https www.googleapis.com upload endpoint with upload_id', () => {
  assert.ok(isTrustedUploadSession(SESSION));
  for (const bad of ['http://www.googleapis.com/upload/drive/v3/files?upload_id=1', 'https://evil.example/upload/drive/v3/files?upload_id=1', 'https://www.googleapis.com.evil.com/upload/drive/v3/files?upload_id=1',
    'https://u:p@www.googleapis.com/upload/drive/v3/files?upload_id=1', 'https://www.googleapis.com:444/upload/drive/v3/files?upload_id=1', 'https://www.googleapis.com/drive/v3/files?upload_id=1', 'https://www.googleapis.com/upload/drive/v3/files', 'nope'])
    assert.equal(isTrustedUploadSession(bad), false, bad);
});
test('client: untrusted Location is rejected before any data is sent', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(100)), urls = [];
  const c = mk(async (u) => { urls.push(String(u)); return res(200, undefined, { location: 'https://evil.example/up?upload_id=1' }); });
  await assert.rejects(c.uploadResumable(FOLDER, 'a.txt', f, { size: 100 }), { code: 'bad_response' });
  assert.equal(urls.length, 1);
});
test('client: missing Location and missing token fail safely', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(10));
  await assert.rejects(mk(async () => res(200)).uploadResumable(FOLDER, 'a', f, { size: 10 }), { code: 'bad_response' });
  const calls = []; const c = createDriveClient({ getAccessToken: async () => '', fetchImpl: async (u) => { calls.push(u); return res(200, {}); }, sleep: noSleep });
  await assert.rejects(c.about(), { code: 'missing_token' }); assert.equal(calls.length, 0);
});
test('client: 200/201 completion; token only in Authorization of API calls, never sent to the session URL', async (t) => {
  for (const status of [200, 201]) {
    const { f } = await tmpFile(t, Buffer.alloc(100, 1)), seen = [];
    const c = mk(async (u, init) => { seen.push([String(u), init.method, init.headers]); return String(u).includes('upload_id') ? res(status, { id: 'i', name: 'a', size: '100' }) : res(200, undefined, { location: SESSION }); });
    assert.equal((await c.uploadResumable(FOLDER, 'a', f, { size: 100 })).id, 'i');
    assert.ok(seen[0][2].authorization.includes(TOKEN)); assert.equal(seen[1][2].authorization, undefined);
  }
});
test('client: 308 resume across chunks, partial acceptance, then completion', async (t) => {
  const size = 262144 * 2 + 10, { f } = await tmpFile(t, Buffer.alloc(size, 7)), ranges = [];
  let n = 0;
  const c = mk(async (u, init) => {
    if (!String(u).includes('upload_id')) return res(200, undefined, { location: SESSION });
    ranges.push(init.headers['content-range']); n++;
    if (n === 1) return res(308, undefined, { range: 'bytes=0-131071' }); // server kept only half of chunk 1
    if (n === 2) return res(308, undefined, { range: 'bytes=0-524287' });
    return res(200, { id: 'done' });
  });
  assert.equal((await c.uploadResumable(FOLDER, 'a', f, { size })).id, 'done');
  assert.deepEqual(ranges, [`bytes 0-262143/${size}`, `bytes 131072-393215/${size}`, `bytes 524288-${size - 1}/${size}`]);
});
test('client: 308 without Range restarts at 0; a stalled 308 loop fails instead of hanging', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(300000, 3)); let n = 0;
  const c = mk(async (u) => (!String(u).includes('upload_id') ? res(200, undefined, { location: SESSION }) : (++n, res(308))));
  await assert.rejects(c.uploadResumable(FOLDER, 'a', f, { size: 300000 }), { code: 'upload_stalled' }); assert.ok(n <= 10);
});
test('client: transient 500 / network error mid-upload -> status probe -> resume', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(1000, 5)), seen = []; let n = 0;
  const c = mk(async (u, init) => {
    if (!String(u).includes('upload_id')) return res(200, undefined, { location: SESSION });
    seen.push(init.headers['content-range']); n++;
    if (n === 1) throw new Error('socket reset');
    if (n === 2) return res(308, undefined, { range: 'bytes=0-499' });
    return res(200, { id: 'ok' });
  });
  assert.equal((await c.uploadResumable(FOLDER, 'a', f, { size: 1000 })).id, 'ok'); assert.equal(seen[1], 'bytes */1000');
  const c2 = mk(async (u) => (!String(u).includes('upload_id') ? res(200, undefined, { location: SESSION }) : res(500)));
  await assert.rejects(c2.uploadResumable(FOLDER, 'a', f, { size: 1000 }), { code: 'upload_failed' });
});
test('client: upload completed but connection dropped -> probe returns 200 (no duplicate)', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(100)); let n = 0;
  const c = mk(async (u) => { if (!String(u).includes('upload_id')) return res(200, undefined, { location: SESSION }); return ++n === 1 ? (() => { throw new Error('reset'); })() : res(200, { id: 'x' }); });
  assert.equal((await c.uploadResumable(FOLDER, 'a', f, { size: 100 })).id, 'x');
});
test('client: HTTP error mapping 401/403/404/429/500 and retry counts', async () => {
  for (const [status, code, tries] of [[401, 'forbidden', 1], [403, 'forbidden', 1], [404, 'not_found', 1], [400, 'about_rejected', 1], [429, 'about_unavailable', 4], [500, 'about_unavailable', 4]]) {
    let n = 0; await assert.rejects(mk(async () => (++n, res(status, {}))).about(), (e) => e.code === code && e.status === status, `${status}`); assert.equal(n, tries, `${status} attempts`);
  }
  let k = 0; assert.deepEqual(await mk(async () => (++k < 3 ? res(429, {}) : res(200, { user: { emailAddress: 'a@b' } }))).about(), { user: { emailAddress: 'a@b' } });
  await assert.rejects(mk(async () => res(200, 'not json')).about(), { code: 'bad_response' });
  await assert.rejects(mk(async () => { throw new Error('dns'); }).about(), { code: 'about_network' });
});
test('client: 403 on chunk upload is not retried; 404 (expired session) is rejected', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(100));
  for (const [status, code] of [[403, 'forbidden'], [404, 'upload_rejected']]) {
    let n = 0; const c = mk(async (u) => (!String(u).includes('upload_id') ? res(200, undefined, { location: SESSION }) : (++n, res(status))));
    await assert.rejects(c.uploadResumable(FOLDER, 'a', f, { size: 100 }), { code }); assert.equal(n, 1);
  }
});
test('client: download writes exclusively (no overwrite) and SHA-256 matches', async (t) => {
  const { d } = await tmpFile(t, ''), body = Buffer.from('hello'), dest = join(d, 'out');
  const c = mk(async () => res(200, body.toString()));
  await c.downloadToFile('id', dest); assert.equal(createHash('sha256').update(await (await import('node:fs/promises')).readFile(dest)).digest('hex'), createHash('sha256').update(body).digest('hex'));
  await assert.rejects(c.downloadToFile('id', dest), { code: 'EEXIST' });
});
test('client: errors and logs never contain the token or session URL', async (t) => {
  const { f } = await tmpFile(t, Buffer.alloc(100)), out = [];
  for (const m of ['log', 'error', 'warn']) t.mock.method(console, m, (...a) => out.push(a.join(' ')));
  const c = mk(async (u) => (!String(u).includes('upload_id') ? res(200, undefined, { location: SESSION }) : res(500)));
  const err = await c.uploadResumable(FOLDER, 'a', f, { size: 100 }).catch((e) => e);
  assert.ok(!(String(err.message) + JSON.stringify(err) + out.join('')).match(/SECRET-TOKEN|upload_id|abc123/));
});
