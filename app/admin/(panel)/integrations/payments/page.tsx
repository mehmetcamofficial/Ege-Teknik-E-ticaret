import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import PaymentProvidersView from "./payment-providers-view";

export const dynamic = "force-dynamic";

/** Read-only. Passes no configuration as props: the view reads the guarded status API, which never carries a secret. */
export default async function PaymentProvidersPage() {
  await requireAdminPage("integrations:read");
  return (
    <>
      <PageHeader title="Ödeme Sağlayıcıları" description="PayTR bağlantısının durumu ve son hareketleri. Bu sayfa yalnızca görüntüler; ayarlar barındırma ortamında yapılır." />
      <PaymentProvidersView />
    </>
  );
}
