"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { updateProfile } from "@/lib/account-resources";
import { profileStore } from "@/lib/account-resources-db";

export type ProfileActionState = { ok: boolean; error?: string };

/**
 * Identity always comes from the verified Clerk session, resolved fresh
 * server-side - the form never sends and this action never reads a
 * customerId, so a tampered field cannot redirect the update to a different
 * customer.
 */
export async function updateProfileAction(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return { ok: false, error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." };

  const result = await updateProfile(customer, { firstName: formData.get("firstName"), lastName: formData.get("lastName"), phone: formData.get("phone") }, profileStore);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/account");
  revalidatePath("/account/profile");
  return { ok: true };
}
