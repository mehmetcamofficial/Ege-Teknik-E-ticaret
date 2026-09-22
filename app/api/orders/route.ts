import { getDb } from "@/db";
import { addresses, customers, inventory, orderItems, orders, products } from "@/db/schema";
import { computeOrderTotals, orderRequestSchema, priceOrderLines } from "@/lib/order-domain";
import { idempotencyKey } from "@/lib/request-security";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

async function createOrder(request: Request) {
  await rateLimit(request,"order-create",8,15*60_000);
  const key = idempotencyKey(request); if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = orderRequestSchema.safeParse(await readJson(request)); if (!parsed.success) return Response.json({ error: "Sipariş bilgilerini kontrol edin." }, { status: 400 });
  const db = getDb(); const [existing] = await db.select({ orderNumber: orders.orderNumber, total: orders.total, status: orders.status }).from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
  if (existing) return Response.json({ ok: true, ...existing });
  const requested = new Map(parsed.data.items.map((item) => [item.productId, item.quantity]));
  const rows = await db.select({ product: products }).from(products).innerJoin(inventory, eq(inventory.productId, products.id)).where(and(inArray(products.id, [...requested.keys()]), eq(products.status, "published"), eq(products.saleMode, "online")));
  if (rows.length !== requested.size) return Response.json({ error: "Sepette satışa açık olmayan bir ürün var." }, { status: 409 });
  const nameParts = parsed.data.customerName.split(/\s+/), lastName = nameParts.length > 1 ? nameParts.pop()! : "-", firstName = nameParts.join(" ");
  const id = crypto.randomUUID(), customerId = crypto.randomUUID(), addressId = crypto.randomUUID(), orderNumber = `ETS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
  const lines = priceOrderLines(rows.map(({ product }) => product), requested);
  const { subtotal, vatTotal, total } = computeOrderTotals(lines);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(customers).values({ id: customerId, firstName, lastName, phone: parsed.data.phone, email: parsed.data.email });
      await tx.insert(addresses).values({ id: addressId, customerId, recipientName: parsed.data.customerName, phone: parsed.data.phone, city: parsed.data.city, line1: parsed.data.address });
      for (const line of lines) { const changed = await tx.update(inventory).set({ onHand: sql`${inventory.onHand} - ${line.quantity}`, reserved: sql`${inventory.reserved} + ${line.quantity}`, version: sql`${inventory.version} + 1`, updatedAt: new Date() }).where(and(eq(inventory.productId, line.product.id), gte(sql`${inventory.onHand} - ${inventory.reserved}`, line.quantity))).returning({ id: inventory.id }); if (!changed.length) throw new Error(`OUT_OF_STOCK:${line.product.name}`); }
      const snapshot = { recipientName: parsed.data.customerName, phone: parsed.data.phone, city: parsed.data.city, line1: parsed.data.address };
      await tx.insert(orders).values({ id, orderNumber, customerId, idempotencyKey: key, customerName: parsed.data.customerName, phone: parsed.data.phone, email: parsed.data.email, city: parsed.data.city, address: parsed.data.address, shippingAddressSnapshot: snapshot, billingAddressSnapshot: snapshot, subtotal, vatTotal, total });
      await tx.insert(orderItems).values(lines.map(({ product, quantity, lineTotal, vatAmount }) => ({ id: crypto.randomUUID(), orderId: id, productId: product.id, productName: product.name, productSku: product.sku, productSlug: product.slug, unitPrice: product.price, vatRateBps: product.vatRateBps, vatAmount, quantity, lineTotal, productSnapshot: { name: product.name, sku: product.sku, slug: product.slug, category: product.category, capacity: product.capacity, unitPrice: product.price, vatRateBps: product.vatRateBps } })));
    });
  } catch (error) { if (error instanceof Error && error.message.startsWith("OUT_OF_STOCK:")) return Response.json({ error: `${error.message.slice(13)} için yeterli stok yok.` }, { status: 409 }); throw error; }
  return Response.json({ ok: true, orderNumber, total, status: "pending_payment" }, { status: 201 });
}
export const POST=publicRoute(createOrder);
