import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import { redirect } from "next/navigation";
import ProfitabilityCalculator from "./profitability-calculator";

export const dynamic = "force-dynamic";
export default async function ProfitabilityPage() {
  const admin = await requireAdminPage("payments:configure");
  if (admin.role !== "super_admin") redirect("/admin");
  return <div className="space-y-6">
    <PageHeader title="Kârlılık Hesaplayıcı" description="Satış katkısı ve marj analizi. Yalnızca süper yönetici erişebilir. Hesaplar hiçbir ürün veya sipariş kaydını değiştirmez." />
    <ProfitabilityCalculator />
  </div>;
}
