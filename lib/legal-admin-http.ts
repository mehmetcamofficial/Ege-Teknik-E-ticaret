import "server-only";
import { getAdminUser, type AuthorizedAdmin } from "@/lib/admin-auth";
import { HttpError, readJson, safeError } from "@/lib/http-security";

export { readJson };

/**
 * Every legal admin endpoint goes through this wrapper: the session is resolved server-side and must hold
 * `legal:write` (owner only). No session or a role without the permission gets the same 403 - UI hiding is not relied on.
 */
export function legalAdminRoute<P>(handler: (request: Request, admin: AuthorizedAdmin, params: P) => Promise<Response>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const admin = await getAdminUser("legal:write");
    if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
    try {
      return await handler(request, admin, await context.params);
    } catch (error) {
      if (error instanceof HttpError) return safeError(error.status, error.message);
      console.error("legal_admin_route_error", { name: error instanceof Error ? error.name : "unknown" });
      return safeError();
    }
  };
}
