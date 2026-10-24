import { getNotificationWorkerDb } from "@/db";
import { handleDispatch } from "@/lib/notifications/dispatch-handler";
import { parseRecipientList, runNotificationWorker } from "@/lib/notifications/outbox";
import { resendProvider } from "@/lib/notifications/provider";
import { assertNotificationWorkerIdentity, readWorkerIdentity } from "@/lib/notifications/worker-identity";

export const dynamic = "force-dynamic";

/**
 * H5-A worker trigger (Vercel Cron style: GET + `Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>`).
 * Not a public or admin route: without the secret it answers 404 (feature absent) or 401. It returns counts only -
 * never a recipient, subject, body or order data. It runs AFTER orders are committed and is safe to call repeatedly.
 * It uses ONLY the dedicated worker connection (never owner/storefront/admin) and refuses to run on an over-privileged identity.
 * All behaviour lives in lib/notifications/dispatch-handler.ts, where it is unit-tested with injected dependencies.
 */
export async function GET(request: Request) {
  return handleDispatch(request, {
    env: process.env,
    parseRecipients: parseRecipientList,
    getWorkerDb: getNotificationWorkerDb,
    attest: (db) => assertNotificationWorkerIdentity(() => readWorkerIdentity(db)),
    makeProvider: resendProvider,
    run: runNotificationWorker,
    logError: (event, fields) => console.error(event, fields),
  });
}
