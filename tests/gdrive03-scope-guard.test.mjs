import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALLOWED, checkChangeList, checkWorkflows } from '../scripts/gdrive03-scope-guard.mjs';

test('the exact allowlist, all added, passes', () => {
  assert.deepEqual(checkChangeList([...ALLOWED].map((p) => `A\t${p}`)), []);
});

test('anything outside the allowlist is refused: app code, migrations, deploy config, production workflows', () => {
  for (const p of ['app/page.tsx', 'drizzle-pg/0024_x.sql', 'drizzle/0001_x.sql', 'db/schema.ts', 'next.config.ts', 'package.json', 'vercel.json',
    '.github/workflows/neon-production-backup.yml', '.github/workflows/production-db-backup.yml', 'scripts/backup-retention-report.mjs']) {
    assert.equal(checkChangeList([`A\t${p}`]).length, 1, p);
  }
});

test('editing an allowlisted file is accepted; editing anything else, deleting or renaming is refused', () => {
  assert.deepEqual(checkChangeList(['M\tlib/backup/drive-upload.mjs', 'A\tlib/backup/drive-folder-safety.mjs']), []);
  assert.equal(checkChangeList(['M\tpackage.json']).length, 1);
  assert.equal(checkChangeList(['M\tapp/page.tsx']).length, 1);
  assert.equal(checkChangeList(['D\tscripts/backup-dump.mjs']).length, 1);
  assert.equal(checkChangeList(['R100\tscripts/a.mjs\tscripts/backup-dump.mjs']).length >= 1, true);
});

test('shipped workflows are refused when they gain a cron, a secret, a production name or a stray id-token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gd03-guard-'));
  const write = (name, body) => writeFile(join(dir, name), body);
  try {
    await write('gdrive03-isolated-chain.yml', 'on:\n  workflow_dispatch:\npermissions:\n  id-token: write\n');
    await write('gdrive03-narrow-ci.yml', 'on:\n  pull_request:\n');
    assert.deepEqual(checkWorkflows(dir), []);
    await write('gdrive03-narrow-ci.yml', 'on:\n  schedule:\n    - cron: "0 1 * * *"\n');
    assert.match(checkWorkflows(dir).join('|'), /scheduled trigger/);
    await write('gdrive03-narrow-ci.yml', 'on:\n  pull_request:\nenv:\n  A: ${{ secrets.X }}\n');
    assert.match(checkWorkflows(dir).join('|'), /references a secret/);
    await write('gdrive03-narrow-ci.yml', 'on:\n  pull_request:\nenv:\n  A: BACKUP_ENABLED\n');
    assert.match(checkWorkflows(dir).join('|'), /production identifier/);
    await write('gdrive03-narrow-ci.yml', 'on:\n  pull_request:\npermissions:\n  id-token: write\n');
    assert.match(checkWorkflows(dir).join('|'), /id-token on a non-GDRIVE-03/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
