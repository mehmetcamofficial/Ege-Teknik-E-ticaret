import AuthShell from "@/components/admin/auth-shell";
import { AuthFooterLink, AuthForm, AuthNotice, AuthPasswordField } from "@/components/admin/auth-form";

const errorMessage: Record<string, string> = {
  invalid: "Bu bağlantı geçersiz veya süresi dolmuş. Yeni bir sıfırlama bağlantısı isteyin.",
  weak: "Bu parola yeterince güçlü değil (çok yaygın, tekrarlı veya çok kısa). Lütfen farklı bir parola seçin.",
  mismatch: "Girdiğiniz parolalar birbiriyle eşleşmiyor.",
};

/**
 * The token travels only as a value the form re-submits (hidden field, never re-validated by
 * reading the DB at render time) - the POST in app/api/auth/reset-password/route.ts is the only
 * place it is ever checked, so an invalid/expired token reveals nothing extra just by being pasted here.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const message = error ? errorMessage[error] ?? "Bir sorun oluştu. Lütfen tekrar deneyin." : null;
  return (
    <AuthShell title="Yeni parola belirle" description="En az 12 karakterlik, tahmin edilmesi zor bir parola seçin.">
      {message && <AuthNotice tone="error">{message}</AuthNotice>}
      {!token ? (
        <p className="mt-5 text-sm text-muted-foreground">Bu sayfaya doğrudan erişemezsiniz. E-postanızdaki sıfırlama bağlantısını kullanın.</p>
      ) : (
        <AuthForm action="/api/auth/reset-password" submitLabel="Parolayı güncelle" pendingLabel="Güncelleniyor…">
          <input type="hidden" name="token" value={token} />
          <AuthPasswordField id="reset-password" name="password" label="Yeni parola" autoComplete="new-password" minLength={12} maxLength={200} describedBy="reset-policy" />
          <AuthPasswordField id="reset-confirm" name="confirmPassword" label="Yeni parola (tekrar)" autoComplete="new-password" minLength={12} maxLength={200} describedBy="reset-policy" />
          <p id="reset-policy" className="mt-2.5 text-xs text-muted-foreground">En az 12, en fazla 200 karakter. Büyük/küçük harf veya sembol zorunluluğu yok; yalnızca çok yaygın veya tahmin edilmesi kolay parolalar reddedilir.</p>
        </AuthForm>
      )}
      <AuthFooterLink href="/admin/login">Girişe dön</AuthFooterLink>
    </AuthShell>
  );
}
