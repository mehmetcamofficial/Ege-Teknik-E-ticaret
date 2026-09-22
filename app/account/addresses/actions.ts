"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { createAddress, deleteAddress, updateAddress } from "@/lib/account-resources";
import { addressStore } from "@/lib/account-resources-db";

export type AddressActionState = { ok: boolean; error?: string };

function addressInputFromForm(formData: FormData) {
  return {
    title: formData.get("title"),
    recipientName: formData.get("recipientName"),
    phone: formData.get("phone"),
    city: formData.get("city"),
    district: formData.get("district"),
    postalCode: formData.get("postalCode"),
    line1: formData.get("line1"),
    line2: formData.get("line2"),
    billing: formData.get("billing") === "on",
  };
}

export async function createAddressAction(_prev: AddressActionState, formData: FormData): Promise<AddressActionState> {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return { ok: false, error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." };

  const result = await createAddress(customer, addressInputFromForm(formData), crypto.randomUUID(), addressStore);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/account/addresses");
  revalidatePath("/account");
  return { ok: true };
}

/**
 * addressId comes from a hidden form field, but that is safe: the store's
 * ownership contract filters by id AND the server-resolved customer.id in the
 * same query (see lib/account-resources-db.ts's ownedAddressWhere), so a
 * tampered id for another customer's address simply matches no row instead
 * of ever being editable.
 */
export async function updateAddressAction(_prev: AddressActionState, formData: FormData): Promise<AddressActionState> {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return { ok: false, error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." };

  const addressId = String(formData.get("addressId") ?? "");
  const result = await updateAddress(customer, addressId, addressInputFromForm(formData), addressStore);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/account/addresses");
  return { ok: true };
}

export async function deleteAddressAction(addressId: string) {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return;
  await deleteAddress(customer, addressId, addressStore);
  revalidatePath("/account/addresses");
  revalidatePath("/account");
}
