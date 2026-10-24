/**
 * Which orders the outbox sweep may re-enqueue. The default is the original behaviour (the last 30 minutes, orders older than 60 s so an
 * in-flight checkout is never raced). A longer window recovers orders after a long worker outage, but only together with a go-live floor
 * (NOTIFICATION_SWEEP_NOT_BEFORE), so history from before the feature existed is NEVER mailed. Anything invalid falls back to the default.
 * Duplicates are impossible either way: notification_outbox.dedupe_key is unique and the sweep inserts ON CONFLICT DO NOTHING.
 */
export const DEFAULT_SWEEP_WINDOW_MINUTES = 30;
export const MAX_SWEEP_WINDOW_MINUTES = 7 * 24 * 60;
export const SWEEP_SETTLE_SECONDS = 60;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type SweepBounds = { since: Date; settled: Date; windowMinutes: number; floor: Date | null };

export function sweepBounds(env: Record<string, string | undefined>, now: Date): SweepBounds {
  const settled = new Date(now.getTime() - SWEEP_SETTLE_SECONDS * 1000);
  const fallback = (): SweepBounds => ({ since: new Date(now.getTime() - DEFAULT_SWEEP_WINDOW_MINUTES * 60_000), settled, windowMinutes: DEFAULT_SWEEP_WINDOW_MINUTES, floor: null });
  const rawWindow = env.NOTIFICATION_SWEEP_WINDOW_MINUTES?.trim(), rawFloor = env.NOTIFICATION_SWEEP_NOT_BEFORE?.trim();
  if (!rawWindow && !rawFloor) return fallback();
  const windowMinutes = rawWindow && /^\d{1,6}$/.test(rawWindow) ? Number(rawWindow) : NaN;
  // Strict ISO-8601 WITH a zone: Date.parse alone accepts "1" (year 2001) or a zone-less local time, which would silently void the floor.
  const floorTime = rawFloor && ISO_WITH_ZONE.test(rawFloor) ? Date.parse(rawFloor) : NaN;
  const windowOk = Number.isInteger(windowMinutes) && windowMinutes >= DEFAULT_SWEEP_WINDOW_MINUTES && windowMinutes <= MAX_SWEEP_WINDOW_MINUTES;
  const floorOk = Number.isFinite(floorTime) && floorTime <= now.getTime();
  // A longer window is only trusted together with a valid floor; any inconsistency means the safe default.
  if (!windowOk || !floorOk) return fallback();
  const floor = new Date(floorTime);
  return { since: new Date(Math.max(now.getTime() - windowMinutes * 60_000, floor.getTime())), settled, windowMinutes, floor };
}
