import { redirect } from "next/navigation";
import AuthShell from "@/components/admin/auth-shell";
import { AuthField, AuthFooterLink, AuthForm, AuthNotice, AuthPasswordField } from "@/components/admin/auth-form";
import { getAdminUser } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** Posts to the unchanged /api/auth/login. Every credential failure shows the same message; only rate limiting is named. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if (await getAdminUser()) redirect("/admin");
  const { error, reset } = await searchParams;
  return (
    <AuthShell title="Güvenli yönetici girişi" description="Yetkili e-posta ve parolanızla giriş yapın.">
      {reset && <AuthNotice tone="success">Parolanız güncellendi. Yeni parolanızla giriş yapabilirsiniz.</AuthNotice>}
      {error && <AuthNotice tone="error">{error === "429" ? "Çok fazla giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin." : "Giriş bilgileri doğrulanamadı."}</AuthNotice>}
      <AuthForm action="/api/auth/login" submitLabel="Giriş yap" pendingLabel="Giriş yapılıyor…">
        <AuthField id="login-email" name="email" label="E-posta" type="email" autoComplete="username" required maxLength={254} />
        <AuthPasswordField id="login-password" name="password" label="Parola" autoComplete="current-password" minLength={12} maxLength={200} />
      </AuthForm>
      <AuthFooterLink href="/admin/forgot-password">Şifremi unuttum?</AuthFooterLink>
    </AuthShell>
  );
}
