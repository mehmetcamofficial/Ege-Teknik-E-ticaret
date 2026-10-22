import { getAdminUser } from "@/lib/admin-auth";
import { serviceRequests } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readJson } from "@/lib/http-security";

const schema = z.object({ status: z.enum(["new", "contacted", "scheduled", "completed", "cancelled"]) });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("service:write"); if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = schema.safeParse(await readJson(request)); if (!parsed.success) return Response.json({ error: "Geçersiz durum" }, { status: 400 });
  const { id } = await context.params;
  await auditedMutation(user, { action: "status", entityType: "service_request", entityId: id, payload: parsed.data }, async (tx) => { await tx.update(serviceRequests).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(serviceRequests.id, id)); });
  return Response.json({ ok: true });
}
