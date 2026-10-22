import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { getOrder } from "@/lib/account-resources";
import { orderStore } from "@/lib/account-resources-db";
import { orderStatusLabel } from "@/lib/order-domain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const currency = (amount: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount);
const date = (value: Date) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" }).format(value);

function snapshotLine(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  const parts = [s.recipientName, s.line1, s.city].filter((v): v is string => typeof v === "string" && v.length > 0);
  return parts.length ? parts.join(", ") : null;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();

  // Ownership is enforced atomically (orders.id = id AND orders.customer_id = customer.id) - a
  // mismatched or malformed id, or an order belonging to another customer, never leaks its existence.
  const order = await getOrder(customer, id, orderStore);
  if (!order) notFound();

  const shipping = snapshotLine(order.shippingAddressSnapshot);
  const billing = snapshotLine(order.billingAddressSnapshot);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{order.orderNumber}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{date(order.createdAt)}</p>
          </div>
          <Badge variant="secondary">{orderStatusLabel(order.status)}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {shipping ? (
              <div>
                <p className="text-sm font-medium text-foreground">Teslimat Adresi</p>
                <p className="text-sm text-muted-foreground">{shipping}</p>
              </div>
            ) : null}
            {billing ? (
              <div>
                <p className="text-sm font-medium text-foreground">Fatura Adresi</p>
                <p className="text-sm text-muted-foreground">{billing}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ürünler</CardTitle>
        </CardHeader>
        <CardContent>
          {order.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu siparişe ait ürün kaydı bulunamadı.</p>
          ) : (
            <ul className="divide-y divide-border">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} adet × {currency(item.unitPrice)}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-foreground">{currency(item.lineTotal)}</p>
                </li>
              ))}
            </ul>
          )}

          <Separator className="my-4" />

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Ara Toplam</span>
              <span>{currency(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>KDV</span>
              <span>{currency(order.vatTotal)}</span>
            </div>
            {order.shippingTotal > 0 ? (
              <div className="flex justify-between text-muted-foreground">
                <span>Kargo</span>
                <span>{currency(order.shippingTotal)}</span>
              </div>
            ) : null}
            <div className="flex justify-between pt-1.5 text-base font-semibold text-foreground">
              <span>Toplam</span>
              <span>{currency(order.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
