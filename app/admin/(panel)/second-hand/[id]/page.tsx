import { requireAdminPage } from "@/lib/admin-page";
import SecondHandEditor from "../second-hand-editor";

export const dynamic = "force-dynamic";

export default async function EditSecondHandPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("catalog:write");
  const { id } = await params;
  return <SecondHandEditor itemId={id} />;
}
