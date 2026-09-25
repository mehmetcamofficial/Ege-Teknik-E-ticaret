import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import ProductsView from "./products-view";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const admin = await requireAdminPage();
  return <ProductsView canWrite={roleHasPermission(admin.role, "catalog:write")} />;
}
