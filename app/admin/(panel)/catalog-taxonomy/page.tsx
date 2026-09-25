import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import TaxonomyView from "./taxonomy-view";

export const dynamic = "force-dynamic";

export default async function CatalogTaxonomyPage() {
  const admin = await requireAdminPage();
  return <TaxonomyView canWrite={roleHasPermission(admin.role, "catalog:write")} />;
}
