import { mkdtemp, writeFile, readFile, rm, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const digest = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
export async function uploadDrive(env = process.env, deps = {}) {
  const run = deps.run ?? ((args, childEnv) => {
    const r = spawnSync('rclone', args, { env: childEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    if (r.status !== 0) throw Error('Drive transport failed'); // Never echo provider tokens/errors.
    return r.stdout;
  });
  const request = deps.request ?? fetch;
  const encoded = env.RCLONE_CONFIG_B64 ?? '';
  const folder = env.EGE_GDRIVE_FOLDER_ID ?? '';
  if (!encoded || !/^[A-Za-z0-9_-]{10,200}$/.test(folder)) throw Error('Missing Drive configuration or explicit folder ID');
  const config = Buffer.from(encoded, 'base64');
  if (config.toString('base64') !== encoded) throw Error('Invalid Drive configuration encoding');
  const files = [env.ENCRYPTED_FILE, env.CHECKSUM_FILE, env.METADATA_FILE];
  if (files.some(f => !f) || new Set(files.map(f => basename(f))).size !== 3) throw Error('Missing or ambiguous backup files');
  const [archive, checksum, metadata] = files;
  const header = Buffer.alloc(8), input = await open(archive, 'r');
  try { await input.read(header, 0, 8, 0); } finally { await input.close(); }
  if (header.toString() !== 'ETGCM002') throw Error('Only ETGCM002 archives may be uploaded');
  const hash = await digest(archive);
  if ((await readFile(checksum, 'utf8')) !== `${hash}  ${basename(archive)}\n`) throw Error('Invalid checksum');
  const meta = JSON.parse(await readFile(metadata, 'utf8'));
  if (meta.format !== 'ETGCM002' || meta.algorithm !== 'AES-256-GCM' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(meta.key_id ?? '') || meta.postgres_major !== 18 ||
      Object.keys(meta).sort().join(',') !== 'algorithm,format,key_id,postgres_major') throw Error('Invalid public metadata');
  const directory = await mkdtemp(join(env.RUNNER_TEMP ?? tmpdir(), 'ege-drive-'));
  try {
    const configFile = join(directory, 'rclone.conf');
    await writeFile(configFile, config, { mode: 0o600 });
    // Do not pass the GCM key, DB URL, or legacy password to the transport.
    const childEnv = { PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, RCLONE_CONFIG: configFile,
      RCLONE_CONFIG_EGE_TEKNIK_BACKUP_ROOT_FOLDER_ID: folder };
    const flags = ['--config', configFile, '--drive-root-folder-id', folder, '--retries', '2', '--low-level-retries', '2'];
    await run(['about', 'ege_teknik_backup:', '--json', ...flags], childEnv); // Refresh OAuth in private temp config.
    const refreshed = await readFile(configFile, 'utf8');
    const section = refreshed.match(/^\[ege_teknik_backup\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
    if (!section || !/^type\s*=\s*drive\s*$/m.test(section)) throw Error('Expected dedicated Drive remote');
    const token = JSON.parse(section.match(/^token\s*=\s*(.+)$/m)?.[1] ?? '{}').access_token;
    if (!token) throw Error('Drive access token unavailable');
    const get = async url => {
      const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error('Drive identity or folder validation failed');
      return response.json();
    };
    const about = await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    if (about.user?.emailAddress?.toLowerCase() !== 'info@egeteknik.tr') throw Error('Unexpected Drive account');
    const target = await get(`https://www.googleapis.com/drive/v3/files/${folder}?fields=id,mimeType,trashed,capabilities(canAddChildren),permissions(type)&supportsAllDrives=true`);
    if (target.id !== folder || target.mimeType !== 'application/vnd.google-apps.folder' || target.trashed ||
        !target.capabilities?.canAddChildren || !Array.isArray(target.permissions) ||
        target.permissions.some(p => p.type === 'anyone')) throw Error('Unsafe or inaccessible Drive folder');
    for (const file of files) {
      const remote = `ege_teknik_backup:${basename(file)}`;
      // Fail rather than silently replace an existing object. No sync/delete/public link.
      await run(['copyto', file, remote, '--immutable', ...flags], childEnv);
      const downloaded = join(directory, basename(file));
      await run(['copyto', remote, downloaded, ...flags], childEnv);
      if (await digest(file) !== await digest(downloaded)) throw Error('Drive roundtrip checksum mismatch');
    }
    return { status: 'PASS', files: files.length, sha256: hash };
  } finally { config.fill(0); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  uploadDrive().then(() => console.log('GOOGLE DRIVE ENCRYPTED ROUNDTRIP: PASS')).catch(() => {
    console.error('GOOGLE DRIVE BACKUP: FAIL (configuration, identity, folder or transfer validation)');
    process.exitCode = 1;
  });
}
