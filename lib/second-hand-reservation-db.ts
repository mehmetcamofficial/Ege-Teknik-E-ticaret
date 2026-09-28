import { and, count, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import type { SecondHandReservationDependencies } from "./second-hand-reservation.ts";

const { secondHandProducts, secondHandReservations } = schema;

/** The real PostgreSQL side of reserveSecondHandProduct: one transaction, a per-product advisory lock, then a row lock. */
export function secondHandReservationDeps(db: NodePgDatabase<typeof schema>): SecondHandReservationDependencies {
  return {
    transactionProductExclusive: (productId, work) => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1164674122, hashtext(${productId}))`);
    return work({
      findReservation: async (reservationId) => {
        const [row] = await tx.select({ id: secondHandReservations.id, productId: secondHandReservations.productId, expiresAt: secondHandReservations.expiresAt })
          .from(secondHandReservations).where(eq(secondHandReservations.id, reservationId)).limit(1);
        return row ?? null;
      },
      deleteReservation: async (reservationId) => { await tx.delete(secondHandReservations).where(eq(secondHandReservations.id, reservationId)); },
      lockPublishedProduct: async (productIdToLock) => {
        const [row] = await tx.select({ id: secondHandProducts.id, stock: secondHandProducts.stock }).from(secondHandProducts)
          .where(and(eq(secondHandProducts.id, productIdToLock), eq(secondHandProducts.status, "published"), gt(secondHandProducts.stock, 0))).for("update").limit(1);
        return row ?? null;
      },
      countActiveReservations: async (productIdToCount, at) => {
        const [row] = await tx.select({ value: count() }).from(secondHandReservations)
          .where(and(eq(secondHandReservations.productId, productIdToCount), gt(secondHandReservations.expiresAt, at)));
        return row.value;
      },
      insertReservation: async (values) => { await tx.insert(secondHandReservations).values(values); },
    });
  }),
  };
}
