"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { updateProfile } from "@/lib/account-resources";
import { profileStore } from "@/lib/account-resources-db";
import { rateLimitAccountAction } from "@/lib/account-action-guard";

export type ProfileActionState = { ok: boolean; error?: string };

/**
 * Identity always comes from the verified Clerk session, resolved fresh
 * server-side - the form never sends and this action never reads a
 * customerId, so a tampered field cannot redirect the update to a different
 * customer. Rate limiting is an anti-abuse throttle on top of that, not a
 * substitute for it.
 */
export async function updateProfileAction(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const limited = await rateLimitAccountAction("account-profile-update", 20, 15 * 60_000);
  if (limited) return { ok: false, error: limited };

  const customer = await getAuthenticatedCustomer();
  if (!customer) return { ok: false, error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." };

  const result = await updateProfile(customer, { firstName: formData.get("firstName"), lastName: formData.get("lastName"), phone: formData.get("phone") }, profileStore);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/account");
  revalidatePath("/account/profile");
  return { ok: true };
}
