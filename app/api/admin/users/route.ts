import { getAdminUser } from "@/lib/admin-auth";
import { listManagedUsers } from "@/lib/privileged-admin-db";

/**
 * users:read only. Secret-bearing columns are never selected by the data layer,
 * so this response cannot carry password_hash, token_hash, or any secret.
 */
export async function GET() {
  const admin = await getAdminUser("users:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const users = await listManagedUsers();
  return Response.json({ users }, { headers: { "cache-control": "no-store" } });
}