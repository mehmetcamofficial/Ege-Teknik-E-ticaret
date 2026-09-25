import AuthShell, { authButton, authInput, authLabel, authLink } from "@/components/admin/auth-shell";

/**
 * Enumeration-safe by design: the confirmation message is identical whether or not the e-mail
 * belongs to an active admin (see app/api/auth/forgot-password/route.ts) - it never states
 * whether an account was found, only that a link will arrive "if this address is registered".
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <AuthShell title="Parolamı unuttum" description="Yönetici e-posta adresinizi girin. Hesabınız varsa, parola sıfırlama bağlantısı e-posta ile gönderilir.">
      {sent && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Bu e-posta adresi kayıtlıysa, birkaç dakika içinde bir parola sıfırlama bağlantısı alacaksınız.</p>}
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">İstek şu anda tamamlanamadı. Lütfen biraz sonra tekrar deneyin.</p>}
      <form method="post" action="/api/auth/forgot-password">
        <label htmlFor="forgot-email" className={authLabel}>E-posta</label>
        <input id="forgot-email" name="email" type="email" autoComplete="username" required maxLength={254} className={`${authInput} h-11`} />
        <button type="submit" className={`${authButton} h-11`}>Sıfırlama bağlantısı gönder</button>
      </form>
      <p className="mt-5 text-center text-sm"><a href="/admin/login" className={`${authLink} inline-flex min-h-11 items-center`}>Girişe dön</a></p>
    </AuthShell>
  );
}
