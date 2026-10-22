/**
 * TEST-ONLY synthetic legal data for the browser acceptance suites (scripts/test-hybrid-h3*.mjs).
 *
 * NOT LEGAL TEXT. These strings are never imported by application code (guarded by tests/hybrid-h3-checkout.test.ts)
 * and are only ever returned from Playwright-intercepted responses, never from the server or a database.
 * Server-owned Preview render fixtures are a separate, earlier boundary: lib/legal-fixture-registry.ts.
 */
export const TEST_LABEL = "TEST SENTETİK";
export const TEST_ORDER_NUMBER = "TEST-SENTETIK-SIPARIS";

/** Builds an intercepted preview response from document identities (slug/versionId). Titles, versions and bodies are synthetic. */
export function syntheticPreviewDocuments(identities, customerName = "") {
  return identities.map((d, i) => ({
    documentVersionId: d.versionId, slug: d.slug,
    title: `${TEST_LABEL} — ${d.slug}`, version: i + 1,
    renderedBody: `${TEST_LABEL} — GERÇEK HUKUKİ METİN DEĞİLDİR\nAlıcı: ${customerName}\nBu metin yalnızca otomatik test içindir.`,
  }));
}
export const syntheticIdentities = [{ slug: "terms", versionId: "test-terms-1" }, { slug: "distance-sales", versionId: "test-distance-1" }];
