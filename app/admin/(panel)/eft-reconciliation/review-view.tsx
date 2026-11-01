"use client";

import { useAdminJson } from "@/components/admin/use-admin-data";
import { Notice, Panel } from "@/components/admin/ui";

type Movement = {
  movementId: string; bankCode: string; accountLabel: string; ibanLast4: string; accountStatus: string;
  bankTransactionId: string; amountTl: number; direction: string; memo: string; occurredAt: string;
  movementStatus: string; reviewStatus: string; reviewOrderId: string | null;
};
type Queue = { mode: "read_only"; settlementEnabled: false; paymentsWritten: false; limit: number; movements: Movement[] };

export default function EftReviewView() {
  const { data, error, loading, reload } = useAdminJson<Queue>("/api/admin/eft-reconciliation");
  return (
    <Panel title="Banka hareketleri · inceleme kuyruğu">
      <div className="grid gap-4">
        <Notice tone="info">Bu ekran yalnızca inceleme içindir. Mutabakat kararı, ödeme kaydı ve banka hesabı doğrulaması burada yapılmaz. Dekont veya açıklama tek başına tahsilat kanıtı değildir.</Notice>
        <div><button type="button" onClick={reload} className="rounded-md border px-3 py-2 text-sm">Listeyi yenile</button></div>
        {loading && <p className="text-sm text-muted-foreground">Banka hareketleri yükleniyor…</p>}
        {error && <Notice tone="error">{error}</Notice>}
        {data && (
          <>
            {data.movements.length === 0
              ? <p className="text-sm text-muted-foreground">İncelenecek banka hareketi yok. Gerçek banka bağlantısı ve hareket içe aktarımı henüz etkin değil.</p>
              : <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b">
                      <th className="p-2">Tarih</th><th className="p-2">Hesap</th><th className="p-2">İşlem referansı</th>
                      <th className="p-2">Açıklama</th><th className="p-2">Tutar (TL)</th><th className="p-2">İnceleme</th>
                    </tr></thead>
                    <tbody>{data.movements.map(m => <tr key={m.movementId} className="border-b align-top">
                      <td className="p-2">{new Date(m.occurredAt).toLocaleDateString("tr-TR")}</td>
                      <td className="p-2">{m.bankCode} · {m.accountLabel} · ••••{m.ibanLast4}<div className="text-xs text-muted-foreground">{m.accountStatus}</div></td>
                      <td className="p-2 font-mono">{m.bankTransactionId}</td>
                      <td className="p-2">{m.memo || "—"}</td>
                      <td className="p-2 tabular-nums">{m.direction === "debit" ? "−" : "+"}{m.amountTl.toLocaleString("tr-TR")}</td>
                      <td className="p-2">{m.reviewStatus}<div className="text-xs text-muted-foreground">{m.reviewOrderId ? "Siparişle ilişkilendirildi" : "Sipariş eşleşmesi yok"}</div></td>
                    </tr>)}</tbody>
                  </table>
                </div>
            }
            <p className="text-xs text-muted-foreground">En fazla {data.limit} hareket gösterilir. Onay statüsü hiçbir zaman otomatik tahsilat anlamına gelmez.</p>
          </>
        )}
      </div>
    </Panel>
  );
}
