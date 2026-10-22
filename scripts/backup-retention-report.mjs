// H5-C: REPORT-ONLY retention plan for the Drive backup folder. Deletes nothing: the Drive client has no delete method and
// lib/backup/retention.mjs fixes AUTOMATIC_DELETION_ENABLED = false. env: GDRIVE_ACCESS_TOKEN, GDRIVE_FOLDER_ID, BACKUP_RETENTION_* (optional)
import { createDriveClient } from '../lib/backup/drive-client.mjs';
import { loadPolicy, planRetention } from '../lib/backup/retention.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function report(env = process.env, deps = {}) {
  const client = deps.client ?? createDriveClient({ getAccessToken: async () => env.GDRIVE_ACCESS_TOKEN ?? '' });
  const listing = (await client.listChildren(env.GDRIVE_FOLDER_ID)).map((f) => ({ name: f.name, createdAt: f.createdTime }));
  return planRetention(listing, loadPolicy(env), deps.now ?? new Date());
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  report().then((p) => console.log(`RETENTION REPORT (report-only, nothing deleted): keep=${p.keep.length} candidates=${p.candidates.length} ignored=${p.ignored.length} policy=${JSON.stringify(p.policy)}`))
    .catch(() => { console.error('RETENTION REPORT: FAIL'); process.exitCode = 1; });
}
