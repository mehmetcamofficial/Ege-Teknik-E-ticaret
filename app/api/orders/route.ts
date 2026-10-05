import { getDb } from "@/db";
import { addresses, customers, inventory, orderItems, orderLegalAcceptances, orders } from "@/db/schema";
import { resolveCheckoutAuthority } from "@/lib/checkout-authority";
import { deliveryTraits, type DeliveryClass } from "@/lib/delivery";
import { loadOrderAcceptedLegalDocuments, loadRequiredCheckoutLegalDocuments } from "@/lib/legal-db";
import { resolveLegalPreviewBinding } from "@/lib/legal-preview-binding";
import { legalPreviewSigningSecret } from "@/lib/legal-preview-token";
import { deliverySummaryFromSnapshot, installationPreferenceFor, orderRequestFingerprint, orderRequestSchema, toOrderConfirmation, toPublicOrderItem } from "@/lib/order-domain";
import { idempotencyKey } from "@/lib/request-security";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { and, eq, gte, sql } from "drizzle-orm";

class IdempotentReplay extends Error {}

async function createOrder(request: Request) {
  await rateLimit(request,"order-create",8,15*60_000);
  const key = idempotencyKey(request); if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = orderRequestSchema.safeParse(await readJson(request)); if (!parsed.success) return Response.json({ error: "Sipariş bilgilerini kontrol edin." }, { status: 400 });
  const db = getDb();
  const requested = new Map(parsed.data.items.map((item) => [item.productId, item.quantity]));
  const fingerprint = orderRequestFingerprint(parsed.data, requested);
  // Same key + same request => the original result; same key + different request => conflict.
  const replay = async () => {
    const [existing] = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, total: orders.total, status: orders.status, requestFingerprint: orders.requestFingerprint, createdAt: orders.createdAt,
      subtotal: orders.subtotal, vatTotal: orders.vatTotal, shippingTotal: orders.shippingTotal, installationTotal: orders.installationTotal,
      customerName: orders.customerName, phone: orders.phone, email: orders.email, city: orders.city, address: orders.address, installationPreference: orders.installationPreference, shippingAddressSnapshot: orders.shippingAddressSnapshot,
    }).from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
    if (!existing) return null;
    if (existing.requestFingerprint !== fingerprint) return Response.json({ error: "Bu istek anahtarı farklı bir sipariş için kullanıldı.", code: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
    // The order this key already created - never re-run against inventory, just retell the same story.
    const items = await db.select({ productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal }).from(orderItems).where(eq(orderItems.orderId, existing.id)).orderBy(orderItems.createdAt);
    // P3-LEGAL-3B: replay must return the SAME legal evidence summary as the first response, read back
    // from the persisted acceptance rows - never recomputed from what is currently effective.
    const legalAcceptances = await loadOrderAcceptedLegalDocuments(existing.id);
    return Response.json({ ok: true, ...toOrderConfirmation({ orderNumber: existing.orderNumber, status: existing.status, createdAt: existing.createdAt, items, subtotal: existing.subtotal, vatTotal: existing.vatTotal, shippingTotal: existing.shippingTotal, installationTotal: existing.installationTotal, total: existing.total, customerName: existing.customerName, phone: existing.phone, email: existing.email, city: existing.city, address: existing.address, installation: existing.installationPreference ?? "none", legalAcceptances, ...deliverySummaryFromSnapshot(existing.shippingAddressSnapshot) }) });
  };
  const replayed = await replay(); if (replayed) return replayed;
  // P3-LEGAL-3C.3 / P1: every server-authoritative fact about this checkout - required legal versions, database
  // prices, the delivery plan and all totals - is resolved by the shared read-and-calculate module, so a future
  // pre-acceptance legal preview and this order cannot disagree. It opens no transaction and writes nothing.
  const authority = await resolveCheckoutAuthority({ data: parsed.data }, requested);
  if (!authority.ok) return Response.json(authority.body, { status: authority.status });
  const { lines, plan, subtotal, vatTotal, total, shippingTotal, installationTotal } = authority;
  const customerId = crypto.randomUUID(), addressId = crypto.randomUUID();
  const acceptedAt = new Date();
  // P3-LEGAL-3C.4 / P2: the order may only exist if it is the SAME order context whose legal text the customer
  // already read and accepted. The signed preview token is verified cryptographically AND re-checked against
  // current server state: the context is rebuilt from live prices/tariffs/versions, the required legal documents
  // are re-rendered, and every digest must match. Anything else fails closed and asks for a fresh preview.
  // Idempotent replay returned above, so a retry never needs a live token to read back a committed order.
  const legalDocuments = await loadRequiredCheckoutLegalDocuments();
  if (!legalDocuments.ok) return Response.json({ error: "Yasal metinler şu anda yayında değil; sipariş alınamıyor.", code: "LEGAL_DOCUMENTS_UNAVAILABLE" }, { status: 503 });
  const binding = resolveLegalPreviewBinding({
    data: parsed.data,
    calculation: authority,
    documents: legalDocuments.required,
    token: parsed.data.legalPreviewToken,
    secret: legalPreviewSigningSecret(),
    billing: `${parsed.data.customerName} / ${parsed.data.city}`,
    acceptedAt,
  });
  if (!binding.ok) return Response.json({ error: "Yasal metinler güncellendi; lütfen metinleri yeniden inceleyip onaylayın.", code: "LEGAL_PREVIEW_INVALID" }, { status: 409 });
  // Reuse the identity minted at preview time. NEVER regenerate it here: the contract the customer accepted names it.
  const id = crypto.randomUUID();
  const orderNumber = binding.orderNumber;
  // The legally displayed order timestamp is frozen at preview; acceptance time is server-generated above.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(customers).values({ id: customerId, firstName: authority.customer.firstName, lastName: authority.customer.lastName, phone: parsed.data.phone, email: parsed.data.email });
      await tx.insert(addresses).values({ id: addressId, customerId, recipientName: parsed.data.customerName, phone: parsed.data.phone, city: plan.province, district: plan.district, line1: parsed.data.address });
      const snapshot = { recipientName: parsed.data.customerName, phone: parsed.data.phone, city: plan.province, district: plan.district, line1: parsed.data.address, delivery: { method: plan.method, region: plan.region, shippingFee: shippingTotal, installationIncluded: plan.installationIncluded } };
      const claimed = await tx.insert(orders).values({ id, orderNumber, customerId, idempotencyKey: key, requestFingerprint: fingerprint, installationPreference: installationPreferenceFor(plan.installationIncluded), notes: parsed.data.note, customerName: parsed.data.customerName, phone: parsed.data.phone, email: parsed.data.email, city: plan.province, address: parsed.data.address, shippingAddressSnapshot: snapshot, billingAddressSnapshot: snapshot, subtotal, vatTotal, shippingTotal, installationTotal, total, createdAt: acceptedAt }).onConflictDoNothing({ target: orders.idempotencyKey }).returning({ id: orders.id });
      // The unique idempotency key is claimed before inventory is touched, so a concurrent duplicate never reserves stock.
      if (!claimed.length) throw new IdempotentReplay();

      // Inventory invariant (lib/inventory.ts): on_hand is the sellable stock, so the guard is on_hand >= qty; `reserved` is bookkeeping only and is NOT subtracted again.
      for (const line of lines) { const changed = await tx.update(inventory).set({ onHand: sql`${inventory.onHand} - ${line.quantity}`, reserved: sql`${inventory.reserved} + ${line.quantity}`, version: sql`${inventory.version} + 1`, updatedAt: new Date() }).where(and(eq(inventory.productId, line.product.id), gte(inventory.onHand, line.quantity))).returning({ id: inventory.id }); if (!changed.length) throw new Error(`OUT_OF_STOCK:${line.product.name}`); }
      await tx.insert(orderItems).values(lines.map(({ product, quantity, lineTotal, vatAmount }) => ({ id: crypto.randomUUID(), orderId: id, productId: product.id, productName: product.name, productSku: product.sku, productSlug: product.slug, unitPrice: product.price, vatRateBps: product.vatRateBps, vatAmount, quantity, lineTotal, productSnapshot: { name: product.name, sku: product.sku, slug: product.slug, category: product.category, capacity: product.capacity, unitPrice: product.price, vatRateBps: product.vatRateBps, deliveryClass: product.deliveryClass, installationIncluded: deliveryTraits(product.deliveryClass as DeliveryClass).installationIncluded, shippingEligible: deliveryTraits(product.deliveryClass as DeliveryClass).shippingEligible } })));
      await tx.insert(orderLegalAcceptances).values(authority.requiredLegal.map((version) => ({ id: crypto.randomUUID(), orderId: id, documentVersionId: version.versionId, acceptedAt })));
    });
  } catch (error) { if (error instanceof IdempotentReplay) return (await replay()) ?? Response.json({ error: "İstek işlenemedi." }, { status: 409 }); if (error instanceof Error && error.message.startsWith("OUT_OF_STOCK:")) return Response.json({ error: `${error.message.slice(13)} için yeterli stok yok.` }, { status: 409 }); throw error; }
  const items = lines.map((line) => toPublicOrderItem(line, line.product.price));
  // P3-LEGAL-3B: the response carries the very versions this transaction just persisted (legal.required),
  // so the customer links to the same text the acceptance rows point at. Read back after commit.
  const legalAcceptances = await loadOrderAcceptedLegalDocuments(id);
  return Response.json({ ok: true, ...toOrderConfirmation({ orderNumber, status: "pending_payment", createdAt: acceptedAt, items, subtotal, vatTotal, shippingTotal, installationTotal, total, customerName: parsed.data.customerName, phone: parsed.data.phone, email: parsed.data.email, city: plan.province, district: plan.district, address: parsed.data.address, installation: installationPreferenceFor(plan.installationIncluded), deliveryMethod: plan.method, legalAcceptances }) }, { status: 201 });
}
export const POST=publicRoute(createOrder);
