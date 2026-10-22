import { clientIp, hashWithSecret } from "@/lib/admin-auth";
import { isValidIdempotencyKey } from "@/lib/security-policy";
export async function hashClientIp(request: Request) { return hashWithSecret(clientIp(request)); }
export function idempotencyKey(request: Request) { const value = request.headers.get("idempotency-key")?.trim(); return isValidIdempotencyKey(value) ? value! : null; }
