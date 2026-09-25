import AuthShell, { authButton, authInput, authLabel, authLink } from "@/components/admin/auth-shell";

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
      {message && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      {!token ? (
        <p className="mt-5 text-sm text-muted-foreground">Bu sayfaya doğrudan erişemezsiniz. E-postanızdaki sıfırlama bağlantısını kullanın.</p>
      ) : (
        <form method="post" action="/api/auth/reset-password">
          <input type="hidden" name="token" value={token} />
          <label htmlFor="reset-password" className={authLabel}>Yeni parola</label>
          <input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} aria-describedby="reset-policy" className={`${authInput} h-11`} />
          <label htmlFor="reset-confirm" className={authLabel}>Yeni parola (tekrar)</label>
          <input id="reset-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={200} aria-describedby="reset-policy" className={`${authInput} h-11`} />
          <p id="reset-policy" className="mt-2 text-xs text-muted-foreground">En az 12, en fazla 200 karakter. Büyük/küçük harf veya sembol zorunluluğu yok; yalnızca çok yaygın veya tahmin edilmesi kolay parolalar reddedilir.</p>
          <button type="submit" className={`${authButton} h-11`}>Parolayı güncelle</button>
        </form>
      )}
      <p className="mt-5 text-center text-sm"><a href="/admin/login" className={`${authLink} inline-flex min-h-11 items-center`}>Girişe dön</a></p>
    </AuthShell>
  );
}
