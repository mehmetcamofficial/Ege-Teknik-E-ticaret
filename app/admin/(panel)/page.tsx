import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import DashboardView from "./dashboard-view";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const admin = await requireAdminPage();
  return <DashboardView canModerateReviews={roleHasPermission(admin.role, "content:write")} />;
}
