import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reserveSecondHandProduct, type SecondHandReservationTx } from "../lib/second-hand-reservation.ts";

const NOW = new Date("2026-09-28T12:00:00Z");
const expiry = new Date(NOW.getTime() + 30 * 60_000);
const input = (id: string, productId = "used-1") => ({ reservationId: id, productId, name: "Ada", phone: "05001112233", now: NOW, expiresAt: expiry });

function store(options: { stock?: number; failInsert?: boolean } = {}) {
  const state = {
    products: new Map([["used-1", { id: "used-1", stock: options.stock ?? 1, published: true }]]),
    reservations: new Map<string, { id: string; productId: string; expiresAt: Date; name: string; phone: string }>(),
  };
  const tails = new Map<string, Promise<void>>();
  return {
    state,
    deps: {
      transactionProductExclusive: async <T>(productId: string, work: (tx: SecondHandReservationTx) => Promise<T>) => {
        const previous = tails.get(productId) ?? Promise.resolve();
        let release!: () => void;
        tails.set(productId, new Promise<void>((resolve) => { release = resolve; }));
        await previous;
        const snapshot = structuredClone(state.reservations);
        try {
          return await work({
            findReservation: async (id) => state.reservations.get(id) ?? null,
            deleteReservation: async (id) => { state.reservations.delete(id); },
            lockPublishedProduct: async (id) => {
              const product = state.products.get(id);
              return product?.published ? { id: product.id, stock: product.stock } : null;
            },
            countActiveReservations: async (id, now) => [...state.reservations.values()].filter((reservation) => reservation.productId === id && reservation.expiresAt > now).length,
            insertReservation: async (reservation) => {
              if (options.failInsert) throw new Error("injected insert failure");
              state.reservations.set(reservation.id, reservation);
            },
          });
        } catch (error) {
          state.reservations = snapshot;
          throw error;
        } finally {
          release();
        }
      },
    },
  };
}

test("stock=1 and two simultaneous distinct claims produce exactly one reservation", async () => {
  const db = store();
  const results = await Promise.all([reserveSecondHandProduct(input("r1"), db.deps), reserveSecondHandProduct(input("r2"), db.deps)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.code === "UNAVAILABLE").length, 1);
  assert.equal(db.state.reservations.size, 1);
});

test("same idempotency key is a replay, including simultaneous retry, and never duplicates", async () => {
  const db = store();
  const results = await Promise.all([reserveSecondHandProduct(input("same"), db.deps), reserveSecondHandProduct(input("same"), db.deps)]);
  assert.equal(results.filter((result) => result.ok && result.created).length, 1);
  assert.equal(results.filter((result) => result.ok && !result.created).length, 1);
  assert.equal(db.state.reservations.size, 1);
});

test("stock=0 fails with no write", async () => {
  const db = store({ stock: 0 });
  assert.deepEqual(await reserveSecondHandProduct(input("r1"), db.deps), { ok: false, code: "UNAVAILABLE" });
  assert.equal(db.state.reservations.size, 0);
});

test("expired reservations do not consume stock and an expired same-key row is replaced", async () => {
  const db = store();
  db.state.reservations.set("old", { id: "old", productId: "used-1", name: "Ada", phone: "05001112233", expiresAt: new Date(NOW.getTime() - 1) });
  const result = await reserveSecondHandProduct(input("old"), db.deps);
  assert.equal(result.ok && result.created, true);
  assert.equal(db.state.reservations.size, 1);
  assert.equal(db.state.reservations.get("old")?.expiresAt.getTime(), expiry.getTime());
});

test("transaction failure leaves no partial reservation", async () => {
  const db = store({ failInsert: true });
  await assert.rejects(() => reserveSecondHandProduct(input("r1"), db.deps), /injected insert failure/);
  assert.equal(db.state.reservations.size, 0);
});

test("reservation route uses a transaction advisory lock, row lock and active-count capacity check", () => {
  const route = readFileSync("app/api/second-hand/reservations/route.ts", "utf8");
  assert.match(route, /db\.transaction/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /\.for\("update"\)/);
  assert.match(route, /gt\(secondHandReservations\.expiresAt,\s*at\)/);
  assert.match(route, /countActiveReservations/);
});
