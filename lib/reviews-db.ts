import { getDb } from "@/db";
import { auditLogs, orderItems, orders, productReviews, products } from "@/db/schema";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import {
  canTransitionReview, encodeReviewCursor, summarizeRatings, toPublicReview, verifyPurchase,
  type ReviewCursor, type ReviewSort, type ReviewStatus, type ReviewSubmission, reviewContentHash,
} from "@/lib/reviews";

/** Reviews are only readable/writable for products the storefront publishes. */
export async function findPublishedProduct(productId: string) {
  if (!productId || productId.length > 200) return null;
  const [row] = await getDb().select({ id: products.id, name: products.name }).from(products).where(and(eq(products.id, productId), eq(products.status, "published"))).limit(1);
  return row ?? null;
}

export async function loadReviewSummary(productId: string) {
  const groups = await getDb().select({ rating: productReviews.rating, count: sql<number>`count(*)::int` }).from(productReviews)
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, "approved"))).groupBy(productReviews.rating);
  return summarizeRatings(groups);
}

const publicColumns = { id: productReviews.id, rating: productReviews.rating, displayName: productReviews.displayName, body: productReviews.body, verifiedPurchase: productReviews.verifiedPurchase, createdAt: productReviews.createdAt };

/** Approved reviews only, keyset-paginated. Ties are broken by (created_at desc, id desc) for every sort. */
export async function listApprovedReviews(productId: string, sort: ReviewSort, cursor: ReviewCursor | null, limit: number) {
  const base = and(eq(productReviews.productId, productId), eq(productReviews.status, "approved"));
  const at = cursor ? new Date(cursor.createdAt) : null;
  const olderThanCursor = cursor && at ? or(lt(productReviews.createdAt, at), and(eq(productReviews.createdAt, at), lt(productReviews.id, cursor.id))) : undefined;
  const after = !cursor ? undefined
    : sort === "newest" ? olderThanCursor
    : sort === "highest" ? or(lt(productReviews.rating, cursor.rating), and(eq(productReviews.rating, cursor.rating), olderThanCursor))
    : or(gt(productReviews.rating, cursor.rating), and(eq(productReviews.rating, cursor.rating), olderThanCursor));
  const order = sort === "newest" ? [desc(productReviews.createdAt), desc(productReviews.id)]
    : sort === "highest" ? [desc(productReviews.rating), desc(productReviews.createdAt), desc(productReviews.id)]
    : [asc(productReviews.rating), desc(productReviews.createdAt), desc(productReviews.id)];
  const rows = await getDb().select(publicColumns).from(productReviews).where(after ? and(base, after) : base).orderBy(...order).limit(limit + 1);
  const page = rows.slice(0, limit);
  return { reviews: page.map(toPublicReview), nextCursor: rows.length > limit ? encodeReviewCursor(page[page.length - 1]) : null };
}

/** Order line for this exact product in this order, or null. Contact values never leave this module. */
async function findOrderLine(orderNumber: string, productId: string) {
  const [row] = await getDb().select({ orderItemId: orderItems.id, orderStatus: orders.status, phone: orders.phone, email: orders.email })
    .from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.orderNumber, orderNumber), eq(orderItems.productId, productId))).limit(1);
  return row ?? null;
}

export type SubmitResult = "stored" | "replayed" | "dropped";
/**
 * Stores a pending review. The caller always answers the same 202 whatever this returns, so neither the
 * verification outcome nor a duplicate is observable by the client.
 */
export async function submitReview(input: { productId: string; submission: ReviewSubmission; idempotencyKey: string; ipHash: string }): Promise<SubmitResult> {
  const db = getDb(), { submission } = input;
  const [replay] = await db.select({ id: productReviews.id }).from(productReviews).where(eq(productReviews.idempotencyKey, input.idempotencyKey)).limit(1);
  if (replay) return "replayed";
  if (submission.website) return "dropped";
  const orderItemId = submission.orderNumber && submission.contact ? verifyPurchase(await findOrderLine(submission.orderNumber, input.productId), submission.contact) : null;
  const row = {
    id: crypto.randomUUID(), productId: input.productId, rating: submission.rating, displayName: submission.displayName, body: submission.body,
    // status, moderation fields: DB defaults (pending / null). verified_purchase follows order_item_id (CHECK + trigger).
    verifiedPurchase: orderItemId !== null, orderItemId, contentHash: reviewContentHash(submission.body), idempotencyKey: input.idempotencyKey, ipHash: input.ipHash,
  };
  try {
    // Any unique conflict (idempotency race, duplicate live content, second live review for the same order line) is a silent no-op.
    const inserted = await db.insert(productReviews).values(row).onConflictDoNothing().returning({ id: productReviews.id });
    return inserted.length ? "stored" : "dropped";
  } catch (error) {
    // The guard trigger re-checks verification (e.g. the order changed status meanwhile): store the review unverified instead.
    if (orderItemId && (error as { code?: string })?.code === "23514") {
      const inserted = await db.insert(productReviews).values({ ...row, verifiedPurchase: false, orderItemId: null }).onConflictDoNothing().returning({ id: productReviews.id });
      return inserted.length ? "stored" : "dropped";
    }
    throw error;
  }
}

// ---- moderation --------------------------------------------------------------------------------------------
export type ModerationOutcome = { ok: true; status: ReviewStatus } | { ok: false; code: "NOT_FOUND" | "INVALID_TRANSITION" | "STALE" | "CONFLICT" };
type Actor = { userId: string; email: string };

export async function moderateReview(input: { reviewId: string; to: "approved" | "rejected"; note?: string; actor: Actor; ipHash: string }): Promise<ModerationOutcome> {
  const db = getDb();
  const [current] = await db.select({ status: productReviews.status }).from(productReviews).where(eq(productReviews.id, input.reviewId)).limit(1);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  if (!canTransitionReview(current.status, input.to)) return { ok: false, code: "INVALID_TRANSITION" };
  try {
    return await db.transaction(async (tx) => {
      // Conditional on the status the moderator saw: a concurrent decision makes this match nothing.
      const updated = await tx.update(productReviews).set({ status: input.to, moderatedAt: new Date(), moderatedBy: input.actor.userId, moderationNote: input.note || null })
        .where(and(eq(productReviews.id, input.reviewId), eq(productReviews.status, current.status))).returning({ id: productReviews.id });
      if (!updated.length) return { ok: false, code: "STALE" } as const;
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actor.userId, actorEmail: input.actor.email, action: `review.${input.to}`, entityType: "product_review", entityId: input.reviewId, payload: { from: current.status, to: input.to, note: input.note || null }, ipHash: input.ipHash });
      return { ok: true, status: input.to } as const;
    });
  } catch (error) {
    // Re-approving while another live review holds the same order line / content: unique index says no.
    if ((error as { code?: string })?.code === "23505") return { ok: false, code: "CONFLICT" };
    throw error;
  }
}

export async function listReviewsForAdmin(status: ReviewStatus, cursor: ReviewCursor | null, includeOrderNumber: boolean) {
  const db = getDb(), limit = 50, at = cursor ? new Date(cursor.createdAt) : null;
  const where = and(eq(productReviews.status, status), cursor && at ? or(lt(productReviews.createdAt, at), and(eq(productReviews.createdAt, at), lt(productReviews.id, cursor.id))) : undefined);
  const rows = await db.select({
    id: productReviews.id, productId: productReviews.productId, productName: products.name, rating: productReviews.rating, displayName: productReviews.displayName,
    body: productReviews.body, status: productReviews.status, verifiedPurchase: productReviews.verifiedPurchase, createdAt: productReviews.createdAt,
    moderatedAt: productReviews.moderatedAt, moderationNote: productReviews.moderationNote, orderNumber: orders.orderNumber,
  }).from(productReviews).innerJoin(products, eq(products.id, productReviews.productId))
    .leftJoin(orderItems, eq(orderItems.id, productReviews.orderItemId)).leftJoin(orders, eq(orders.id, orderItems.orderId))
    .where(where).orderBy(desc(productReviews.createdAt), desc(productReviews.id)).limit(limit + 1);
  const page = rows.slice(0, limit), ids = page.map((r) => r.id);
  const history = ids.length ? await db.select({ entityId: auditLogs.entityId, action: auditLogs.action, actorEmail: auditLogs.actorEmail, payload: auditLogs.payload, createdAt: auditLogs.createdAt })
    .from(auditLogs).where(and(eq(auditLogs.entityType, "product_review"), inArray(auditLogs.entityId, ids))).orderBy(asc(auditLogs.createdAt)) : [];
  return {
    reviews: page.map(({ orderNumber, ...r }) => ({ ...r, orderNumber: includeOrderNumber ? orderNumber : null, history: history.filter((h) => h.entityId === r.id).map((h) => ({ action: h.action, actorEmail: h.actorEmail, payload: h.payload, createdAt: h.createdAt })) })),
    nextCursor: rows.length > limit ? encodeReviewCursor(page[page.length - 1]) : null,
  };
}
