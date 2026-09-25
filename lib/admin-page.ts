import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin-auth";
import { roleHasPermission, type AdminPermission } from "@/lib/security-policy";

/**
 * One getAdminUser() per server render, shared by the (panel) layout and the page via React's
 * request-scoped cache - the same number of calls the single-page /admin made before, so session
 * behaviour is unchanged. Every page calls requireAdminPage itself: a layout alone is not an
 * authorization boundary in the App Router (pages can render without their layout re-running).
 */
export const currentAdmin = cache(() => getAdminUser());

export async function requireAdminPage(permission: AdminPermission = "admin:read") {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  if (!roleHasPermission(admin.role, permission)) redirect("/admin");
  return admin;
}
