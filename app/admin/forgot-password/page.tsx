import AuthShell from "@/components/admin/auth-shell";
import { AuthField, AuthFooterLink, AuthForm, AuthNotice } from "@/components/admin/auth-form";

/**
 * Enumeration-safe by design: the confirmation message is identical whether or not the e-mail
 * belongs to an active admin (see app/api/auth/forgot-password/route.ts) - it never states
 * whether an account was found, only that a link will arrive "if this address is registered".
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <AuthShell title="Parolamı unuttum" description="Yönetici e-posta adresinizi girin. Hesabınız varsa, parola sıfırlama bağlantısı e-posta ile gönderilir.">
      {sent && <AuthNotice tone="success">Bu e-posta adresi kayıtlıysa, birkaç dakika içinde bir parola sıfırlama bağlantısı alacaksınız.</AuthNotice>}
      {error && <AuthNotice tone="error">İstek şu anda tamamlanamadı. Lütfen biraz sonra tekrar deneyin.</AuthNotice>}
      <AuthForm action="/api/auth/forgot-password" submitLabel="Sıfırlama bağlantısı gönder" pendingLabel="Gönderiliyor…">
        <AuthField id="forgot-email" name="email" label="E-posta" type="email" autoComplete="username" required maxLength={254} />
      </AuthForm>
      <AuthFooterLink href="/admin/login">Girişe dön</AuthFooterLink>
    </AuthShell>
  );
}
