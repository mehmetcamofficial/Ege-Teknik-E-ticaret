import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import ReviewsAdmin from "../../reviews-admin";

export const dynamic = "force-dynamic";

/** content:write for reading too - GET /api/admin/reviews enforces the same permission. */
export default async function ReviewsPage() {
  await requireAdminPage("content:write");
  return <><PageHeader title="Yorumlar" description="Müşteri yorumlarını onaylayın veya reddedin. Yorum metni hiçbir zaman düzenlenemez." /><ReviewsAdmin /></>;
}
