import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import BlogView from "./blog-view";

export const dynamic = "force-dynamic";

export default async function BlogPage() {
  const admin = await requireAdminPage();
  return <BlogView canWrite={roleHasPermission(admin.role, "content:write")} />;
}
