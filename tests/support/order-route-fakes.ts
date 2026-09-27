/**
 * In-memory stand-ins for the order route's infrastructure - the database, legal-document loading,
 * the Idempotency-Key header and the HTTP helpers - so tests/order-marketing-consent.test.ts can run
 * the REAL POST /api/orders handler (its validation, pricing, delivery plan, legal acceptance and
 * transaction logic) and inspect exactly which rows it would write. order-route-hooks.mjs loads this
 * module in place of "@/db", "@/lib/legal-db", "@/lib/request-security" and "@/lib/http-security".
 *
 * Writes made inside db.transaction() are committed only when the callback succeeds, the same
 * all-or-nothing contract Postgres gives the route, so `state.committed` is what would persist.
 *
 * Not a *.test.ts file, so the test runner's glob does not execute it on its own.
 */
import { getTableName, type Table } from "drizzle-orm";
import { isValidIdempotencyKey } from "../../lib/security-policy.ts";

type Row = Record<string, unknown>;
export type Write = { kind: "insert" | "update"; table: string; values: unknown };

export const state = {
  committed: [] as Write[],
  products: [] as Row[],
  existingOrder: null as Row | null,
  required: [] as { slug: string; title: string; versionId: string }[],
  notices: [] as string[],
};

export function resetState() {
  state.committed.length = 0; // in place: the non-transactional db below writes into this same array
  state.products = [];
  state.existingOrder = null;
  state.required = [];
  state.notices = ["kvkk"];
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
  if (from === "orders") return state.existingOrder ? [state.existingOrder] : [];
  if (from === "products") return state.products.map((product) => ({ product }));
  return [];
}

function makeDb(sink: Write[]) {
  return {
    select: () => builder(selectResult),
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
export async function loadCurrentLegalIndex() {
  return state.notices.map((slug) => ({ slug }));
}

// ---- "@/lib/request-security" (same rule as the real module, with the real validator) ---------------
export function idempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  return isValidIdempotencyKey(value) ? value! : null;
}

// ---- "@/lib/http-security" ---------------------------------------------------------------------------
export async function rateLimit() {}
export async function readJson(request: Request) {
  return JSON.parse(await request.text()) as unknown;
}
/** Errors propagate to the test instead of becoming a generic 500, so a crash cannot pass silently. */
export function publicRoute(handler: (request: Request) => Promise<Response>) {
  return handler;
}
