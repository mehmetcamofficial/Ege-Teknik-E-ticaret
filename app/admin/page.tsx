import { redirect } from "next/navigation";
import AdminClient from "./admin-client";
import { getAdminUser } from "@/lib/admin-auth";
import { roleHasPermission } from "@/lib/security-policy";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  return <AdminClient email={admin.email} signOutPath="/api/auth/logout" canManageLegal={roleHasPermission(admin.role, "legal:write")} />;
}
