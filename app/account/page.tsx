import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";

export default async function AccountPage() {
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
