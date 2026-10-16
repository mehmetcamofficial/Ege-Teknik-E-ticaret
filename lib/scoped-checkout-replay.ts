import { sql } from "drizzle-orm";
import type { getCheckoutDb } from "@/db";
import { validatePersistedLegalEvidence } from "@/lib/legal-evidence";
import { toAcceptedLegalDocuments } from "@/lib/legal";
import { deliverySummaryFromSnapshot, toOrderConfirmation } from "@/lib/order-domain";

/**
 * Scoped checkout reads through 0019 SECURITY DEFINER. Never fall back to direct
 * SELECT or the legacy owner connection when this boundary is unavailable.
 * The SQL function discloses order/evidence rows ONLY if both an exact
 * idempotency key and its server-computed request fingerprint match.
 */
export async function scopedCheckoutReplay(
  reader: Pick<ReturnType<typeof getCheckoutDb>, "execute">,
  key: string,
  fingerprint: string,
): Promise<Response | null> {
  const result = await reader.execute(sql`SELECT public.checkout_replay_by_key(${key}, ${fingerprint}) AS payload`);
  const payload = (result.rows[0] as { payload: unknown } | undefined)?.payload;
  if (payload == null) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid scoped replay result");
  const object = payload as Record<string, unknown>;
  if (object.conflict === true) {
    return Response.json({ error: "Bu istek anahtarı farklı bir sipariş için kullanıldı.", code: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
  }

  // The result comes from our definer, not client input. Still fail closed on
  // malformed or incomplete material: never emit legal bodies into HTTP output.
  const order = object.order as Record<string, unknown> | undefined;
  if (!order || !Array.isArray(object.items) || !Array.isArray(object.evidence)
    || typeof order.orderNumber !== "string" || typeof order.status !== "string"
    || typeof order.createdAt !== "string") {
    throw new Error("Invalid scoped replay shape");
  }
  const createdAt = new Date(order.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Invalid scoped order date");
  const evidenceRows = object.evidence.map((entry: unknown) => {
    const row = entry as Record<string, unknown>;
    return {
      slug: row.slug as string | null,
      documentVersionId: row.documentVersionId as string,
      title: row.title as string | null,
      version: row.version as number | null,
      templateContentHash: row.templateContentHash as string | null,
      renderedBody: row.renderedBody as string | null,
      renderedSha256: row.renderedSha256 as string | null,
      renderContextVersion: row.renderContextVersion as number | null,
      acceptanceType: row.acceptanceType as string | null,
      acceptedAt: new Date(row.acceptedAt as string),
    };
  });
  const legalAcceptances = order.legalEvidenceVersion == null
    ? toAcceptedLegalDocuments(evidenceRows.map((row) => ({
        slug: row.slug ?? "", title: row.title ?? "", version: row.version ?? 0,
        documentVersionId: row.documentVersionId,
      })))
    : validatePersistedLegalEvidence({
        legalEvidenceVersion: order.legalEvidenceVersion as number,
        orderIssuedAt: order.orderIssuedAt ? new Date(order.orderIssuedAt as string) : null,
        createdAt,
      }, evidenceRows).map(({ slug, title, version, documentVersionId }) => ({ slug, title, version, documentVersionId }));

  const items = object.items as Array<{ productName: string; quantity: number; unitPrice: number; lineTotal: number }>;
  return Response.json({
    ok: true,
    ...toOrderConfirmation({
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt,
      items,
      subtotal: order.subtotal as number,
      vatTotal: order.vatTotal as number,
      shippingTotal: order.shippingTotal as number,
      installationTotal: order.installationTotal as number,
      total: order.total as number,
      customerName: order.customerName as string,
      phone: order.phone as string,
      email: order.email as string,
      city: order.city as string,
      address: order.address as string,
      installation: (order.installationPreference as string | null) ?? "none",
      legalAcceptances,
      ...deliverySummaryFromSnapshot(order.shippingAddressSnapshot),
    }),
  });
}
