import { requireAdminPage } from "@/lib/admin-page";
import BlogEditor from "../blog-editor";

export const dynamic = "force-dynamic";

export default async function NewBlogPostPage() {
  await requireAdminPage("content:write");
  return <BlogEditor />;
}
