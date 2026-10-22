/**
 * H5-C: backup manifest. PUBLIC data only (it is uploaded next to the encrypted archive): identifiers, hashes, sizes, tool versions.
 * Never a host name, user, password, key, key material or row data. The manifest is uploaded LAST: its presence in Drive is the
 * commit marker that says "this backup set is complete and was verified".
 */
export const MANIFEST_VERSION = 1;
const SECRET_SHAPES = /postgres(?:ql)?:\/\/|(?:password|secret|token|apikey|api_key|private_key)\s*[=:]|-----BEGIN|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\./i;
export const ARCHIVE_NAME = /^ege-teknik-(production|synthetic)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[A-Za-z0-9_-]{1,64}-[A-Za-z0-9]{6,16}\.dump\.enc$/;

const KEYS = {
  top: ['archive', 'backup_id', 'created_at', 'database', 'manifest_version', 'retention_class', 'source', 'tool'],
  archive: ['algorithm', 'format', 'key_id', 'name', 'sha256', 'size_bytes'],
  database: ['pg_dump_version', 'postgres_major', 'toc_entries', 'toc_sha256'],
  tool: ['name', 'version'],
};
const same = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function buildManifest({ archiveName, sha256, sizeBytes, keyId, postgresMajor, pgDumpVersion, tocEntries, tocSha256, source = 'neon-production', createdAt = new Date() }) {
  const base = archiveName.replace(/\.dump\.enc$/, '');
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    backup_id: base.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80),
    created_at: createdAt.toISOString(),
    source,
    retention_class: 'daily',
    archive: { name: archiveName, sha256, size_bytes: sizeBytes, format: 'ETGCM002', algorithm: 'AES-256-GCM', key_id: keyId },
    database: { postgres_major: postgresMajor, pg_dump_version: pgDumpVersion, toc_entries: tocEntries, toc_sha256: tocSha256 },
    tool: { name: 'ege-teknik-backup', version: 1 },
  };
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(m) {
  const fail = (why) => { throw Object.assign(new Error('Invalid backup manifest: ' + why), { code: 'invalid_manifest' }); };
  if (!same(m, KEYS.top)) fail('unexpected top-level fields');
  if (m.manifest_version !== MANIFEST_VERSION) fail('version');
  if (!/^[a-z0-9-]{8,80}$/.test(m.backup_id)) fail('backup_id');
  if (typeof m.created_at !== 'string' || Number.isNaN(Date.parse(m.created_at)) || new Date(m.created_at).toISOString() !== m.created_at) fail('created_at');
  if (!['neon-production', 'synthetic'].includes(m.source)) fail('source');
  if (m.retention_class !== 'daily') fail('retention_class');
  if (!same(m.archive, KEYS.archive) || !ARCHIVE_NAME.test(m.archive.name) || !/^[a-f0-9]{64}$/.test(m.archive.sha256)) fail('archive');
  if (m.archive.format !== 'ETGCM002' || m.archive.algorithm !== 'AES-256-GCM' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.archive.key_id)) fail('archive encryption');
  if (!Number.isSafeInteger(m.archive.size_bytes) || m.archive.size_bytes < 64) fail('size');
  if (!same(m.database, KEYS.database) || m.database.postgres_major !== 18 || !Number.isInteger(m.database.toc_entries) || m.database.toc_entries < 1 || !/^[a-f0-9]{64}$/.test(m.database.toc_sha256) || !/^pg_dump \(PostgreSQL\) 18\.\d+/.test(m.database.pg_dump_version)) fail('database');
  if (!same(m.tool, KEYS.tool) || m.tool.name !== 'ege-teknik-backup' || m.tool.version !== 1) fail('tool');
  if (SECRET_SHAPES.test(JSON.stringify(m))) fail('secret-shaped value');
  return m;
}

/** The manifest must describe exactly the archive that is about to be uploaded. */
export function assertManifestMatchesArchive(m, { name, sha256, sizeBytes }) {
  validateManifest(m);
  if (m.archive.name !== name || m.archive.sha256 !== sha256 || m.archive.size_bytes !== sizeBytes) throw Object.assign(new Error('Manifest does not describe this archive'), { code: 'manifest_mismatch' });
}
