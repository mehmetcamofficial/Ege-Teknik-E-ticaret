import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import LegalAdmin from "../../legal-admin";

export const dynamic = "force-dynamic";

/** Owner-only: the page itself requires legal:write, and every /api/admin/legal route re-checks it (lib/legal-admin-http.ts). */
export default async function LegalPage() {
  await requireAdminPage("legal:write");
  return <><PageHeader title="Hukuki Belgeler" description="Yayınlanan sürümler değiştirilemez; metni değiştirmek için yeni sürüm oluşturun. Bu bölüm yalnızca yetkili sahip hesabı içindir." /><LegalAdmin /></>;
}
