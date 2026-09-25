import { getDb } from "@/db";
import { addresses, customers, inventory, marketingConsents, orderItems, orderLegalAcceptances, orders, products } from "@/db/schema";
import { finalizeOrderTotals, priceCharges, totalMatchesDisplayed } from "@/lib/checkout-charges";
import { checkLegalAcceptance, missingNoticeSlugs } from "@/lib/legal";
import { loadCurrentLegalIndex, loadRequiredCheckoutLegalVersions } from "@/lib/legal-db";
import { computeOrderTotals, marketingChannels, orderRequestFingerprint, orderRequestSchema, priceOrderLines, toOrderConfirmation, toPublicOrderItem } from "@/lib/order-domain";
import { idempotencyKey } from "@/lib/request-security";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

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
      id: orders.id, orderNumber: orders.orderNumber, total: orders.total, status: orders.status, requestFingerprint: orders.requestFingerprint,
      subtotal: orders.subtotal, vatTotal: orders.vatTotal, shippingTotal: orders.shippingTotal, installationTotal: orders.installationTotal,
      customerName: orders.customerName, phone: orders.phone, email: orders.email, city: orders.city, address: orders.address, installationPreference: orders.installationPreference,
    }).from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
    if (!existing) return null;
    if (existing.requestFingerprint !== fingerprint) return Response.json({ error: "Bu istek anahtarı farklı bir sipariş için kullanıldı.", code: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
    // The order this key already created - never re-run against inventory, just retell the same story.
    const items = await db.select({ productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal }).from(orderItems).where(eq(orderItems.orderId, existing.id)).orderBy(orderItems.createdAt);
    return Response.json({ ok: true, ...toOrderConfirmation({ orderNumber: existing.orderNumber, status: existing.status, items, subtotal: existing.subtotal, vatTotal: existing.vatTotal, shippingTotal: existing.shippingTotal, installationTotal: existing.installationTotal, total: existing.total, customerName: existing.customerName, phone: existing.phone, email: existing.email, city: existing.city, address: existing.address, installation: existing.installationPreference ?? "delivery_only" }) });
  };
  const replayed = await replay(); if (replayed) return replayed;
  const legal = await loadRequiredCheckoutLegalVersions();
  if (!legal.ok) return Response.json({ error: "Yasal metinler şu anda yayında değil; sipariş alınamıyor.", code: "LEGAL_DOCUMENTS_UNAVAILABLE" }, { status: 503 });
  const acceptance = checkLegalAcceptance(legal.required, parsed.data.legalAcceptances);
  if (!acceptance.ok) return Response.json(acceptance.code === "LEGAL_ACCEPTANCE_REQUIRED" ? { error: "Devam etmek için tüm yasal metinleri kabul etmelisiniz.", code: acceptance.code } : { error: "Yasal metinler güncellendi; lütfen sayfayı yenileyip tekrar onaylayın.", code: acceptance.code }, { status: acceptance.code === "LEGAL_ACCEPTANCE_REQUIRED" ? 422 : 409 });
  // The KVKK disclosure is informational (never a checkbox) but must be published before personal data is collected.
  if (missingNoticeSlugs((await loadCurrentLegalIndex()).map((doc) => doc.slug)).length) return Response.json({ error: "Aydınlatma metni şu anda yayında değil; sipariş alınamıyor.", code: "LEGAL_NOTICE_UNAVAILABLE" }, { status: 503 });
  const rows = await db.select({ product: products }).from(products).innerJoin(inventory, eq(inventory.productId, products.id)).where(and(inArray(products.id, [...requested.keys()]), eq(products.status, "published"), eq(products.saleMode, "online")));
  if (rows.length !== requested.size) return Response.json({ error: "Sepette satışa açık olmayan bir ürün var." }, { status: 409 });
  const nameParts = parsed.data.customerName.split(/\s+/), lastName = nameParts.length > 1 ? nameParts.pop()! : "-", firstName = nameParts.join(" ");
  const id = crypto.randomUUID(), customerId = crypto.randomUUID(), addressId = crypto.randomUUID(), orderNumber = `ETS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
  const lines = priceOrderLines(rows.map(({ product }) => product), requested);
  // Fail-closed charge model: every amount that forms the total is computed here. An undetermined mandatory
  // delivery/installation charge refuses the order BEFORE anything is written (no order, no stock, no acceptance).
  const charges = priceCharges(parsed.data.installation);
  if (!charges.ok) return Response.json({ error: "Teslimat veya kurulum bedeli henüz belirlenmediği için sipariş oluşturulamıyor; kesin fiyat teklifi için bizimle iletişime geçin.", code: "CHARGES_UNDETERMINED", undetermined: charges.undetermined }, { status: 409 });
  const { subtotal, vatTotal, total, shippingTotal, installationTotal } = finalizeOrderTotals(computeOrderTotals(lines), charges);
  if (!totalMatchesDisplayed(total, parsed.data.expectedTotal)) return Response.json({ error: "Sipariş tutarı güncellendi; lütfen yeni tutarı kontrol edip tekrar onaylayın.", code: "PRICE_CHANGED", total }, { status: 409 });
  const acceptedAt = new Date(); // server-generated; the client never supplies it
  try {
    await db.transaction(async (tx) => {
      await tx.insert(customers).values({ id: customerId, firstName, lastName, phone: parsed.data.phone, email: parsed.data.email });
      await tx.insert(addresses).values({ id: addressId, customerId, recipientName: parsed.data.customerName, phone: parsed.data.phone, city: parsed.data.city, line1: parsed.data.address });
      const snapshot = { recipientName: parsed.data.customerName, phone: parsed.data.phone, city: parsed.data.city, line1: parsed.data.address };
      const claimed = await tx.insert(orders).values({ id, orderNumber, customerId, idempotencyKey: key, requestFingerprint: fingerprint, installationPreference: parsed.data.installation, notes: parsed.data.note, customerName: parsed.data.customerName, phone: parsed.data.phone, email: parsed.data.email, city: parsed.data.city, address: parsed.data.address, shippingAddressSnapshot: snapshot, billingAddressSnapshot: snapshot, subtotal, vatTotal, shippingTotal, installationTotal, total }).onConflictDoNothing({ target: orders.idempotencyKey }).returning({ id: orders.id });
      // The unique idempotency key is claimed before inventory is touched, so a concurrent duplicate never reserves stock.
      if (!claimed.length) throw new IdempotentReplay();

      // Inventory invariant (lib/inventory.ts): on_hand is the sellable stock, so the guard is on_hand >= qty; `reserved` is bookkeeping only and is NOT subtracted again.
      for (const line of lines) { const changed = await tx.update(inventory).set({ onHand: sql`${inventory.onHand} - ${line.quantity}`, reserved: sql`${inventory.reserved} + ${line.quantity}`, version: sql`${inventory.version} + 1`, updatedAt: new Date() }).where(and(eq(inventory.productId, line.product.id), gte(inventory.onHand, line.quantity))).returning({ id: inventory.id }); if (!changed.length) throw new Error(`OUT_OF_STOCK:${line.product.name}`); }
      await tx.insert(orderItems).values(lines.map(({ product, quantity, lineTotal, vatAmount }) => ({ id: crypto.randomUUID(), orderId: id, productId: product.id, productName: product.name, productSku: product.sku, productSlug: product.slug, unitPrice: product.price, vatRateBps: product.vatRateBps, vatAmount, quantity, lineTotal, productSnapshot: { name: product.name, sku: product.sku, slug: product.slug, category: product.category, capacity: product.capacity, unitPrice: product.price, vatRateBps: product.vatRateBps } })));
      // Optional marketing permission: one event row per channel the customer explicitly ticked; none when all are unticked.
      const channels = marketingChannels(parsed.data.marketing);
      if (channels.length) await tx.insert(marketingConsents).values(channels.map((channel) => ({ id: crypto.randomUUID(), customerId, channel, granted: true, orderId: id, source: "checkout", recordedAt: acceptedAt })));
      await tx.insert(orderLegalAcceptances).values(legal.required.map((version) => ({ id: crypto.randomUUID(), orderId: id, documentVersionId: version.versionId, acceptedAt })));
    });
  } catch (error) { if (error instanceof IdempotentReplay) return (await replay()) ?? Response.json({ error: "İstek işlenemedi." }, { status: 409 }); if (error instanceof Error && error.message.startsWith("OUT_OF_STOCK:")) return Response.json({ error: `${error.message.slice(13)} için yeterli stok yok.` }, { status: 409 }); throw error; }
  const items = lines.map((line) => toPublicOrderItem(line, line.product.price));
  return Response.json({ ok: true, ...toOrderConfirmation({ orderNumber, status: "pending_payment", items, subtotal, vatTotal, shippingTotal, installationTotal, total, customerName: parsed.data.customerName, phone: parsed.data.phone, email: parsed.data.email, city: parsed.data.city, address: parsed.data.address, installation: parsed.data.installation }) }, { status: 201 });
}
export const POST=publicRoute(createOrder);
