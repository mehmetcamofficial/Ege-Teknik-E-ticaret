import type { ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAuthenticatedCustomer } from "@/lib/customer-auth";
import { AccountNav } from "./_components/account-nav";

/**
 * Scoped narrowly to /account: only this layout (not the root layout) wraps
 * children in ClerkProvider, so /admin and the static storefront never pick
 * up Clerk context. auth.protect() is the resource-based check Clerk's own
 * types recommend over middleware route matching (see proxy.ts) — it
 * redirects signed-out visitors to sign-in before anything under /account
 * renders.
 *
 * The customer is resolved (and created on first login) once here, so every
 * page under /account - not just the overview - has a linked customer before
 * it renders, and a malformed/rejected Clerk session redirects to sign-in
 * instead of reaching a page that has nothing to show. getOrCreateAuthenticatedCustomer
 * is wrapped in React's cache(), so pages that call it again for their own
 * queries reuse this same result instead of re-querying or re-inserting.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  await auth.protect();
  const customer = await getOrCreateAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();

  return (
    <ClerkProvider>
      <div className="min-h-dvh bg-background">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Link href="/" className="text-lg font-bold tracking-tight text-foreground">
              Ege Teknik
            </Link>
            <UserButton />
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Hesabım</h1>
          <AccountNav />
          <div className="pt-6">{children}</div>
        </main>
      </div>
    </ClerkProvider>
  );
}
