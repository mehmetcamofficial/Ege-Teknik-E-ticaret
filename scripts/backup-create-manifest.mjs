// H5-C: builds the PUBLIC manifest next to an encrypted archive. Usage: ARCHIVE CHECKSUM_FILE TOC_FILE OUT
// env: BACKUP_GCM_KEY_ID (non-secret), BACKUP_SOURCE (neon-production|synthetic), PG_DUMP_VERSION
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { buildManifest } from '../lib/backup/manifest.mjs';

async function main() {
  const [archive, checksum, tocFile, out, ...extra] = process.argv.slice(2);
  if (!archive || !checksum || !tocFile || !out || extra.length) throw Error('usage');
  const h = createHash('sha256'); for await (const c of createReadStream(archive)) h.update(c);
  const sha256 = h.digest('hex'), name = basename(archive);
  if ((await readFile(checksum, 'utf8')) !== `${sha256}  ${name}\n`) throw Error('checksum file mismatch');
  const toc = await readFile(tocFile, 'utf8'), lines = toc.split('\n').filter((l) => l && !l.startsWith(';'));
  const manifest = buildManifest({
    archiveName: name, sha256, sizeBytes: (await stat(archive)).size, keyId: process.env.BACKUP_GCM_KEY_ID ?? '', postgresMajor: 18,
    pgDumpVersion: (process.env.PG_DUMP_VERSION ?? '').trim(), tocEntries: lines.length, tocSha256: createHash('sha256').update(lines.join('\n') + '\n').digest('hex'),
    source: process.env.BACKUP_SOURCE ?? 'neon-production',
  });
  await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
main().then(() => console.log('BACKUP MANIFEST: PASS')).catch(() => { console.error('BACKUP MANIFEST: FAIL (archive, checksum, key id or table-of-contents validation)'); process.exitCode = 1; });
