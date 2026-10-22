import type { ReactNode } from "react";
import AdminShell from "@/components/admin/admin-shell";
import { Toaster } from "@/components/ui/sonner";
import { requireAdminPage } from "@/lib/admin-page";
import { visibleNav } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <AdminShell email={admin.email} role={admin.role} sections={visibleNav(admin.role)} signOutPath="/api/auth/logout">
      {children}
      <Toaster position="top-right" richColors />
    </AdminShell>
  );
}
