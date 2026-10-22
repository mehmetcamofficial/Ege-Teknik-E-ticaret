"use client";

import { useState, useTransition } from "react";
import type { CustomerAddress } from "@/lib/account-resources";
import { createAddressAction, deleteAddressAction, updateAddressAction } from "./actions";
import { AddressForm } from "./address-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

function AddressCard({ address }: { address: CustomerAddress }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (editing) {
    return (
      <Card>
        <CardContent className="pt-6">
          <AddressForm action={updateAddressAction} address={address} submitLabel="Güncelle" onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {address.title || "Adres"}
          {address.billing ? <Badge variant="secondary">Fatura Adresi</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <address className="not-italic text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{address.recipientName}</p>
          <p>{address.phone}</p>
          <p>
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ""}
          </p>
          <p>
            {[address.district, address.city, address.postalCode].filter(Boolean).join(", ")}
          </p>
        </address>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!confirm("Bu adresi silmek istediğinize emin misiniz?")) return;
              setDeleteError(null);
              startTransition(async () => {
                const result = await deleteAddressAction(address.id);
                if (!result.ok) setDeleteError(result.error ?? "Adres silinemedi.");
              });
            }}
          >
            {pending ? "Siliniyor..." : "Sil"}
          </Button>
        </div>
        {deleteError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {deleteError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AddressesManager({ addresses }: { addresses: CustomerAddress[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {addresses.length === 0 && !adding ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
            </EmptyMedia>
            <EmptyTitle>Henüz kayıtlı adresiniz yok</EmptyTitle>
            <EmptyDescription>Siparişlerinizde kullanmak için bir teslimat veya fatura adresi ekleyin.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <AddressCard key={address.id} address={address} />
          ))}
        </div>
      )}

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yeni Adres</CardTitle>
          </CardHeader>
          <CardContent>
            <AddressForm action={createAddressAction} submitLabel="Adresi Kaydet" onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
          </CardContent>
        </Card>
      ) : (
        <Button type="button" onClick={() => setAdding(true)}>
          Yeni Adres Ekle
        </Button>
      )}
    </div>
  );
}
