"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { runAccountMutation, updateProfile, type MutationResult } from "@/lib/account-resources";
import { profileStore } from "@/lib/account-resources-db";
import { ACCOUNT_MUTATION_LIMIT, ACCOUNT_MUTATION_WINDOW_MS, rateLimitAccountAction } from "@/lib/account-action-guard";

export type ProfileActionState = MutationResult;

/**
 * Identity always comes from the verified Clerk session, resolved fresh
 * server-side - the form never sends and this action never reads a
 * customerId, so a tampered field cannot redirect the update to a different
 * customer. Rate limiting (run first, see runAccountMutation) is an
 * anti-abuse throttle on top of that, not a substitute for it.
 */
export async function updateProfileAction(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const result = await runAccountMutation({
    rateLimit: () => rateLimitAccountAction("account-profile-update", ACCOUNT_MUTATION_LIMIT, ACCOUNT_MUTATION_WINDOW_MS),
    resolveCustomer: getAuthenticatedCustomer,
    mutate: (customer) => updateProfile(customer, { firstName: formData.get("firstName"), lastName: formData.get("lastName"), phone: formData.get("phone") }, profileStore),
  });
  if (result.ok) {
    revalidatePath("/account");
    revalidatePath("/account/profile");
  }
  return result;
}
