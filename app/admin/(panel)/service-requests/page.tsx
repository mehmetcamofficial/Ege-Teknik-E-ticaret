import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import ServiceRequestsView from "./service-requests-view";

export const dynamic = "force-dynamic";

export default async function ServiceRequestsPage() {
  const admin = await requireAdminPage();
  return <ServiceRequestsView canWrite={roleHasPermission(admin.role, "service:write")} />;
}
