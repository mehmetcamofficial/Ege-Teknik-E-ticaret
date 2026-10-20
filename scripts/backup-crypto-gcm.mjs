import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  appendFile,
  link,
  open,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';

const MAGIC = Buffer.from('ETGCM002');
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const HEADER_SIZE = MAGIC.length + NONCE_SIZE;

function loadKey() {
  const value = process.env.BACKUP_GCM_KEY_B64 ?? '';

  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error('Invalid or missing GCM key configuration');
  }

  const key = Buffer.from(value, 'base64');

  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('GCM key must contain 32 bytes');
  }

  return key;
}

async function encrypt(input, temporary, key) {
  const nonce = randomBytes(NONCE_SIZE);
  const header = Buffer.concat([MAGIC, nonce]);

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);

  await writeFile(temporary, header, {
    flag: 'wx',
    mode: 0o600,
  });

  await pipeline(
    createReadStream(input),
    cipher,
    createWriteStream(temporary, { flags: 'a' }),
  );

  await appendFile(temporary, cipher.getAuthTag());
}

async function decrypt(input, temporary, key) {
  const size = (await stat(input)).size;

  if (size < HEADER_SIZE + TAG_SIZE) {
    throw new Error('Invalid GCM archive length');
  }

  const header = Buffer.alloc(HEADER_SIZE);
  const tag = Buffer.alloc(TAG_SIZE);
  const file = await open(input, 'r');

  try {
    const h = await file.read(header, 0, HEADER_SIZE, 0);
    const t = await file.read(tag, 0, TAG_SIZE, size - TAG_SIZE);

    if (h.bytesRead !== HEADER_SIZE || t.bytesRead !== TAG_SIZE) {
      throw new Error('Truncated GCM archive');
    }
  } finally {
    await file.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Unsupported GCM archive format');
  }

  const nonce = header.subarray(MAGIC.length);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);

  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  // Plaintext remains temporary until authentication succeeds.
  await pipeline(
    size === HEADER_SIZE + TAG_SIZE
      ? Readable.from([])
      : createReadStream(input, {
          start: HEADER_SIZE,
          end: size - TAG_SIZE - 1,
        }),
    decipher,
    createWriteStream(temporary, {
      flags: 'wx',
      mode: 0o600,
    }),
  );
}

async function main() {
  const [mode, source, destination] = process.argv.slice(2);

  if (process.argv.length !== 5 || !['encrypt', 'decrypt'].includes(mode) || !source || !destination) {
    throw new Error('Usage: encrypt|decrypt INPUT OUTPUT');
  }

  const input = resolve(source);
  const output = resolve(destination);

  if (input === output) {
    throw new Error('Input and output must differ');
  }

  const key = loadKey();
  const temporary = `${output}.partial-${randomBytes(8).toString('hex')}`;

  try {
    if (mode === 'encrypt') {
      await encrypt(input, temporary, key);
    } else {
      await decrypt(input, temporary, key);
    }

    // Refuse to overwrite an existing output.
    await link(temporary, output);
  } finally {
    await unlink(temporary).catch(() => {});
    key.fill(0);
  }

  console.log(`GCM ${mode.toUpperCase()}: PASS`);
}

main().catch((error) => {
  console.error(`GCM OPERATION: FAIL (${error.message})`);
  process.exitCode = 1;
});
