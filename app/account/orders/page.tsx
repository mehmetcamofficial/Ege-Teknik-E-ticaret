import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { listOrders } from "@/lib/account-resources";
import { orderStore } from "@/lib/account-resources-db";
import { orderStatusLabel } from "@/lib/order-domain";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

const currency = (amount: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount);
const date = (value: Date) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(value);

export default async function OrdersPage() {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();

  // Authorization is orders.customer_id = this exact resolved customer - never email, phone or order number.
  const orders = await listOrders(customer, orderStore);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Siparişlerim</h2>
        <p className="text-sm text-muted-foreground">Geçmiş siparişlerinizi buradan görüntüleyebilirsiniz.</p>
      </div>

      {orders.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375C2.754 3.75 2.25 4.254 2.25 4.875v1.5c0 .621.504 1.125 1.125 1.125Z" />
              </svg>
            </EmptyMedia>
            <EmptyTitle>Henüz siparişiniz yok</EmptyTitle>
            <EmptyDescription>Ürünlerimizi inceleyip ilk siparişinizi verebilirsiniz.</EmptyDescription>
          </EmptyHeader>
          <Button asChild size="sm">
            <Link href="/catalog.html">Ürünleri İncele</Link>
          </Button>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sipariş No</TableHead>
                <TableHead>Tarih</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
                <TableHead className="sr-only">Detay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.orderNumber}</TableCell>
                  <TableCell>{date(order.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{orderStatusLabel(order.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{currency(order.total)}</TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/account/orders/${order.id}`}>Detay</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
