import { redirect } from "next/navigation";
import AuthShell, { authButton, authInput, authLabel, authLink } from "@/components/admin/auth-shell";
import { getAdminUser } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** Posts to the unchanged /api/auth/login. Every credential failure shows the same message; only rate limiting is named. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if (await getAdminUser()) redirect("/admin");
  const { error, reset } = await searchParams;
  return (
    <AuthShell title="Güvenli yönetici girişi" description="Yetkili e-posta ve parolanızla giriş yapın.">
      {reset && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Parolanız güncellendi. Yeni parolanızla giriş yapabilirsiniz.</p>}
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error === "429" ? "Çok fazla giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin." : "Giriş bilgileri doğrulanamadı."}</p>}
      <form method="post" action="/api/auth/login">
        <label htmlFor="login-email" className={authLabel}>E-posta</label>
        <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} className={`${authInput} h-11`} />
        <label htmlFor="login-password" className={authLabel}>Parola</label>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={200} className={`${authInput} h-11`} />
        <button type="submit" className={`${authButton} h-11`}>Giriş yap</button>
      </form>
      <p className="mt-5 text-center text-sm"><a href="/admin/forgot-password" className={`${authLink} inline-flex min-h-11 items-center`}>Şifremi unuttum?</a></p>
    </AuthShell>
  );
}
