"use client";

import { useActionState, useEffect } from "react";
import type { CustomerAddress } from "@/lib/account-resources";
import type { AddressActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AddressActionState = { ok: false };

export function AddressForm({
  action,
  address,
  onSaved,
  onCancel,
  submitLabel,
}: {
  action: (prev: AddressActionState, formData: FormData) => Promise<AddressActionState>;
  address?: CustomerAddress;
  onSaved?: () => void;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {address ? <input type="hidden" name="addressId" value={address.id} /> : null}

      <div className="space-y-2">
        <Label htmlFor={`title-${address?.id ?? "new"}`}>Adres Başlığı</Label>
        <Input id={`title-${address?.id ?? "new"}`} name="title" defaultValue={address?.title} maxLength={100} placeholder="Ev, İş vb." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`recipientName-${address?.id ?? "new"}`}>Alıcı Adı Soyadı</Label>
          <Input id={`recipientName-${address?.id ?? "new"}`} name="recipientName" defaultValue={address?.recipientName} maxLength={150} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`phone-${address?.id ?? "new"}`}>Telefon</Label>
          <Input id={`phone-${address?.id ?? "new"}`} name="phone" type="tel" defaultValue={address?.phone} maxLength={30} required placeholder="05xx xxx xx xx" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`city-${address?.id ?? "new"}`}>Şehir</Label>
          <Input id={`city-${address?.id ?? "new"}`} name="city" defaultValue={address?.city} maxLength={100} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`district-${address?.id ?? "new"}`}>İlçe</Label>
          <Input id={`district-${address?.id ?? "new"}`} name="district" defaultValue={address?.district} maxLength={100} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`postalCode-${address?.id ?? "new"}`}>Posta Kodu</Label>
          <Input id={`postalCode-${address?.id ?? "new"}`} name="postalCode" defaultValue={address?.postalCode} maxLength={20} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`line1-${address?.id ?? "new"}`}>Adres Satırı</Label>
        <Input id={`line1-${address?.id ?? "new"}`} name="line1" defaultValue={address?.line1} maxLength={300} required placeholder="Mahalle, sokak, no" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`line2-${address?.id ?? "new"}`}>Adres Satırı 2 (opsiyonel)</Label>
        <Input id={`line2-${address?.id ?? "new"}`} name="line2" defaultValue={address?.line2} maxLength={300} />
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" name="billing" defaultChecked={address?.billing} className="size-4 rounded border-input" />
        Fatura adresi olarak kullan
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Kaydediliyor..." : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Vazgeç
          </Button>
        ) : null}
      </div>
    </form>
  );
}
