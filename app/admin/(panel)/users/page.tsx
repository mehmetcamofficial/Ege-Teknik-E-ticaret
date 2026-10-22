import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import UsersView from "./users-view";

export const dynamic = "force-dynamic";

/**
 * users:read gates the whole module. The two capability flags below are derived from the same
 * permission matrix the API routes enforce, and only decide which controls are rendered -
 * a super_admin temporarily granted nothing still sees exactly the same set.
 */
export default async function UsersPage() {
  const admin = await requireAdminPage("users:read");
  return (
    <UsersView
      canManageUsers={roleHasPermission(admin.role, "users:write")}
      canAssignRoles={roleHasPermission(admin.role, "roles:write")}
      selfId={admin.userId}
    />
  );
}
