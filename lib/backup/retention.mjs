/**
 * H5-C: retention POLICY and PLAN. Phase one is report-only: nothing in this codebase can delete a backup.
 * AUTOMATIC_DELETION_ENABLED is a compile-time constant, not an environment switch, so a stray variable cannot turn deletion on;
 * enabling it later is a reviewed code change (and the Drive client has no delete method at all).
 */
import { ARCHIVE_NAME } from './manifest.mjs';
export const AUTOMATIC_DELETION_ENABLED = false;

export const DEFAULT_POLICY = Object.freeze({ keepDaily: 30, keepWeekly: 12, keepMonthly: 12, minKeep: 7 });
const RANGES = { keepDaily: [7, 365], keepWeekly: [0, 104], keepMonthly: [0, 120], minKeep: [3, 365] };

export function loadPolicy(env = {}) {
  const policy = { ...DEFAULT_POLICY };
  const names = { keepDaily: 'BACKUP_RETENTION_DAILY', keepWeekly: 'BACKUP_RETENTION_WEEKLY', keepMonthly: 'BACKUP_RETENTION_MONTHLY', minKeep: 'BACKUP_RETENTION_MIN_KEEP' };
  for (const [key, variable] of Object.entries(names)) {
    if (env[variable] === undefined || env[variable] === '') continue;
    const n = Number(env[variable]);
    if (!Number.isInteger(n) || n < RANGES[key][0] || n > RANGES[key][1]) throw Object.assign(new Error(`${variable} must be an integer in ${RANGES[key].join('..')}`), { code: 'invalid_policy' });
    policy[key] = n;
  }
  return policy;
}

const isoWeek = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${Math.ceil(((t - y0) / 86400000 + 1) / 7)}`; };
const dayKey = (d) => d.toISOString().slice(0, 10), monthKey = (d) => d.toISOString().slice(0, 7);

/**
 * listing: [{ name, createdAt: Date|string }]. Only objects whose name is a backup ARCHIVE are ever considered; every other file
 * (checksums, manifests, anything foreign) is reported as `ignored` and can never become a candidate.
 */
export function planRetention(listing, policy = DEFAULT_POLICY, now = new Date()) {
  const archives = [], ignored = [];
  for (const f of listing) (ARCHIVE_NAME.test(f.name) ? archives : ignored).push({ name: f.name, createdAt: new Date(f.createdAt) });
  archives.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
  const keep = new Map(), why = (name, reason) => keep.set(name, [...(keep.get(name) ?? []), reason]);
  archives.slice(0, policy.minKeep).forEach((a) => why(a.name, 'min-keep'));
  const seen = { d: new Set(), w: new Set(), m: new Set() };
  for (const a of archives) {
    const age = (now - a.createdAt) / 86400000;
    const d = dayKey(a.createdAt), w = isoWeek(a.createdAt), m = monthKey(a.createdAt);
    if (age <= policy.keepDaily && !seen.d.has(d)) { seen.d.add(d); why(a.name, 'daily'); }
    if (seen.w.size < policy.keepWeekly && !seen.w.has(w)) { seen.w.add(w); why(a.name, 'weekly'); }
    if (seen.m.size < policy.keepMonthly && !seen.m.has(m)) { seen.m.add(m); why(a.name, 'monthly'); }
  }
  return {
    mode: 'report-only', automaticDeletionEnabled: AUTOMATIC_DELETION_ENABLED, policy,
    keep: archives.filter((a) => keep.has(a.name)).map((a) => ({ name: a.name, reasons: keep.get(a.name) })),
    candidates: archives.filter((a) => !keep.has(a.name)).map((a) => a.name),
    ignored: ignored.map((f) => f.name),
  };
}

/** Deliberately unusable in this phase. */
export function executeRetentionPlan() { throw Object.assign(new Error('Automatic deletion is disabled in this release'), { code: 'automatic_deletion_disabled' }); }
