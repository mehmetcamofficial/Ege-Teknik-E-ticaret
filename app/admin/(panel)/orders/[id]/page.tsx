import { requireAdminPage } from "@/lib/admin-page";
import { roleHasPermission } from "@/lib/security-policy";
import OrderDetailView from "../order-detail-view";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  return <OrderDetailView orderId={id} canWrite={roleHasPermission(admin.role, "orders:write")} />;
}
