import { revokeAdminSession } from "@/lib/admin-auth";
import { assertSameOrigin } from "@/lib/http-security";
export async function POST(request:Request){assertSameOrigin(request);await revokeAdminSession();return Response.redirect(new URL("/admin/login",request.url),303)}
