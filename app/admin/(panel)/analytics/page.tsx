import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import AnalyticsAdmin from "../../analytics-admin";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireAdminPage();
  return <><PageHeader title="Analitik" description="Birinci taraf, gizlilik odaklı ziyaret verileri. Ham IP veya tarayıcı bilgisi saklanmaz; bot trafiği tüm sayılardan hariç tutulur." /><AnalyticsAdmin /></>;
}
