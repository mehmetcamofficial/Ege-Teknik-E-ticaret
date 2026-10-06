/**
 * In-memory stand-ins for the order route's infrastructure - the database, legal-document loading,
 * the Idempotency-Key header and the HTTP helpers - so tests/order-marketing-consent.test.ts can run
 * the REAL POST /api/orders handler (its validation, pricing, delivery plan, legal acceptance and
 * transaction logic) and inspect exactly which rows it would write, and so tests/order-lookup-route.test.ts
 * can run the REAL POST /api/orders/lookup handler the same way. order-route-hooks.mjs loads this
 * module in place of "@/db", "@/lib/legal-db", "@/lib/request-security", "@/lib/http-security" and
 * "@/lib/order-lookup-db".
 *
 * Writes made inside db.transaction() are committed only when the callback succeeds, the same
 * all-or-nothing contract Postgres gives the route, so `state.committed` is what would persist.
 *
 * Not a *.test.ts file, so the test runner's glob does not execute it on its own.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type Table } from "drizzle-orm";
import { createHash } from "node:crypto";
import { containsCardData, isValidIdempotencyKey, trustedClientIp } from "../../lib/security-policy.ts";
import { hashLegalDocument } from "../../lib/legal.ts";

type Row = Record<string, unknown>;
export type Write = { kind: "insert" | "update"; table: string; values: unknown };

export const state = {
  committed: [] as Write[],
  products: [] as Row[],
  existingOrder: null as Row | null,
  required: [] as { slug: string; title: string; versionId: string }[],
  notices: [] as string[],
  /**
   * P3-LEGAL-3C.4/P2: the published BODY of each required legal version. A test can mutate this between a preview
   * and the order to simulate a template change, which must invalidate the preview.
   */
  legalBodies: {} as Record<string, string>,
  /** P3-A3: the guest lookup's in-memory order and items, plus what the store was asked for. */
  lookupOrder: null as Row | null,
  lookupItems: [] as Row[],
  storeCalls: [] as string[],
  /** What each handler asked of the limiter - observed, never simulated. */
  rateLimitCalls: [] as { request: Request; scope: string; limit: number; windowMs: number }[],
  /** When set, the fake limiter refuses exactly as the real one does: same status, same shared message. */
  rateLimitRefusal: null as { status: number; message: string } | null,
};

export function resetState() {
  state.committed.length = 0; // in place: the non-transactional db below writes into this same array
  state.products = [];
  state.existingOrder = null;
  state.required = [];
  state.notices = ["kvkk"];
  // P3-LEGAL-3C.4/P2: must be cleared too, or a template mutated by one test leaks into the next.
  for (const key of Object.keys(state.legalBodies)) delete state.legalBodies[key];
  state.lookupOrder = null;
  state.lookupItems = [];
  state.storeCalls.length = 0;
  state.rateLimitCalls.length = 0;
  state.rateLimitRefusal = null;
}

type Settle = (calls: ReadonlyMap<string, unknown[]>) => unknown;

/** A drizzle-style builder: every method chains, awaiting it resolves through `settle`. */
function builder(settle: Settle, onCall: (method: string, args: unknown[]) => void = () => {}): unknown {
  const calls = new Map<string, unknown[]>();
  const target = {
    then: (ok?: (value: unknown) => unknown, fail?: (error: unknown) => unknown) => Promise.resolve().then(() => settle(calls)).then(ok, fail),
  };
  const proxy: unknown = new Proxy(target, {
    get: (t, prop) => {
      if (prop === "then") return t.then;
      return (...args: unknown[]) => {
        calls.set(String(prop), args);
        onCall(String(prop), args);
        return proxy;
      };
    },
  });
  return proxy;
}

function tableName(table: unknown) {
  return getTableName(table as Table);
}

function selectResult(calls: ReadonlyMap<string, unknown[]>) {
  const from = tableName(calls.get("from")?.[0]);
  if (from === "orders") {
    if (state.existingOrder) return [state.existingOrder];
    const where = calls.get("where")?.[0];
    const key = where ? new PgDialect().sqlToQuery(where as Parameters<PgDialect["sqlToQuery"]>[0]).params[0] : undefined;
    const row = state.committed.find((w) => w.kind === "insert" && w.table === "orders" && (w.values as Row).idempotencyKey === key)?.values as Row | undefined;
    return row ? [{ ...row, status: "pending_payment" }] : [];
  }
  if (from === "order_legal_acceptances") {
    const where = calls.get("where")?.[0];
    const id = where ? new PgDialect().sqlToQuery(where as Parameters<PgDialect["sqlToQuery"]>[0]).params[0] : undefined;
    return state.committed.filter((w) => w.table === from).flatMap((w) => w.values as Row[]).filter((r) => r.orderId === id);
  }
  if (from === "products") return state.products.map((product) => ({ product }));
  return [];
}

function makeDb(sink: Write[]) {
  return {
    select: () => builder(selectResult),
    execute: async () => undefined,
    insert: (table: unknown) => {
      let values: unknown;
      return builder(
        (calls) => (calls.has("returning") ? [{ id: (values as Row).id }] : undefined),
        (method, args) => { if (method === "values") { values = args[0]; sink.push({ kind: "insert", table: tableName(table), values }); } },
      );
    },
    update: (table: unknown) => builder(
      (calls) => (calls.has("returning") ? [{ id: `${tableName(table)}-row` }] : undefined),
      (method, args) => { if (method === "set") sink.push({ kind: "update", table: tableName(table), values: args[0] }); },
    ),
  };
}

const db = {
  ...makeDb(state.committed),
  async transaction<T>(work: (tx: ReturnType<typeof makeDb>) => Promise<T>): Promise<T> {
    const pending: Write[] = [];
    const result = await work(makeDb(pending)); // a throw here discards `pending`: the rollback
    state.committed.push(...pending);
    return result;
  },
};

// ---- "@/db" ----------------------------------------------------------------------------------------
export function getDb() {
  return db;
}

// ---- "@/lib/legal-db" --------------------------------------------------------------------------------
export async function loadRequiredCheckoutLegalVersions() {
  return { ok: true as const, required: state.required };
}
/**
 * P3-LEGAL-3C.4/P2: the preview and the order re-render from the CURRENT published bodies, so the fake must expose
 * a body per required version. Derived from the same `state.required` the order validates against, so a test sees
 * exactly the versions that would really be used.
 */
export const DEFAULT_LEGAL_TEMPLATE_BODY = "Sözleşme {{ALICI_AD_SOYAD}} / {{TESLIMAT_ADRESI}} / {{SIPARIS_NO}} / {{SIPARIS_TARIHI}} / {{TESLIMAT_YONTEMI}} / {{ALICI_EPOSTA}} / {{ALICI_TELEFON}} / {{URUN_SATIRLARI}} / {{URUN_TOPLAMI}} / {{TOPLAM_TUTAR}} / {{KARGO_UCRETI}} / {{DIGER_EK_MASRAFLAR}} / {{FATURA_BILGILERI}}";
export async function loadRequiredCheckoutLegalDocuments() {
  return {
    ok: true as const,
    required: state.required.map((d) => {
      const body = state.legalBodies[d.versionId] ?? DEFAULT_LEGAL_TEMPLATE_BODY;
      return { slug: d.slug, title: d.title, versionId: d.versionId, version: 1, contentHash: hashLegalDocument({ title: d.title, body }), body };
    }),
  };
}
export async function loadCurrentLegalIndex() {
  return state.notices.map((slug) => ({ slug }));
}
/**
 * P3-LEGAL-3B: the route reads the accepted versions back after the transaction. The fake derives them
 * from the same `state.required` it validated against, so a test sees exactly the versions the order
 * would really have persisted - no separate fixture to drift.
 */
export async function loadOrderAcceptedLegalDocuments() {
  return state.required.map((d) => ({ slug: d.slug, title: d.title, version: 1, documentVersionId: d.versionId, acceptedAt: new Date(0).toISOString(), publishedAt: null, effectiveAt: null }));
}

// ---- "@/lib/request-security" (same rule as the real module, with the real validator) ---------------
/** The real module exports this too. Mirrored here so a route that reaches for it is exercised rather
 *  than failed at import time; the identity is the REAL P3-S1A one and the salted-hash contract, salt
 *  length included, is the real one. */
export async function hashClientIp(request: Request) {
  const secret = process.env.IP_HASH_SALT;
  if (!secret || secret.length < 32) throw new Error("IP_HASH_SALT must contain at least 32 characters");
  return createHash("sha256").update(`${secret}:${trustedClientIp(request.headers)}`).digest("hex");
}

export function idempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  return isValidIdempotencyKey(value) ? value! : null;
}

// ---- "@/lib/http-security" ---------------------------------------------------------------------------
/** Records how the handler limits itself; the real limiter's semantics are covered by tests/rate-limit-atomic.test.ts. */
export async function rateLimit(request: Request, scope: string, limit: number, windowMs: number) {
  state.rateLimitCalls.push({ request, scope, limit, windowMs });
  // Optional: refuse the way the real limiter does, so a route's 429 path can actually be executed.
  if (state.rateLimitRefusal) throw new HttpError(state.rateLimitRefusal.status, state.rateLimitRefusal.message);
}
/** Card data is refused by the REAL detector (lib/security-policy.ts), exactly as production does. */
export async function readJson(request: Request) {
  const value = JSON.parse(await request.text()) as unknown;
  if (containsCardData(value)) throw new HttpError(400, "Kart verisi bu sistem tarafından kabul edilmez.");
  return value;
}
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
/** Errors propagate to the test instead of becoming a generic 500, so a crash cannot pass silently. */
export function publicRoute(handler: (request: Request) => Promise<Response>) {
  return handler;
}

// ---- "@/lib/order-lookup-db" (P3-A3) ------------------------------------------------------------------
/** The store the real route uses. Two READ methods only - there is no write path to call. */
export const orderLookupStore = {
  async findByOrderNumber(orderNumber: string) {
    state.storeCalls.push(`find:${orderNumber}`);
    const row = state.lookupOrder;
    return row && row.orderNumber === orderNumber ? ({ ...row }) : null;
  },
  async listItemsForOrder(orderId: string) {
    state.storeCalls.push(`items:${orderId}`);
    // The harness models one order at a time (as state.existingOrder does for the create route), so the
    // items in state are already this order's; only the id the route asked for is recorded.
    return state.lookupItems;
  },
};
