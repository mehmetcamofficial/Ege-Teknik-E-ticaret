/**
 * Enumeration-safe by design: the confirmation message is identical whether or not the e-mail
 * belongs to an active admin (see app/api/auth/forgot-password/route.ts) - it never states
 * whether an account was found, only that a link will arrive "if this address is registered".
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f8f6] p-5">
      <div className="w-full max-w-md rounded-2xl border bg-white p-7 shadow-sm">
        <p className="text-xs font-bold tracking-[.18em] text-emerald-700">EGE TEKNİK</p>
        <h1 className="mt-2 text-2xl font-bold">Parolamı unuttum</h1>
        <p className="mt-2 text-sm text-zinc-600">Yönetici e-posta adresinizi girin. Hesabınız varsa, parola sıfırlama bağlantısı e-posta ile gönderilir.</p>
        {sent && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Bu e-posta adresi kayıtlıysa, birkaç dakika içinde bir parola sıfırlama bağlantısı alacaksınız.</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">İstek şu anda tamamlanamadı. Lütfen biraz sonra tekrar deneyin.</p>}
        <form method="post" action="/api/auth/forgot-password">
          <label className="mt-6 block text-sm font-semibold">E-posta
            <input name="email" type="email" autoComplete="username" required maxLength={254} className="mt-1 h-11 w-full rounded-lg border px-3" />
          </label>
          <button className="mt-6 h-11 w-full rounded-lg bg-[#07261d] font-semibold text-white">Sıfırlama bağlantısı gönder</button>
        </form>
        <p className="mt-4 text-center text-sm"><a href="/admin/login" className="font-semibold text-emerald-700 underline underline-offset-2">Girişe dön</a></p>
      </div>
    </main>
  );
}
