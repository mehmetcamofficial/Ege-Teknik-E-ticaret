import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import InventoryView from "./inventory-view";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const admin = await requireAdminPage();
  return <InventoryView canWrite={roleHasPermission(admin.role, "catalog:write")} />;
}
