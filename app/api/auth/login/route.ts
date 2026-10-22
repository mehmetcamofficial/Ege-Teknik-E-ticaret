import { getDb } from "@/db";
import { adminUsers, auditLogs } from "@/db/schema";
import { createAdminSession, verifyPassword } from "@/lib/admin-auth";
import { HttpError, assertSameOrigin, rateLimit } from "@/lib/http-security";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({ email: z.string().trim().email().max(254).transform(x => x.toLowerCase()), password: z.string().min(12).max(200) });
const failed = (request: Request) => Response.redirect(new URL("/admin/login?error=1", request.url), 303);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-login", 5, 15 * 60_000);
    const form = await request.formData();
    const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) return failed(request);

    const db = getDb();
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, parsed.data.email)).limit(1);
    if (!admin?.active || !admin.passwordHash || !(await verifyPassword(parsed.data.password, admin.passwordHash))) return failed(request);

    await createAdminSession(admin.id, request);
    await db.update(adminUsers).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(adminUsers.id, admin.id));
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: admin.id, actorEmail: admin.email, action: "login", entityType: "admin_session", entityId: admin.id, payload: { method: "password" } });
    return Response.redirect(new URL("/admin", request.url), 303);
  } catch (error) {
    if (error instanceof HttpError) return Response.redirect(new URL(`/admin/login?error=${error.status}`, request.url), 303);
    console.error("admin_login_error", { name: error instanceof Error ? error.name : "unknown" });
    return failed(request);
  }
}
