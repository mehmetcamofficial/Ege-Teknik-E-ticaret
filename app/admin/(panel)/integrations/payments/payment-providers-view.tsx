"use client";

import { CheckCircle2, CircleSlash } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Notice, Panel, StatCard, StatusBadge } from "@/components/admin/ui";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { trDate, tryCurrency, type Tone } from "@/lib/admin-ui";

// Response shape of GET /api/admin/integrations/paytr, declared here so no server/PayTR module reaches the browser.
type Status = {
  state: "disabled" | "misconfigured" | "test" | "live"; enabled: boolean; testMode: boolean; merchantIdMasked: string | null;
  merchantKeyConfigured: boolean; merchantSaltConfigured: boolean; okUrlConfigured: boolean; failUrlConfigured: boolean;
  missing: string[]; callbackPath: string; successPath: string; failPath: string; cspFrameAllowed: boolean;
};
type Metrics = {
  attempts: { total: number; pending: number; paid: number; failed: number; superseded: number }; paidAmount: number;
  lastAttemptAt: string | null; lastPaidAt: string | null; lastFailedAt: string | null;
  callbacks: { lastSuccessAt: string | null; lastFailedAt: string | null; invalid: number; amountMismatch: number; unknownReference: number };
  recent: { orderNumber: string; status: string; amount: number; createdAt: string; paidAt: string | null; failureCode: string | null }[];
};

const stateLabel: Record<Status["state"], [string, Tone, string]> = {
  disabled: ["Kapalı", "neutral", "Online ödeme kapalı. Müşteriye ödeme sayfası gösterilmez."],
  misconfigured: ["Yapılandırma eksik", "danger", "Açılmak istenmiş ama eksik ayar var; ödeme başlatılmaz."],
  test: ["Test modu", "warning", "PayTR test ortamı. Gerçek kart çekimi yapılmaz."],
  live: ["Aktif", "success", "Canlı mod ayarlı. Gerçek ödemeler alınabilir."],
};
/** Internal failure codes in plain Turkish; a provider code (e.g. a bank decline number) is shown as "kod N". */
const failureText = (code: string) => ({ AMOUNT_MISMATCH: "tutar uyuşmazlığı — incelenmeli", TOKEN_REQUEST_FAILED: "ödeme sayfası açılamadı", SUPERSEDED: "yeni deneme başlatıldı", FAILED: "ödeme reddedildi" } as Record<string, string>)[code] ?? `kod ${code}`;
const attemptLabel: Record<string, [string, Tone]> = { pending: ["Bekliyor", "warning"], paid: ["Başarılı", "success"], failed: ["Başarısız", "danger"], cancelled: ["Yenilendi", "neutral"] };
const missingLabel = (name: string) => {
  // Keyed by the part after "PAYTR_": the API returns variable names only, never values.
  const base: Record<string, string> = { MERCHANT_ID: "Mağaza numarası (Merchant ID)", MERCHANT_KEY: "Mağaza anahtarı (Merchant Key)", MERCHANT_SALT: "Mağaza gizli değeri (Merchant Salt)", OK_URL: "Başarılı ödeme adresi", FAIL_URL: "Başarısız ödeme adresi" };
  const m = /^PAYTR_([A-Z_]+)(?:\((format|https)\))?$/.exec(name);
  if (!m) return name;
  return `${base[m[1]!] ?? m[1]}${m[2] === "format" ? " — biçim hatalı" : m[2] === "https" ? " — https olmalı" : " — tanımlı değil"}`;
};

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0"><span className="font-medium">{label}</span> <span className="text-muted-foreground">{detail ?? (ok ? "Tanımlı" : "Tanımlı değil")}</span></span>
    </li>
  );
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all text-right font-medium">{children}</dd></div>
);

export default function PaymentProvidersView() {
  const { data, error, loading } = useAdminJson<{ status: Status; metrics: Metrics }>("/api/admin/integrations/paytr");
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return loading ? <Notice tone="info">Yükleniyor…</Notice> : null;
  const { status: s, metrics: m } = data;
  const [label, tone, explain] = stateLabel[s.state];

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="PayTR" actions={<StatusBadge tone={tone}>{label}</StatusBadge>} className="h-full">
          <p className="text-sm text-muted-foreground">{explain}</p>
          {s.state === "misconfigured" && (
            <ul className="mt-3 grid gap-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{s.missing.map((n) => <li key={n}>{missingLabel(n)}</li>)}</ul>
          )}
          <dl className="mt-4 grid gap-2">
            <Row label="Online ödeme">{s.enabled ? "Açık" : "Kapalı"}</Row>
            <Row label="Test modu">{s.testMode ? "Açık" : "Kapalı (canlı)"}</Row>
          </dl>
          <ul className="mt-4 grid gap-2 border-t pt-4">
            <Check ok={Boolean(s.merchantIdMasked)} label="Mağaza numarası" detail={s.merchantIdMasked ?? "Tanımlı değil"} />
            <Check ok={s.merchantKeyConfigured} label="Mağaza anahtarı" />
            <Check ok={s.merchantSaltConfigured} label="Mağaza gizli değeri" />
            <Check ok={s.okUrlConfigured} label="Başarılı ödeme adresi" />
            <Check ok={s.failUrlConfigured} label="Başarısız ödeme adresi" />
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Anahtar ve gizli değer bu panelde hiçbir zaman gösterilmez; yalnızca tanımlı olup olmadıkları bilinir.</p>
        </Panel>
        <Panel title="Entegrasyon" description="PayTR panelinde tanımlanacak adresler ve sitenin buna hazır olma durumu." className="h-full">
          <dl className="grid gap-2">
            <Row label="Bildirim adresi"><code className="text-xs">{s.callbackPath}</code></Row>
            <Row label="Başarılı ödeme sayfası"><code className="text-xs">{s.successPath}</code></Row>
            <Row label="Başarısız ödeme sayfası"><code className="text-xs">{s.failPath}</code></Row>
          </dl>
          <ul className="mt-4 grid gap-2 border-t pt-4">
            <Check ok={s.cspFrameAllowed} label="Ödeme penceresi izni (güvenlik politikası)" detail={s.cspFrameAllowed ? "Hazır" : "Henüz eklenmedi — PayTR açılmadan önce eklenecek"} />
          </ul>
        </Panel>
      </div>

      <section aria-label="PayTR ödeme denemeleri" className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3">
        <StatCard label="Toplam deneme" value={m.attempts.total} hint={m.lastAttemptAt ? `Son: ${trDate(m.lastAttemptAt, true)}` : "Henüz yok"} />
        <StatCard label="Bekliyor" tone="warning" value={m.attempts.pending} />
        <StatCard label="Başarılı" tone="success" value={m.attempts.paid} hint={m.lastPaidAt ? `Son: ${trDate(m.lastPaidAt, true)}` : undefined} />
        <StatCard label="Başarısız" tone="danger" value={m.attempts.failed} hint={m.lastFailedAt ? `Son: ${trDate(m.lastFailedAt, true)}` : undefined} />
        <StatCard label="Yenilendi" value={m.attempts.superseded} />
        <StatCard label="PayTR tahsilatı" tone="info" value={tryCurrency(m.paidAmount)} hint="Yalnızca başarılı ödemeler" />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Bildirim sağlığı" description="PayTR'den gelen ödeme bildirimleri. Ham içerik saklanmaz ve gösterilmez." className="h-full">
          <dl className="grid gap-2">
            <Row label="Son başarılı bildirim">{trDate(m.callbacks.lastSuccessAt, true)}</Row>
            <Row label="Son başarısız ödeme bildirimi">{trDate(m.callbacks.lastFailedAt, true)}</Row>
            <Row label="Doğrulanamayan bildirim">{m.callbacks.invalid}</Row>
            <Row label="Tutar uyuşmazlığı (incelenmeli)">{m.callbacks.amountMismatch}</Row>
            <Row label="Eşleşmeyen ödeme referansı">{m.callbacks.unknownReference}</Row>
          </dl>
        </Panel>
        <Panel title="Güvenlik" description="Koddaki korumalar; testlerle denetlenir." className="h-full">
          <ul className="grid gap-2">
            <Check ok label="Bildirim imza doğrulaması" detail="Aktif — imzasız bildirim hiçbir şeyi değiştirmez" />
            <Check ok label="Tekrarlanan bildirim koruması" detail="Aktif — aynı ödeme iki kez işlenmez" />
            <Check ok label="Anahtarlar yalnızca sunucuda" detail="Aktif — tarayıcıya ve yanıtlara gönderilmez" />
            <Check ok label="Kart bilgisi" detail="Ege Teknik kart bilgisi almaz ve saklamaz" />
          </ul>
        </Panel>
      </div>

      <Panel title="Son hareketler" description="Son 5 PayTR ödeme denemesi." bodyClassName={m.recent.length ? "p-0" : undefined}>
        {m.recent.length ? (
          <>
            <div className="hidden px-1 pb-1 md:block md:px-2">
              <Table>
                <TableHeader><TableRow><TableHead>Sipariş</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Tutar</TableHead><TableHead>Başlatılma</TableHead><TableHead>Ödenme</TableHead></TableRow></TableHeader>
                <TableBody>
                  {m.recent.map((r, i) => {
                    const [l, t] = attemptLabel[r.status] ?? [r.status, "neutral" as Tone];
                    return (
                      <TableRow key={`${r.orderNumber}-${i}`}>
                        <TableCell className="font-medium">{r.orderNumber}</TableCell>
                        <TableCell><StatusBadge tone={t}>{l}</StatusBadge>{r.failureCode && <span className="ml-2 text-xs text-muted-foreground">{failureText(r.failureCode)}</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{tryCurrency(r.amount)}</TableCell>
                        <TableCell>{trDate(r.createdAt, true)}</TableCell>
                        <TableCell>{trDate(r.paidAt, true)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {m.recent.map((r, i) => {
                const [l, t] = attemptLabel[r.status] ?? [r.status, "neutral" as Tone];
                return (
                  <li key={`${r.orderNumber}-${i}`} className="grid gap-1 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{r.orderNumber}</span><StatusBadge tone={t}>{l}</StatusBadge></div>
                    <p className="tabular-nums">{tryCurrency(r.amount)}</p>
                    <p className="text-xs text-muted-foreground">{trDate(r.createdAt, true)}{r.failureCode ? ` · ${failureText(r.failureCode)}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          </>
        ) : <EmptyState title="Henüz PayTR ödeme denemesi yok" description="Online ödeme açıldığında müşteri denemeleri burada görünür." />}
      </Panel>
    </div>
  );
}
