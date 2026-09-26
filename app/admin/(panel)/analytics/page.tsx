import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import AnalyticsV2 from "../../analytics-v2";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Analitik"
        description="Satış özeti ve birinci taraf ziyaretçi analitiği. Tüm sayılar gerçek kayıtlardan hesaplanır; tahsil edilen para gösterilmez."
      />
      <AnalyticsV2 />
    </>
  );
}
