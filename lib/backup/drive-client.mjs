/**
 * H5-C: minimal Google Drive v3 client for ONE job: put verified encrypted backups into one folder and read them back.
 *
 * Least privilege BY CONSTRUCTION: the client exposes no delete, trash, update, permission-change or share method. Combined with a
 * folder-scoped service identity (Shared Drive "Contributor": can add files, cannot delete) a compromised job can neither remove
 * nor publish a backup. The access token comes from the caller (workload identity federation in CI); it is never logged and
 * never part of an error message. All failures are mapped to short non-sensitive codes.
 */
import { open, writeFile } from 'node:fs/promises';

const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const CHUNK_BYTES = 8 * 1024 * 1024; // multiple of 256 KiB as Drive requires
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** The resumable session URI is a capability URL issued by Google; refuse anything that is not exactly Google's upload endpoint. */
export function isTrustedUploadSession(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'www.googleapis.com' && u.port === '' && !u.username && !u.password
      && u.pathname.startsWith('/upload/drive/v3/files') && u.searchParams.has('upload_id');
  } catch { return false; }
}

export class DriveError extends Error {
  constructor(code, status) { super(`Drive operation failed: ${code}`); this.name = 'DriveError'; this.code = code; this.status = status; }
}

export function createDriveClient({ getAccessToken, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), chunkBytes = CHUNK_BYTES, retries = 3 }) {
  async function call(url, init = {}, { okStatuses = [200], what = 'request' } = {}) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const token = await getAccessToken();
        if (typeof token !== 'string' || !token) throw new DriveError('missing_token', 0);
        const res = await fetchImpl(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
        if (okStatuses.includes(res.status)) return res;
        if (res.status === 401 || res.status === 403) throw new DriveError('forbidden', res.status);
        if (res.status === 404) throw new DriveError('not_found', 404);
        if (!RETRYABLE.has(res.status)) throw new DriveError(`${what}_rejected`, res.status);
        last = new DriveError(`${what}_unavailable`, res.status);
      } catch (error) {
        if (error instanceof DriveError) throw error;
        last = new DriveError(`${what}_network`, 0);
      }
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
    throw last;
  }
  const json = async (res) => { try { return await res.json(); } catch { throw new DriveError('bad_response', res.status); } };
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return {
    async about() { return json(await call(`${API}/about?fields=user(emailAddress)`, {}, { what: 'about' })); },
    async getFolder(id) {
      return json(await call(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed,driveId,capabilities(canAddChildren,canDeleteChildren,canTrashChildren),permissions(type,role)&supportsAllDrives=true`, {}, { what: 'folder' }));
    },
    async listChildren(folderId) {
      const out = []; let pageToken = '';
      do {
        const url = `${API}/files?q=${encodeURIComponent(`'${q(folderId)}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,size,md5Checksum,createdTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const page = await json(await call(url, {}, { what: 'list' }));
        out.push(...(page.files ?? [])); pageToken = page.nextPageToken ?? '';
      } while (pageToken);
      return out;
    },
    async findByName(folderId, name) {
      const url = `${API}/files?q=${encodeURIComponent(`'${q(folderId)}' in parents and name='${q(name)}' and trashed=false`)}&fields=files(id,name,size,md5Checksum)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
      return (await json(await call(url, {}, { what: 'find' }))).files ?? [];
    },
    /** Resumable upload in chunks; a failed chunk asks Drive how much it already has and continues from there. */
    async uploadResumable(folderId, name, filePath, { size }) {
      const start = await call(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,md5Checksum`, {
        method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(size) },
        body: JSON.stringify({ name, parents: [folderId] }) }, { what: 'upload_start' });
      const session = start.headers.get('location');
      if (!session || !isTrustedUploadSession(session)) throw new DriveError('bad_response', 200);
      const handle = await open(filePath, 'r');
      try {
        let offset = 0, stalled = 0;
        while (offset < size) {
          const end = Math.min(offset + chunkBytes, size), buffer = Buffer.alloc(end - offset);
          await handle.read(buffer, 0, buffer.length, offset);
          let res;
          try {
            res = await fetchImpl(session, { method: 'PUT', headers: { 'content-length': String(buffer.length), 'content-range': `bytes ${offset}-${end - 1}/${size}` }, body: buffer, signal: AbortSignal.timeout(120_000) });
          } catch { res = { status: 0 }; }
          if (res.status === 200 || res.status === 201) { if (end !== size) throw new DriveError('upload_inconsistent', res.status); return json(res); }
          if (res.status === 308) {
            const range = res.headers.get('range'), next = range ? Number(/-(\d+)$/.exec(range)?.[1] ?? -1) + 1 : 0;
            if (next > offset) stalled = 0; else if (++stalled > retries) throw new DriveError('upload_stalled', 308); else await sleep(1000 * 2 ** (stalled - 1));
            offset = next; continue;
          }
          if (res.status === 401 || res.status === 403) throw new DriveError('forbidden', res.status);
          if (res.status !== 0 && !RETRYABLE.has(res.status)) throw new DriveError('upload_rejected', res.status);
          if (++stalled > retries) throw new DriveError('upload_failed', res.status);
          await sleep(1000 * 2 ** (stalled - 1));
          const probe = await fetchImpl(session, { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${size}` }, signal: AbortSignal.timeout(60_000) }).catch(() => ({ status: 0, headers: new Headers() }));
          if (probe.status === 200 || probe.status === 201) return json(probe);
          if (probe.status === 308) { const range = probe.headers.get('range'); offset = range ? Number(/-(\d+)$/.exec(range)?.[1] ?? -1) + 1 : 0; }
        }
        throw new DriveError('upload_incomplete', 0);
      } finally { await handle.close(); }
    },
    async downloadToFile(id, destination) {
      const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {}, { what: 'download' });
      await writeFile(destination, Buffer.from(await res.arrayBuffer()), { mode: 0o600, flag: 'wx' });
    },
  };
}
