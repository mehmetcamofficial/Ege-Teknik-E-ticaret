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
    <main className="grid min-h-screen place-items-center bg-[#f4f8f6] p-5">
      <div className="w-full max-w-md rounded-2xl border bg-white p-7 shadow-sm">
        <p className="text-xs font-bold tracking-[.18em] text-emerald-700">EGE TEKNİK</p>
        <h1 className="mt-2 text-2xl font-bold">Yeni parola belirle</h1>
        <p className="mt-2 text-sm text-zinc-600">En az 12 karakterlik, tahmin edilmesi zor bir parola seçin.</p>
        {message && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>}
        {!token ? (
          <p className="mt-6 text-sm text-zinc-600">Bu sayfaya doğrudan erişemezsiniz. E-postanızdaki sıfırlama bağlantısını kullanın.</p>
        ) : (
          <form method="post" action="/api/auth/reset-password">
            <input type="hidden" name="token" value={token} />
            <label className="mt-6 block text-sm font-semibold">Yeni parola
              <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className="mt-1 h-11 w-full rounded-lg border px-3" />
            </label>
            <label className="mt-4 block text-sm font-semibold">Yeni parola (tekrar)
              <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className="mt-1 h-11 w-full rounded-lg border px-3" />
            </label>
            <p className="mt-2 text-xs text-zinc-500">En az 12, en fazla 200 karakter. Büyük/küçük harf veya sembol zorunluluğu yok; yalnızca çok yaygın veya tahmin edilmesi kolay parolalar reddedilir.</p>
            <button className="mt-6 h-11 w-full rounded-lg bg-[#07261d] font-semibold text-white">Parolayı güncelle</button>
          </form>
        )}
        <p className="mt-4 text-center text-sm"><a href="/admin/login" className="font-semibold text-emerald-700 underline underline-offset-2">Girişe dön</a></p>
      </div>
    </main>
  );
}
