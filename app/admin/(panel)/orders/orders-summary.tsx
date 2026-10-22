"use client";

import { DataError, Panel, StatusBadge } from "@/components/admin/ui";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { describeNotifications, describeOrders, type OperationsSummary } from "@/lib/notifications/summary-view";

/** H5-A: new-order counters and the honest state of e-mail notifications (GET /api/admin/orders/summary). */
export default function OrdersSummary() {
  const { data, error, reload } = useAdminJson<OperationsSummary>("/api/admin/orders/summary");
  if (error) return <DataError message={error} onRetry={reload} />;
  if (!data) return null;
  const banner = describeNotifications(data.notifications);
  return (
    <section aria-label="Yeni siparişler ve bildirim durumu" className="mb-4 grid gap-3 md:grid-cols-2">
      <Panel>
        <h2 className="text-sm font-semibold">Yeni siparişler</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {describeOrders(data.orders).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </Panel>
      <Panel>
        <h2 className="flex items-center gap-2 text-sm font-semibold">Bildirimler <StatusBadge tone={banner.tone === "ok" ? "success" : banner.tone === "warning" ? "warning" : "danger"}>{banner.headline}</StatusBadge></h2>
        {banner.details.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm" role={banner.tone === "danger" ? "alert" : undefined}>
            {banner.details.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </Panel>
    </section>
  );
}
