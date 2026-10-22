// GDRIVE-03: administrator-side, READ-ONLY evidence that the Drive test folder (and its Shared Drive) is not shared with "anyone" or a domain.
// Run by a Shared Drive manager under their OWN identity, on their own machine. It only issues HTTP GET requests, prints no token and
// writes no e-mail address into the evidence. Nobody else ever needs the administrator's password, token or signing key.
//
//   collect: GDRIVE_ADMIN_ACCESS_TOKEN=<your own short-lived token> node scripts/gdrive03-admin-folder-evidence.mjs collect \
//              --folder-id <id> --service-account <test SA e-mail> --sign-key <ed25519 private key PEM file>   > evidence.b64
//   verify:  node scripts/gdrive03-admin-folder-evidence.mjs verify --folder-id <id> --public-key <PEM file>   < evidence.b64
//
// The token only needs read access to file metadata and permissions (scope drive.metadata.readonly is enough). The script itself has
// no code path that creates, updates, deletes or shares anything (a test enforces that).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { EVIDENCE_KIND, EVIDENCE_VERSION, canonicalJson, decodeEvidence, verifyEvidence } from '../lib/backup/drive-folder-safety.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const fail = (code) => Object.assign(new Error(code), { code });

function makeGet(token, fetchImpl) {
  return async function get(path) {
    let res; try { res = await fetchImpl(`${API}${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) }); } catch { throw fail('network_error'); }
    if (res.status === 401 || res.status === 403) throw fail('forbidden');
    if (res.status === 404) throw fail('not_found');
    if (res.status !== 200) throw fail(`http_${res.status}`);
    try { return await res.json(); } catch { throw fail('bad_response'); }
  };
}

async function listPermissions(get, fileId) {
  const out = []; let pageToken = '';
  do {
    const page = await get(`/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&pageSize=100&fields=nextPageToken,permissions(id,type,role,emailAddress,permissionDetails(inherited,permissionType,role))${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    out.push(...(page.permissions ?? [])); pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

const count = (perms, type) => perms.filter((p) => p.type === type).length;
const summarise = (perms) => ({ user: count(perms, 'user'), group: count(perms, 'group'), domain: count(perms, 'domain'), anyone: count(perms, 'anyone'),
  inherited: perms.filter((p) => (p.permissionDetails ?? []).some((d) => d.inherited === true)).length });

/** Unsigned evidence document. Counts only, never an address. */
export async function collectEvidence({ token, folderId, serviceAccount, fetchImpl = fetch, now = new Date() }) {
  if (!token) throw fail('missing_admin_token');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId ?? '')) throw fail('invalid_folder_id');
  if (!/^[^\s@]+@[^\s@]+$/.test(serviceAccount ?? '')) throw fail('invalid_service_account');
  const get = makeGet(token, fetchImpl);
  const folder = await get(`/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,mimeType,trashed,driveId,capabilities(canShare)`);
  if (folder.id !== folderId || folder.mimeType !== FOLDER_MIME || folder.trashed) throw fail('unsafe_folder');
  if (!folder.driveId) throw fail('not_in_a_shared_drive');
  if (!folder.capabilities?.canShare) throw fail('caller_cannot_read_permissions'); // not an administrator of this folder
  const folderPerms = await listPermissions(get, folderId);
  const drivePerms = await listPermissions(get, folder.driveId);
  const drive = await get(`/drives/${encodeURIComponent(folder.driveId)}?fields=id,restrictions(domainUsersOnly,driveMembersOnly)`);
  const mine = folderPerms.find((p) => p.type === 'user' && p.emailAddress?.toLowerCase() === serviceAccount.toLowerCase());
  if (!mine) throw fail('service_account_not_listed_on_folder');
  if (!folderPerms.length || !drivePerms.length) throw fail('empty_permission_list');
  return {
    kind: EVIDENCE_KIND, version: EVIDENCE_VERSION, folder_id: folderId, drive_id: folder.driveId, observed_at: now.toISOString(),
    service_account_role: mine.role,
    findings: { folder_anyone: count(folderPerms, 'anyone') > 0, folder_domain: count(folderPerms, 'domain') > 0, drive_anyone: count(drivePerms, 'anyone') > 0, drive_domain: count(drivePerms, 'domain') > 0 },
    summary: { folder_permissions: summarise(folderPerms), drive_permissions: summarise(drivePerms),
      drive_restrictions: { domain_users_only: drive.restrictions?.domainUsersOnly === true, drive_members_only: drive.restrictions?.driveMembersOnly === true } },
  };
}

export function signEvidence(evidence, privateKeyPem) {
  const signature = sign(null, Buffer.from(canonicalJson(evidence)), createPrivateKey(privateKeyPem)).toString('base64');
  return Buffer.from(JSON.stringify({ evidence, signature })).toString('base64');
}

function option(args, name) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; }

export async function main(argv = process.argv.slice(2), env = process.env, io = { stdin: () => readFileSync(0, 'utf8'), out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const [command, ...args] = argv;
  if (command === 'collect') {
    const evidence = await collectEvidence({ token: env.GDRIVE_ADMIN_ACCESS_TOKEN, folderId: option(args, 'folder-id'), serviceAccount: option(args, 'service-account') });
    const keyFile = option(args, 'sign-key'); if (!keyFile) throw fail('missing_sign_key');
    const b64 = signEvidence(evidence, readFileSync(keyFile, 'utf8'));
    const f = evidence.findings;
    io.err(`evidence: folder_anyone=${f.folder_anyone} folder_domain=${f.folder_domain} drive_anyone=${f.drive_anyone} drive_domain=${f.drive_domain} sa_role=${evidence.service_account_role}\n`);
    io.out(`${b64}\n`);
    return Object.values(f).some(Boolean) ? 2 : 0;
  }
  if (command === 'verify') {
    const evidenceB64 = io.stdin().trim();
    const r = verifyEvidence({ evidenceB64, publicKeyPem: readFileSync(option(args, 'public-key'), 'utf8'), folderId: option(args, 'folder-id'), driveId: option(args, 'drive-id') ?? decodeEvidence(evidenceB64).evidence.drive_id });
    io.err(`evidence verified (observed ${r.observed_at})\n`); return 0;
  }
  throw fail('usage: collect | verify');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(`EVIDENCE: FAIL (${/^[a-z_0-9: |-]+$/.test(e?.code ?? '') ? e.code : 'error'})`); process.exitCode = 1; });
}
