"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { createAddress, deleteAddress, runAccountMutation, updateAddress, type MutationResult } from "@/lib/account-resources";
import { addressStore } from "@/lib/account-resources-db";
import { ACCOUNT_MUTATION_LIMIT, ACCOUNT_MUTATION_WINDOW_MS, rateLimitAccountAction } from "@/lib/account-action-guard";

export type AddressActionState = MutationResult;

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

const limit = (scope: string) => () => rateLimitAccountAction(scope, ACCOUNT_MUTATION_LIMIT, ACCOUNT_MUTATION_WINDOW_MS);

export async function createAddressAction(_prev: AddressActionState, formData: FormData): Promise<AddressActionState> {
  const result = await runAccountMutation({
    rateLimit: limit("account-address-create"),
    resolveCustomer: getAuthenticatedCustomer,
    mutate: (customer) => createAddress(customer, addressInputFromForm(formData), crypto.randomUUID(), addressStore),
  });
  if (result.ok) {
    revalidatePath("/account/addresses");
    revalidatePath("/account");
  }
  return result;
}

/**
 * addressId comes from a hidden form field, but that is safe: the store's
 * ownership contract filters by id AND the server-resolved customer.id in the
 * same query (see ownedAddressWhere in lib/account-queries.ts), so a tampered
 * id for another customer's address simply matches no row instead of ever
 * being editable.
 */
export async function updateAddressAction(_prev: AddressActionState, formData: FormData): Promise<AddressActionState> {
  const result = await runAccountMutation({
    rateLimit: limit("account-address-update"),
    resolveCustomer: getAuthenticatedCustomer,
    mutate: (customer) => updateAddress(customer, String(formData.get("addressId") ?? ""), addressInputFromForm(formData), addressStore),
  });
  if (result.ok) revalidatePath("/account/addresses");
  return result;
}

export type DeleteAddressResult = MutationResult;

/**
 * The failure message is the same generic string whether the address never
 * existed or simply isn't this customer's (see deleteAddress in
 * lib/account-resources.ts) - so a failed delete never tells the caller
 * which case it was, keeping IDOR attempts non-enumerable.
 */
export async function deleteAddressAction(addressId: string): Promise<DeleteAddressResult> {
  const result = await runAccountMutation({
    rateLimit: limit("account-address-delete"),
    resolveCustomer: getAuthenticatedCustomer,
    mutate: (customer) => deleteAddress(customer, addressId, addressStore),
  });
  if (result.ok) {
    revalidatePath("/account/addresses");
    revalidatePath("/account");
  }
  return result;
}
