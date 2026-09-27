import { cancellationBlockedByCollection, derivePaymentStatus, ledgerCoversOrder, type OrderPaymentStatus } from "./finance.ts";
import { canTransitionOrder, type OrderStatus } from "./order-domain.ts";

export type OrderTransitionActor = { userId: string; email: string };
export type TransitionOrderItem = { productId: string | null; quantity: number };

export type OrderTransitionTx = {
  lockOrder(id: string): Promise<{ status: OrderStatus; total: number; paymentStatus: string } | null>;
  /** Ledger truth (Phase 3.3A): paid payment rows and completed refund rows of the locked order. */
  ledgerSums(orderId: string): Promise<{ collected: number; refunded: number }>;
  listItems(orderId: string): Promise<TransitionOrderItem[]>;
  compareAndSetStatus(id: string, expected: OrderStatus, next: OrderStatus, paymentStatus: OrderPaymentStatus): Promise<boolean>;
  releaseInventory(productId: string, quantity: number): Promise<boolean>;
  createShipment(orderId: string, status: "shipped" | "delivery"): Promise<void>;
  createInstallationJob(orderId: string): Promise<void>;
  insertAudit(input: { actor: OrderTransitionActor; orderId: string; from: OrderStatus; to: OrderStatus; paymentStatus: { from: string; to: OrderPaymentStatus }; stockReleased?: TransitionOrderItem[] }): Promise<void>;
};

export type OrderTransitionDependencies = {
  transaction<T>(work: (tx: OrderTransitionTx) => Promise<T>): Promise<T>;
};

export type OrderTransitionResult =
  | { ok: true; paymentStatus: OrderPaymentStatus }
  | { ok: false; code: "NOT_FOUND" | "STALE" | "INVALID_TRANSITION" | "INVENTORY_INVARIANT" | "PAYMENT_NOT_RECORDED" | "REFUND_REQUIRED"; actual?: OrderStatus };

class TransitionRollback extends Error {
  readonly code: "STALE" | "INVENTORY_INVARIANT";
  constructor(code: "STALE" | "INVENTORY_INVARIANT") { super(code); this.code = code; }
}

/** One explicit order-state transition, including every database side effect and its audit. */
export async function transitionOrder(
  input: { orderId: string; expectedStatus: OrderStatus; nextStatus: OrderStatus; actor: OrderTransitionActor },
  deps: OrderTransitionDependencies,
): Promise<OrderTransitionResult> {
  try {
    return await deps.transaction(async (tx) => {
      const current = await tx.lockOrder(input.orderId);
      if (!current) return { ok: false as const, code: "NOT_FOUND" as const };
      if (current.status !== input.expectedStatus) return { ok: false as const, code: "STALE" as const, actual: current.status };
      if (!canTransitionOrder(current.status, input.nextStatus)) return { ok: false as const, code: "INVALID_TRANSITION" as const, actual: current.status };

      // Finance guards (Phase 3.3A) run on the LOCKED row, before anything is written: the lifecycle status `paid` needs the ledger to
      // hold the full total, and cancelling needs collected money to be refunded first. payment_status is only ever DERIVED from the
      // ledger; nothing here (or in a route) sets it by hand.
      const { collected, refunded } = await tx.ledgerSums(input.orderId);
      if (input.nextStatus === "paid" && !ledgerCoversOrder(current.total, collected, refunded)) return { ok: false as const, code: "PAYMENT_NOT_RECORDED" as const, actual: current.status };
      if (input.nextStatus === "cancelled" && cancellationBlockedByCollection(collected, refunded)) return { ok: false as const, code: "REFUND_REQUIRED" as const, actual: current.status };
      const nextPayment = derivePaymentStatus({ total: current.total, orderStatus: input.nextStatus, collected, refunded });

      const items = input.nextStatus === "cancelled" ? await tx.listItems(input.orderId) : [];
      if (!(await tx.compareAndSetStatus(input.orderId, current.status, input.nextStatus, nextPayment))) throw new TransitionRollback("STALE");

      const released: TransitionOrderItem[] = [];
      if (input.nextStatus === "cancelled") {
        for (const item of items) {
          if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || !(await tx.releaseInventory(item.productId, item.quantity))) {
            throw new TransitionRollback("INVENTORY_INVARIANT");
          }
          released.push(item);
        }
      }
      if (input.nextStatus === "shipped" || input.nextStatus === "delivery") await tx.createShipment(input.orderId, input.nextStatus);
      if (input.nextStatus === "installation") await tx.createInstallationJob(input.orderId);
      await tx.insertAudit({ actor: input.actor, orderId: input.orderId, from: current.status, to: input.nextStatus, paymentStatus: { from: current.paymentStatus, to: nextPayment }, ...(input.nextStatus === "cancelled" ? { stockReleased: released } : {}) });
      return { ok: true as const, paymentStatus: nextPayment };
    });
  } catch (error) {
    if (error instanceof TransitionRollback) return { ok: false, code: error.code };
    throw error;
  }
}
