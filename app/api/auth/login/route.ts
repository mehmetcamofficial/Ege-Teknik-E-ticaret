import { getDb } from "@/db";
import { adminUsers, auditLogs } from "@/db/schema";
import { createAdminSession, verifyPassword } from "@/lib/admin-auth";
import { HttpError, assertSameOrigin, rateLimit } from "@/lib/http-security";
import { canBootstrapAdmin } from "@/lib/security-policy";
import { count, eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({ email: z.string().trim().email().max(254).transform(x => x.toLowerCase()), password: z.string().min(12).max(200) });
const failed = (request: Request) => Response.redirect(new URL("/admin/login?error=1", request.url), 303);

type AdminRecord = typeof adminUsers.$inferSelect;

/**
 * Only ever creates the first administrator: the zero-admin check and the insert share
 * one transaction, and the unique index on admin_users.email rejects a concurrent second
 * winner, so a race cannot produce two bootstrapped owners.
 */
async function bootstrapFirstAdmin(email: string, password: string): Promise<AdminRecord | null> {
  const configuredEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const configuredPasswordHash = process.env.ADMIN_BOOTSTRAP_PASSWORD_HASH;
  const db = getDb();
  const [{ value: adminCount }] = await db.select({ value: count() }).from(adminUsers);
  if (!canBootstrapAdmin({ adminCount, configuredEmail, configuredPasswordHash, submittedEmail: email })) return null;
  if (!(await verifyPassword(password, configuredPasswordHash!))) return null;

  try {
    return await db.transaction(async (tx) => {
      const [{ value: confirmed }] = await tx.select({ value: count() }).from(adminUsers);
      if (confirmed !== 0) return null;
      const id = crypto.randomUUID();
      const [created] = await tx.insert(adminUsers).values({ id, externalUserId: `password:${email}`, email, passwordHash: configuredPasswordHash!, role: "owner" }).returning();
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: id, actorEmail: email, action: "bootstrap", entityType: "admin_user", entityId: id, payload: { role: "owner", reason: "initial_admin_bootstrap" } });
      return created ?? null;
    });
  } catch {
    // A concurrent bootstrap won the unique index; fall back to normal login.
    return null;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-login", 5, 15 * 60_000);
    const form = await request.formData();
    const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) return failed(request);

    const db = getDb();
    const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, parsed.data.email)).limit(1);
    const admin: AdminRecord | null = existing[0] ?? (await bootstrapFirstAdmin(parsed.data.email, parsed.data.password));
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
