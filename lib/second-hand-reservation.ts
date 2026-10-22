export type ExistingReservation = { id: string; productId: string; expiresAt: Date };
export type SecondHandReservationTx = {
  findReservation(id: string): Promise<ExistingReservation | null>;
  deleteReservation(id: string): Promise<void>;
  lockPublishedProduct(id: string): Promise<{ id: string; stock: number } | null>;
  countActiveReservations(productId: string, now: Date): Promise<number>;
  insertReservation(input: { id: string; productId: string; name: string; phone: string; expiresAt: Date }): Promise<void>;
};
export type SecondHandReservationDependencies = {
  transactionProductExclusive<T>(productId: string, work: (tx: SecondHandReservationTx) => Promise<T>): Promise<T>;
};
export type SecondHandReservationResult =
  | { ok: true; created: boolean; reservationId: string; expiresAt: Date }
  | { ok: false; code: "UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" };

/** Serializes claims for one product and counts only unexpired reservations against stock. */
export function reserveSecondHandProduct(
  input: { reservationId: string; productId: string; name: string; phone: string; now: Date; expiresAt: Date },
  deps: SecondHandReservationDependencies,
): Promise<SecondHandReservationResult> {
  return deps.transactionProductExclusive(input.productId, async (tx) => {
    const existing = await tx.findReservation(input.reservationId);
    if (existing && existing.expiresAt.getTime() > input.now.getTime()) {
      if (existing.productId !== input.productId) return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
      return { ok: true as const, created: false, reservationId: existing.id, expiresAt: existing.expiresAt };
    }
    if (existing) await tx.deleteReservation(existing.id);

    const product = await tx.lockPublishedProduct(input.productId);
    if (!product || product.stock < 1) return { ok: false as const, code: "UNAVAILABLE" as const };
    if (await tx.countActiveReservations(product.id, input.now) >= product.stock) return { ok: false as const, code: "UNAVAILABLE" as const };
    await tx.insertReservation({ id: input.reservationId, productId: product.id, name: input.name, phone: input.phone, expiresAt: input.expiresAt });
    return { ok: true as const, created: true, reservationId: input.reservationId, expiresAt: input.expiresAt };
  });
}
