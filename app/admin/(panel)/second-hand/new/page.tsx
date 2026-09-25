import { requireAdminPage } from "@/lib/admin-page";
import SecondHandEditor from "../second-hand-editor";

export const dynamic = "force-dynamic";

export default async function NewSecondHandPage() {
  await requireAdminPage("catalog:write");
  return <SecondHandEditor />;
}
