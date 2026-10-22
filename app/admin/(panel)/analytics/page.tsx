import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import { sanitizeAnalyticsQuery } from "@/lib/analytics";
import AnalyticsV2 from "../../analytics-v2";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const initialQuery = sanitizeAnalyticsQuery(await searchParams, new Date());
  return (
    <>
      <PageHeader
        title="Analitik"
        description="Satış özeti ve birinci taraf ziyaretçi analitiği. Tüm sayılar gerçek kayıtlardan hesaplanır; tahsil edilen para gösterilmez."
      />
      <AnalyticsV2 initialQuery={initialQuery} />
    </>
  );
}
