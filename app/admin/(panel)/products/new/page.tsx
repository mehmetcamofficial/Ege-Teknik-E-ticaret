import { requireAdminPage } from "@/lib/admin-page";
import ProductEditor from "../product-editor";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireAdminPage("catalog:write");
  return <ProductEditor />;
}
