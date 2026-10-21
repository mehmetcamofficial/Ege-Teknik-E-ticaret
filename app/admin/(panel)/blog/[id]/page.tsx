import { requireAdminPage } from "@/lib/admin-page";
import BlogEditor from "../blog-editor";

export const dynamic = "force-dynamic";

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("content:write");
  const { id } = await params;
  return <BlogEditor postId={id} />;
}
