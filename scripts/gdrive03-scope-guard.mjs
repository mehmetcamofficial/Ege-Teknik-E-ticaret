// GDRIVE-03 narrow PR scope guard. Reads `git diff --name-status` lines on stdin and fails unless the change is EXACTLY a subset of the
// allowed GDRIVE-03 files (added or edited, never deleted or renamed). Also checks the added workflow files for anything that could touch production or run unattended.
// Usage: git diff --name-status BASE...HEAD | node scripts/gdrive03-scope-guard.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOWED = new Set([
  '.github/workflows/gdrive03-isolated-chain.yml', '.github/workflows/gdrive03-narrow-ci.yml',
  'scripts/gdrive03-scope-guard.mjs', 'scripts/gdrive03-verify-restore.mjs',
  'scripts/create-verified-backup.sh', 'scripts/backup-dump.mjs', 'scripts/backup-crypto-gcm.mjs', 'scripts/backup-create-manifest.mjs',
  'scripts/backup-drive-upload.mjs', 'scripts/restore-encrypted-backup.mjs', 'scripts/backup-decrypt.mjs',
  'lib/backup/drive-client.mjs', 'lib/backup/drive-upload.mjs', 'lib/backup/manifest.mjs',
  'tests/gdrive03-isolated-chain.test.mjs', 'tests/gdrive03-scope-guard.test.mjs', 'tests/fixtures/gdrive03-synthetic-seed.sql',
  'docs/ops/gdrive03-isolated-test-runbook.md', 'docs/ops/gdrive03-gcp-plan.md',
  'lib/backup/drive-folder-safety.mjs', 'scripts/gdrive03-admin-folder-evidence.mjs', 'tests/gdrive03-folder-safety.test.mjs',
  'docs/ops/gdrive03-folder-evidence-runbook.md',
]);

export function checkChangeList(lines) {
  const problems = [];
  for (const line of lines.filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    // Additions and in-place edits of allowlisted files only; deletions and renames never.
    if (status !== 'A' && status !== 'M') problems.push(`only additions and edits are allowed, got ${status} ${paths.join(' -> ')}`);
    for (const p of paths) if (!ALLOWED.has(p)) problems.push(`path outside the GDRIVE-03 scope: ${p}`);
  }
  return problems;
}

/** Workflow files shipped by this change: no schedule, no pull_request_target, nothing production-shaped. */
export function checkWorkflows(dir = '.github/workflows', only = [...ALLOWED].filter((p) => p.startsWith('.github/workflows/'))) {
  const problems = [];
  for (const rel of only) {
    let text; try { text = readFileSync(join(dir, rel.split('/').pop()), 'utf8'); } catch { continue; }
    const body = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    if (/^\s*(schedule:|- cron:)/m.test(body)) problems.push(`${rel}: scheduled trigger`);
    if (/pull_request_target|repository_dispatch|workflow_run/.test(body)) problems.push(`${rel}: unsafe trigger`);
    if (/secrets\./.test(body)) problems.push(`${rel}: references a secret`);
    if (/NEON_PRODUCTION|BACKUP_ENABLED|GDRIVE_BACKUP_FOLDER_ID|GDRIVE_WIF_PROVIDER|GDRIVE_SERVICE_ACCOUNT|EGE_GDRIVE|neon\.tech/.test(body)) problems.push(`${rel}: production identifier`);
    if (/id-token: write/.test(body) && !rel.endsWith('gdrive03-isolated-chain.yml')) problems.push(`${rel}: id-token on a non-GDRIVE-03 workflow`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const input = readFileSync(0, 'utf8').split('\n');
  const problems = [...checkChangeList(input), ...checkWorkflows()];
  const files = input.filter(Boolean).length;
  if (problems.length) { for (const p of problems) console.error(`SCOPE GUARD FAIL: ${p}`); process.exit(1); }
  console.log(`SCOPE GUARD PASS: ${files} added file(s), all inside the GDRIVE-03 allowlist; no cron, secrets, production names or stray id-token.`);
}
