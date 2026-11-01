import { createHash, timingSafeEqual } from "node:crypto";
import { sqlStateOf } from "./sqlstate.ts";
import { WorkerIdentityError } from "./worker-identity.ts";

/**
 * The behaviour of /api/internal/notifications/dispatch, with every dependency injected so it can be tested without a server.
 * Order of checks: feature present (404) -> caller authorized (401) -> mandatory configuration (503) -> only then the database.
 */
export type DispatchDeps<Db, Provider> = {
  env: Record<string, string | undefined>;
  parseRecipients: (value: string | undefined) => string[];
  getWorkerDb: () => Db;
  attest: (db: Db) => Promise<void>;
  makeProvider: (env: Record<string, string | undefined>) => Provider;
  run: (input: { db: Db; provider: Provider; env: Record<string, string | undefined> }) => Promise<Record<string, unknown>>;
  logError: (event: string, fields: Record<string, string>) => void;
};

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
/** Compare fixed-length digests so neither the length nor the content of the secret is observable through timing. */
const sameSecret = (presented: string, secret: string) => timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(secret).digest());

export async function handleDispatch<Db, Provider>(request: Request, deps: DispatchDeps<Db, Provider>): Promise<Response> {
  const secret = deps.env.NOTIFICATION_DISPATCH_SECRET?.trim();
  if (!secret || secret.length < 32) return json({ error: "not_configured" }, 404);
  const presented = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!sameSecret(presented, secret)) return json({ error: "unauthorized" }, 401);
  // ORDER_ALERT_EMAILS is mandatory: there is no admin_users fallback (the dedicated worker role has no access to that table).
  if (!deps.parseRecipients(deps.env.ORDER_ALERT_EMAILS).length) return json({ error: "not_configured" }, 503);
  try {
    const db = deps.getWorkerDb();
    await deps.attest(db);
    const result = await deps.run({ db, provider: deps.makeProvider(deps.env), env: deps.env });
    return json({ ok: true, ...result }, 200);
  } catch (error) {
    // Fail closed and say nothing: a fixed code for the operator log, never a message, host, role, URL or SQL.
    deps.logError("notification_dispatch_unavailable", { code: error instanceof WorkerIdentityError ? "identity" : sqlStateOf(error) });
    return json({ error: "worker_unavailable" }, 503);
  }
}
