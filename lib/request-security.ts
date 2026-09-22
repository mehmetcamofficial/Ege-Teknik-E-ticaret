import { clientIp, hashWithSecret } from "@/lib/admin-auth";
export async function hashClientIp(request: Request) { return hashWithSecret(clientIp(request)); }
export function idempotencyKey(request: Request) { const value = request.headers.get("idempotency-key")?.trim(); return value && /^[A-Za-z0-9._:-]{8,200}$/.test(value) ? value : null; }
