import { chatGPTSignOutPath, requireChatGPTUser } from "@/app/chatgpt-auth";
import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  if (user.email.toLowerCase() !== "oncoconnect2@gmail.com") {
    return <main className="mx-auto max-w-xl p-10"><h1 className="text-2xl font-bold">Erişim yetkiniz yok</h1><p className="mt-3 text-zinc-600">Bu alan yalnızca Ege Teknik yöneticisine açıktır.</p><a className="mt-6 inline-block underline" href={chatGPTSignOutPath("/admin")}>Farklı hesapla giriş yap</a></main>;
  }
  return <AdminClient email={user.email} signOutPath={chatGPTSignOutPath("/index.html")} />;
}
