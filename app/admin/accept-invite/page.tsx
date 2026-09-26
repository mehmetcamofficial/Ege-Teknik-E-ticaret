import AuthShell from "@/components/admin/auth-shell";
import { AuthFooterLink, AuthForm, AuthNotice, AuthPasswordField } from "@/components/admin/auth-form";

/**
 * Invitation acceptance screen. The token arrives only by e-mail (Resend) and is never
 * displayed, copied or returned by any admin API - it is submitted once, exactly like a
 * password-reset token. Failures share one generic message so no token state is probe-able.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return (
    <AuthShell title="Daveti kabul et" description="E-posta ile gönderilen davet bağlantısıyla yönetici hesabınızı oluşturun.">
      {error && <AuthNotice tone="error">{error === "weak" ? "Parola güvenlik kurallarını karşılamıyor." : error === "mismatch" ? "Parolalar eşleşmiyor." : "Davet bağlantısı geçersiz veya süresi dolmuş. Yöneticinizden yeni bir davet isteyin."}</AuthNotice>}
      {token ? (
        <AuthForm action="/api/auth/accept-invite" submitLabel="Hesabı oluştur" pendingLabel="Oluşturuluyor…">
          <input type="hidden" name="token" value={token} />
          <AuthPasswordField id="invite-password" name="password" label="Parola" autoComplete="new-password" minLength={12} maxLength={200} />
          <AuthPasswordField id="invite-confirm" name="confirmPassword" label="Parola (tekrar)" autoComplete="new-password" minLength={12} maxLength={200} />
        </AuthForm>
      ) : (
        <AuthNotice tone="error">Davet bağlantısı eksik. Lütfen e-postanızdaki bağlantıyı kullanın.</AuthNotice>
      )}
      <AuthFooterLink href="/admin/login">Girişe dön</AuthFooterLink>
    </AuthShell>
  );
}
