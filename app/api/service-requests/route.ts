import { getDb } from "@/db";
import { serviceRequests } from "@/db/schema";
import { z } from "zod";

const requestSchema = z.object({
  type: z.string().min(1).max(40), name: z.string().min(2).max(100), phone: z.string().min(7).max(30),
  email: z.string().email().max(150).optional().or(z.literal("")), city: z.string().min(2).max(100), message: z.string().min(3).max(3000),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Lütfen form alanlarını kontrol edin." }, { status: 400 });
  const id = crypto.randomUUID();
  const requestNumber = `ET-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
  await getDb().insert(serviceRequests).values({ id, requestNumber, ...parsed.data });
  return Response.json({ ok: true, requestNumber }, { status: 201 });
}
