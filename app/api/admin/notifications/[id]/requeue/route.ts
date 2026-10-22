import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { requeueDeadNotification } from "@/lib/notifications/outbox";

/** H5-A: put a DEAD notification back in the queue (e.g. after the recipient configuration was fixed). Audited. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("orders:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Geçersiz bildirim." }, { status: 400 });
  const ok = await requeueDeadNotification(getDb(), id, { userId: admin.userId, email: admin.email });
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Bildirim bulunamadı veya başarısız durumda değil." }, { status: 409 });
}
