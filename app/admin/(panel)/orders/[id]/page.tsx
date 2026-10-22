import { requireAdminPage } from "@/lib/admin-page";
import { effectivePermissions } from "@/lib/admin-auth";
import OrderDetailView from "../order-detail-view";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  // H5-B: capabilities come from the caller's EFFECTIVE permissions (role + live grants); the API enforces them again.
  const permissions = await effectivePermissions(admin.userId, admin.role);
  return <OrderDetailView orderId={id} canWrite={permissions.includes("orders:write")} canRecordPayment={permissions.includes("payments:record")} canRefund={permissions.includes("payments:refund")} />;
}
