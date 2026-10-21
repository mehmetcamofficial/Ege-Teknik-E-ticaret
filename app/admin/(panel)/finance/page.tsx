import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import FinanceView from "./finance-view";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Finans"
        description="Sipariş tutarı, gerçekten kaydedilmiş tahsilat ve iadeler ayrı ayrı gösterilir. Tahsilat yalnızca ödeme kaydı olan tutardır; ödeme sağlayıcısı henüz aktif değildir."
      />
      <FinanceView />
    </>
  );
}
