import { requireAdminPage } from "@/lib/admin-page";
import OrdersView from "./orders-view";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  await requireAdminPage();
  return <OrdersView />;
}
