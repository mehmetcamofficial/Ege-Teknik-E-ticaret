import Link from "next/link";
import { currentUser, auth } from "@clerk/nextjs/server";
import { getOrCreateAuthenticatedCustomer } from "@/lib/customer-auth";
import { listAddresses, listOrders } from "@/lib/account-resources";
import { addressStore, orderStore } from "@/lib/account-resources-db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AccountOverviewPage() {
  // Links the verified Clerk session to its internal customer (created on first login).
  // The layout's auth.protect() + resolution already ran; null here means no usable session.
  const customer = await getOrCreateAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();

  const [user, addresses, orders] = await Promise.all([currentUser(), listAddresses(customer, addressStore), listOrders(customer, orderStore)]);
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Değerli Müşterimiz";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Hoş geldiniz, {displayName}</CardTitle>
          {email ? <CardDescription>{email}</CardDescription> : null}
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Kayıtlı Adres</CardDescription>
            <CardTitle className="text-3xl">{addresses.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/account/addresses">Adresleri Yönet</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Toplam Sipariş</CardDescription>
            <CardTitle className="text-3xl">{orders.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/account/orders">Siparişleri Görüntüle</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil Bilgileri</CardTitle>
          <CardDescription>Ad, soyad ve telefon bilgilerinizi güncelleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm">
            <Link href="/account/profile">Profili Düzenle</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
