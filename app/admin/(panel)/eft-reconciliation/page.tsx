import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import EftReviewView from "./review-view";

export const dynamic = "force-dynamic";

export default async function EftReconciliationPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="EFT mutabakat incelemesi" description="Banka hareketleri ve inceleme durumları. Bu sayfa salt okunurdur; hiçbir onay, ödeme veya banka aktarımı yapmaz." />
      <EftReviewView />
    </>
  );
}
