import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legalVersionPath, resolvePublicLegalVersion, selectCurrentLegalVersions, selectRequiredLegalVersions, type PublicLegalVersion } from "../lib/legal.ts";
import { renderLegalBody, renderLegalPage } from "../lib/legal-render.ts";

const now = new Date("2026-09-24T00:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const v = (id: string, version: number, published: string, effective: string, slug = "distance-sales"): PublicLegalVersion => ({ id, slug, version, title: `T${version}`, body: `body ${version}`, contentHash: "h".repeat(64), effectiveAt: day(effective), publishedAt: day(published) });
const rows = [v("v1", 1, "2026-01-01", "2026-01-01"), v("v2", 2, "2026-06-01", "2026-06-01"), v("v3", 3, "2026-09-01", "2027-01-01")];

test("current view returns the highest published+effective version", () => {
  const r = resolvePublicLegalVersion(rows, null, now);
  assert.ok(r.ok && r.version.id === "v2" && r.status === "effective");
});
test("a future-effective version does not become current early", () => {
  assert.ok(resolvePublicLegalVersion(rows, null, now).ok);
  const r = resolvePublicLegalVersion(rows, null, day("2027-01-02"));
  assert.ok(r.ok && r.version.id === "v3");
  assert.equal(selectRequiredLegalVersions(rows.map((x) => ({ ...x })), now, ["distance-sales"]).ok && (selectRequiredLegalVersions(rows, now, ["distance-sales"]) as { required: { versionId: string }[] }).required[0].versionId, "v2");
});
test("an exact historical published version stays viewable and is never substituted by a newer one", () => {
  const r = resolvePublicLegalVersion(rows, "v1", now);
  assert.ok(r.ok && r.version.id === "v1" && r.version.body === "body 1" && r.status === "superseded");
});
test("an unpublished (future published_at) version is not reachable by id", () => {
  const r = resolvePublicLegalVersion([...rows, v("v4", 4, "2026-12-01", "2026-12-01")], "v4", now);
  assert.deepEqual(r, { ok: false, reason: "version_not_found" });
});
test("unknown version and mismatched slug/version are rejected", () => {
  assert.deepEqual(resolvePublicLegalVersion(rows, "nope", now), { ok: false, reason: "version_not_found" });
  // the loader only passes the requested slug's rows, so another document's version id is unknown here
  assert.deepEqual(resolvePublicLegalVersion(rows, "other-doc-version", now), { ok: false, reason: "version_not_found" });
  assert.deepEqual(resolvePublicLegalVersion([], null, now), { ok: false, reason: "not_found" });
});
test("published-but-scheduled version is viewable by id with scheduled status", () => {
  const r = resolvePublicLegalVersion(rows, "v3", now);
  assert.ok(r.ok && r.status === "scheduled");
});
test("public index lists only current versions, metadata only", () => {
  const idx = selectCurrentLegalVersions([...rows, v("p1", 1, "2026-01-01", "2026-01-01", "pre-information")], now);
  assert.deepEqual(idx, [{ slug: "distance-sales", title: "T2", versionId: "v2" }, { slug: "pre-information", title: "T1", versionId: "p1" }]);
  for (const entry of idx) assert.deepEqual(Object.keys(entry).sort(), ["slug", "title", "versionId"]);
});
test("checkout link carries the exact version id", () => {
  assert.equal(legalVersionPath("distance-sales", "a b/1"), "/legal/distance-sales?version=a%20b%2F1");
  const js = readFileSync("public/store.js", "utf8");
  assert.match(js, /function legalVersionHref\(d\)\{return '\/legal\/'\+encodeURIComponent\(d\.slug\)\+'\?version='\+encodeURIComponent\(d\.versionId\)\}/);
  assert.match(js, /href="\$\{esc\(legalVersionHref\(d\)\)\}"/);
  assert.doesNotMatch(js.slice(js.indexOf("function renderLegalConsents"), js.indexOf("function acceptedLegalVersionIds")), /policies\.html/);
});
test("links stay unchecked and opening a link creates no acceptance", () => {
  const js = readFileSync("public/store.js", "utf8");
  const tpl = js.slice(js.indexOf("function renderLegalConsents"), js.indexOf("function acceptedLegalVersionIds"));
  assert.doesNotMatch(tpl, /\bchecked\b/);
  const route = readFileSync("app/legal/[slug]/route.ts", "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /\.(insert|update|delete)\(|export async function (POST|PUT|PATCH|DELETE)/);
});
test("rendered pages escape content and never show admin fields", () => {
  const html = renderLegalPage({ ...rows[0], title: "<b>x</b>", body: "<script>alert(1)</script>\n\nline1\nline2" }, "effective", false);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /published_by|publishedBy/);
  assert.equal(renderLegalBody("a\nb\n\nc"), "<p>a<br>b</p><p>c</p>");
});
test("public API/index endpoints select no draft/admin data and are read-only", () => {
  const db = readFileSync("lib/legal-db.ts", "utf8");
  assert.doesNotMatch(db, /publishedBy/);
  for (const f of ["app/api/legal/documents/route.ts", "app/api/legal/required/route.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /export async function (POST|PUT|PATCH|DELETE)|body/);
});
test("policies.html is an index backed by the API, with no duplicated document bodies", () => {
  const html = readFileSync("public/policies.html", "utf8");
  assert.match(html, /data-legal-index/);
  assert.match(html, /legal-index\.js/);
  assert.doesNotMatch(html, /Mesafeli Satış Sözleşmesi<\/h/);
});
