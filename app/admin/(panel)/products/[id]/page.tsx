import { requireAdminPage } from "@/lib/admin-page";
import ProductEditor from "../product-editor";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("catalog:write");
  const { id } = await params;
  return <ProductEditor productId={id} />;
}
