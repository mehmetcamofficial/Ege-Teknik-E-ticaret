// New archives: ETGCM002. Legacy OpenSSL CBC requires explicit opt-in and trusted hash.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const [source, destination, expected, legacy, ...extra] = process.argv.slice(2);
  if (!source || !destination || !/^[a-f0-9]{64}$/.test(expected ?? '') || extra.length ||
      (legacy !== undefined && legacy !== '--allow-legacy-cbc')) throw Error('Usage: INPUT OUTPUT TRUSTED_SHA256 [--allow-legacy-cbc]');
  const input = resolve(source), output = resolve(destination);
  if (input === output) throw Error('Input and output must differ');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(input)) digest.update(chunk);
  if (digest.digest('hex') !== expected) throw Error('Checksum mismatch');
  const file = await open(input, 'r'), magic = Buffer.alloc(8);
  try { await file.read(magic, 0, 8, 0); } finally { await file.close(); }
  if (magic.toString() === 'ETGCM002') {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./backup-crypto-gcm.mjs', import.meta.url)), 'decrypt', input, output], { env: process.env, stdio: 'pipe' });
    if (child.status !== 0) throw Error('GCM decryption failed');
    return;
  }
  if (magic.toString() !== 'Salted__' || legacy !== '--allow-legacy-cbc') throw Error('Unsupported archive or legacy CBC not explicitly allowed');
  if (!process.env.BACKUP_ENCRYPTION_PASSWORD) throw Error('Legacy recovery password is missing');
  const temporary = `${output}.partial-${randomBytes(8).toString('hex')}`;
  // Reserve with exclusive creation, never overwrite another file, even during recovery.
  const reservation = await open(temporary, 'wx', 0o600); await reservation.close();
  try {
    const child = spawnSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-in', input, '-out', temporary, '-pass', 'env:BACKUP_ENCRYPTION_PASSWORD'], { env: process.env, stdio: 'pipe' });
    if (child.status !== 0) throw Error('Legacy CBC decryption failed');
    await link(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
}
main().then(() => console.log('BACKUP DECRYPT: PASS')).catch(() => {
  console.error('BACKUP DECRYPT: FAIL (format, checksum, key or output validation)');
  process.exitCode = 1;
});
