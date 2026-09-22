import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateAuthenticatedCustomer } from "@/lib/customer-auth";

export default async function AccountPage() {
  // Links the verified Clerk session to its internal customer (created on first login).
  // The layout's auth.protect() already ran; null here means no usable user session.
  const customer = await getOrCreateAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();
  const user = await currentUser();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold">Hesabım</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Hoş geldiniz{user?.firstName ? `, ${user.firstName}` : ""}.
      </p>
      <div className="mt-6">
        <UserButton />
      </div>
    </main>
  );
}
