/**
 * P3-LEGAL-3C.4/P2 - shared harness for the pre-acceptance legal preview.
 *
 * Sets a DETERMINISTIC test signing secret (never a real one, never committed as a real value) and drives the REAL
 * `POST /api/checkout/legal-preview` route through the same in-memory fakes as `POST /api/orders`, so a test exercises
 * preview -> acceptance -> order for real rather than asserting on source text.
 *
 * Import this AFTER `register("./support/order-route-hooks.mjs", import.meta.url)` so the fakes are in place.
 */
import { state } from "./order-route-fakes.ts";

/** Deterministic and obviously fake: >= 32 chars so it satisfies the production secret policy. */
export const TEST_LEGAL_PREVIEW_SECRET = "p2-test-legal-preview-signing-secret-0123456789";
process.env.LEGAL_PREVIEW_SIGNING_SECRET = TEST_LEGAL_PREVIEW_SECRET;

/**
 * Ask the real preview route for a token for this checkout payload.
 * Returns undefined when the preview itself is refused (e.g. a marketing opt-in), which is exactly what should
 * happen: those refusals still fire inside the order route before any token is considered.
 */
export async function legalPreviewTokenFor(previewPost: (request: Request) => Promise<Response>, body: unknown): Promise<string | undefined> {
  const response = await previewPost(new Request("https://shop.test/api/checkout/legal-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  if (!response.ok) return undefined;
  const data = (await response.json()) as { legalPreviewToken?: string };
  return data.legalPreviewToken;
}

/** Seed the fake legal bodies for every required version, so rendering has a real template to fill. */
export function seedLegalBodies(body?: string): void {
  for (const doc of state.required) state.legalBodies[doc.versionId] = body ?? state.legalBodies[doc.versionId] ?? "";
}
