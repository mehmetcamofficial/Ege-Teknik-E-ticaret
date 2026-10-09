import { getCheckoutDb } from "@/db";
import { addresses, customers, inventory, orderItems, orderLegalAcceptances, orders, legalDocuments, products } from "@/db/schema";
import { resolveCheckoutAuthority } from "@/lib/checkout-authority";
import { deliveryTraits, type DeliveryClass } from "@/lib/delivery";
import { loadRequiredCheckoutLegalDocuments } from "@/lib/legal-db";
import { resolveLegalPreviewBinding } from "@/lib/legal-preview-binding";
import { legalPreviewSigningSecret, verifyLegalPreviewToken } from "@/lib/legal-preview-token";
import { MARKETING_CONSENT_DISABLED, marketingConsentRequested, deliverySummaryFromSnapshot, installationPreferenceFor, orderRequestFingerprint, orderRequestSchema, toOrderConfirmation } from "@/lib/order-domain";
import { idempotencyKey } from "@/lib/request-security";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { and, eq, gte, inArray, asc, sql } from "drizzle-orm";

import { loadOrderLegalEvidenceSummary } from "@/lib/legal-evidence-db";
import { LEGAL_EVIDENCE_VERSION } from "@/lib/legal-evidence";

class IdempotentReplay extends Error {}
class CheckoutRefusal extends Error {
  readonly response: Response;
  constructor(response: Response) { super("Checkout refused"); this.response = response; }
}

async function createOrder(request: Request) {
  const db = getCheckoutDb();
  await rateLimit(request,"order-create",8,15*60_000,db);
  const key = idempotencyKey(request); if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = orderRequestSchema.safeParse(await readJson(request)); if (!parsed.success) return Response.json({ error: "Sipariş bilgilerini kontrol edin." }, { status: 400 });
  const requested = new Map(parsed.data.items.map((item) => [item.productId, item.quantity]));
  const fingerprint = orderRequestFingerprint(parsed.data, requested);
  // Same key + same request => the original result; same key + different request => conflict.
  const replay = async (reader: Pick<typeof db, "select"> = db) => {
    const [existing] = await reader.select({
      legalEvidenceVersion: orders.legalEvidenceVersion, orderIssuedAt: orders.orderIssuedAt, id: orders.id, orderNumber: orders.orderNumber, total: orders.total, status: orders.status, requestFingerprint: orders.requestFingerprint, createdAt: orders.createdAt,
      subtotal: orders.subtotal, vatTotal: orders.vatTotal, shippingTotal: orders.shippingTotal, installationTotal: orders.installationTotal,
      customerName: orders.customerName, phone: orders.phone, email: orders.email, city: orders.city, address: orders.address, installationPreference: orders.installationPreference, shippingAddressSnapshot: orders.shippingAddressSnapshot,
    }).from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
    if (!existing) return null;
    if (existing.requestFingerprint !== fingerprint) return Response.json({ error: "Bu istek anahtarı farklı bir sipariş için kullanıldı.", code: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
    // The order this key already created - never re-run against inventory, just retell the same story.
    const items = await reader.select({ productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal }).from(orderItems).where(eq(orderItems.orderId, existing.id)).orderBy(orderItems.createdAt);
    // P3-LEGAL-3B: replay must return the SAME legal evidence summary as the first response, read back
    // from the persisted acceptance rows - never recomputed from what is currently effective.
    const legalAcceptances = await loadOrderLegalEvidenceSummary(existing.id, existing, reader);
    return Response.json({ ok: true, ...toOrderConfirmation({ orderNumber: existing.orderNumber, status: existing.status, createdAt: existing.createdAt, items, subtotal: existing.subtotal, vatTotal: existing.vatTotal, shippingTotal: existing.shippingTotal, installationTotal: existing.installationTotal, total: existing.total, customerName: existing.customerName, phone: existing.phone, email: existing.email, city: existing.city, address: existing.address, installation: existing.installationPreference ?? "none", legalAcceptances, ...deliverySummaryFromSnapshot(existing.shippingAddressSnapshot) }) });
  };
  const replayed = await replay(); if (replayed) return replayed;
  if (marketingConsentRequested(parsed.data.marketing)) return Response.json({ error: MARKETING_CONSENT_DISABLED.error, code: MARKETING_CONSENT_DISABLED.code }, { status: MARKETING_CONSENT_DISABLED.status });
  const secret = legalPreviewSigningSecret();
  const verified = verifyLegalPreviewToken(parsed.data.legalPreviewToken, secret);
  const invalidPreview = () => Response.json({ error: "Yasal metinler güncellendi; lütfen metinleri yeniden inceleyip onaylayın.", code: "LEGAL_PREVIEW_INVALID" }, { status: 409 });
  if (!verified.ok || verified.payload.renderContextVersion !== 2) return (await replay()) ?? invalidPreview();
  const customerId = crypto.randomUUID(), addressId = crypto.randomUUID(), id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      // Serialize identical attempts before taking source/product locks; committed replay needs no live token.
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      if (await replay(tx)) throw new IdempotentReplay();
      // Legal-version writers lock these parent rows (migration 0015); no broad table lock.
      await tx.select({ id: legalDocuments.id }).from(legalDocuments).orderBy(asc(legalDocuments.id)).for("share");
      await tx.select({ id: products.id }).from(products).where(inArray(products.id, [...requested.keys()])).orderBy(asc(products.id)).for("share");
      const acceptedAt = new Date();
      const authority = await resolveCheckoutAuthority({ data: parsed.data }, requested, tx, acceptedAt);
      if (!authority.ok) throw new CheckoutRefusal(Response.json(authority.body, { status: authority.status }));
      const { lines, plan, subtotal, vatTotal, total, shippingTotal, installationTotal } = authority;
      const legalDocumentsResult = await loadRequiredCheckoutLegalDocuments(acceptedAt, tx);
      if (!legalDocumentsResult.ok) throw new CheckoutRefusal(Response.json({ error: "Yasal metinler şu anda yayında değil; sipariş alınamıyor.", code: "LEGAL_DOCUMENTS_UNAVAILABLE" }, { status: 503 }));
      const binding = resolveLegalPreviewBinding({ data: parsed.data, calculation: authority, documents: legalDocumentsResult.required,
        token: parsed.data.legalPreviewToken, secret, billing: `${parsed.data.customerName} / ${parsed.data.city}`, acceptedAt, now: acceptedAt.getTime() });
      if (!binding.ok || binding.evidence.documents.some((doc) => doc.renderContextVersion !== 2)) throw new CheckoutRefusal(invalidPreview());
      const orderNumber = binding.orderNumber;
      await tx.insert(customers).values({ id: customerId, firstName: authority.customer.firstName, lastName: authority.customer.lastName, phone: parsed.data.phone, email: parsed.data.email });
      await tx.insert(addresses).values({ id: addressId, customerId, recipientName: parsed.data.customerName, phone: parsed.data.phone, city: plan.province, district: plan.district, line1: parsed.data.address });
      const snapshot = { recipientName: parsed.data.customerName, phone: parsed.data.phone, city: plan.province, district: plan.district, line1: parsed.data.address, delivery: { method: plan.method, region: plan.region, shippingFee: shippingTotal, installationIncluded: plan.installationIncluded } };
      const claimed = await tx.insert(orders).values({ id, orderNumber, orderIssuedAt: binding.evidence.orderIssuedAt, legalEvidenceVersion: LEGAL_EVIDENCE_VERSION, customerId, idempotencyKey: key, requestFingerprint: fingerprint, installationPreference: installationPreferenceFor(plan.installationIncluded), notes: parsed.data.note, customerName: parsed.data.customerName, phone: parsed.data.phone, email: parsed.data.email, city: plan.province, address: parsed.data.address, shippingAddressSnapshot: snapshot, billingAddressSnapshot: snapshot, subtotal, vatTotal, shippingTotal, installationTotal, total, createdAt: acceptedAt }).onConflictDoNothing({ target: orders.idempotencyKey }).returning({ id: orders.id });
      // The unique idempotency key is claimed before inventory is touched, so a concurrent duplicate never reserves stock.
      if (!claimed.length) throw new IdempotentReplay();

      // Inventory invariant (lib/inventory.ts): on_hand is the sellable stock, so the guard is on_hand >= qty; `reserved` is bookkeeping only and is NOT subtracted again.
      for (const line of [...lines].sort((a, b) => a.product.id.localeCompare(b.product.id))) { const changed = await tx.update(inventory).set({ onHand: sql`${inventory.onHand} - ${line.quantity}`, reserved: sql`${inventory.reserved} + ${line.quantity}`, version: sql`${inventory.version} + 1`, updatedAt: new Date() }).where(and(eq(inventory.productId, line.product.id), gte(inventory.onHand, line.quantity))).returning({ id: inventory.id }); if (!changed.length) throw new Error(`OUT_OF_STOCK:${line.product.name}`); }
      await tx.insert(orderItems).values(lines.map(({ product, quantity, lineTotal, vatAmount }) => ({ id: crypto.randomUUID(), orderId: id, productId: product.id, productName: product.name, productSku: product.sku, productSlug: product.slug, unitPrice: product.price, vatRateBps: product.vatRateBps, vatAmount, quantity, lineTotal, productSnapshot: { name: product.name, sku: product.sku, slug: product.slug, category: product.category, capacity: product.capacity, unitPrice: product.price, vatRateBps: product.vatRateBps, deliveryClass: product.deliveryClass, installationIncluded: deliveryTraits(product.deliveryClass as DeliveryClass).installationIncluded, shippingEligible: deliveryTraits(product.deliveryClass as DeliveryClass).shippingEligible } })));
      await tx.insert(orderLegalAcceptances).values(binding.evidence.documents.map((doc) => ({ id: crypto.randomUUID(), orderId: id, documentVersionId: doc.documentVersionId, slug: doc.slug, title: doc.title, version: doc.version, templateContentHash: doc.templateContentHash, renderedBody: doc.renderedBody, renderedSha256: doc.renderedSha256, renderContextVersion: doc.renderContextVersion, acceptedAt: doc.acceptedAt, acceptanceType: "checkout_required" })));
    }, { isolationLevel: "read committed" });
  } catch (error) {
    const committed = await replay();
    if (committed) return committed;
    if (error instanceof IdempotentReplay) return Response.json({ error: "İstek işlenemedi." }, { status: 409 });
    if (error instanceof CheckoutRefusal) return error.response;
    if (error instanceof Error && error.message.startsWith("OUT_OF_STOCK:")) return Response.json({ error: `${error.message.slice(13)} için yeterli stok yok.` }, { status: 409 });
    throw error;
  }
  const result = await replay();
  if (!result) throw new Error("Committed order not found");
  return new Response(result.body, { status: 201, headers: result.headers });
}
export const POST=publicRoute(createOrder);
