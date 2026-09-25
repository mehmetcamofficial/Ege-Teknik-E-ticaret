import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import SecondHandView from "./second-hand-view";

export const dynamic = "force-dynamic";

export default async function SecondHandPage() {
  const admin = await requireAdminPage();
  return <SecondHandView canWrite={roleHasPermission(admin.role, "catalog:write")} />;
}
