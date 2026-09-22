import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

/**
 * Scoped narrowly to /account: only this layout (not the root layout) wraps
 * children in ClerkProvider, so /admin and the static storefront never pick
 * up Clerk context. auth.protect() is the resource-based check Clerk's own
 * types recommend over middleware route matching (see proxy.ts) — it
 * redirects signed-out visitors to sign-in before anything under /account
 * renders.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  await auth.protect();
  return <ClerkProvider>{children}</ClerkProvider>;
}
