import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { recordActionsFor } from "../lib/admin-ui.ts";

/**
 * These screens are EMPTY on Preview, so the reported capability could not be confirmed by hand.
 * These tests close that gap WITHOUT creating any data: they assert the RENDER CONDITIONS and the
 * ENDPOINT BINDING, so the capability claim matches what the code would actually render the moment a
 * real row exists. No fixture or test rows are ever written.
 */
const read = (f: string) => readFileSync(f, "utf8");

const SCREENS = {
  secondHand: "app/admin/(panel)/second-hand/second-hand-view.tsx",
  blogPost: "app/admin/(panel)/blog/blog-view.tsx",
  serviceRequests: "app/admin/(panel)/service-requests/service-requests-view.tsx",
  orders: "app/admin/(panel)/orders/orders-view.tsx",
} as const;

test("every test in this file is top-level and self-contained (guards the nested-test CI regression)", () => {
  // Regression guard: three tests were once nested inside the "Second-hand" test body. On Node 22
  // (pinned by .nvmrc, used by CI) the runner correctly tracked them as subtests and cancelled them
  // because the synchronous parent finished first -> `cancelledByParent` and a red quality job. Node 24
  // tolerated it, so it passed locally and failed only in CI. Each test must therefore be its own
  // top-level call, and no test body may declare another test.
  const source = read("tests/admin-record-actions-render.test.ts");
  // Built by concatenation so this guard never matches its own source text.
  const CALL = "test" + "(";
  const lines = source.split("\n");
  const topLevel = lines.filter((line) => line.startsWith(CALL)).length;
  assert.equal(topLevel, 7, "all seven tests must be declared at the top level");
  const nested = lines.filter((line) => !line.startsWith(CALL) && line.includes(CALL));
  assert.deepEqual(nested, [], "no test call may be declared inside another test body");
  // No describe/it nesting either, so nothing can inherit a parent lifecycle.
  assert.doesNotMatch(source, /\bdescribe\(|\bit\(/);
});
test("the empty screens render their actions ONLY from real API rows", () => {
  // second-hand and blog render the table only when the list is non-empty.
  const sh = read(SCREENS.secondHand);
  assert.match(sh, /data && !data\.secondHand\.length \?[\s\S]{0,400}EmptyState title="Henüz ikinci el ilanı yok"/);
  assert.match(sh, /data\?\.secondHand\.map\(/);
  const blog = read(SCREENS.blogPost);
  assert.match(blog, /data && !data\.rows\.length \?[\s\S]{0,400}EmptyState title="Henüz blog yazısı yok"/);
  assert.match(blog, /data\?\.rows\.map\(/);
  // The empty branch must not leak action buttons: nothing to act on, so nothing may be rendered.
  for (const src of [sh, blog]) {
    const at = src.indexOf("EmptyState title=");
    assert.doesNotMatch(src.slice(at - 300, at + 400), /RecordActions/, "the empty state must not render record actions");
  }
});

test("Second-hand actions bind to the exact endpoints the route implements", () => {
  const src = read(SCREENS.secondHand);
  const actions = src.match(/function actionsFor[\s\S]*?\n  \}/)![0];
  // archive => DELETE WITHOUT ?hard (soft: sold + stock 0); delete => DELETE WITH ?hard=1.
  assert.match(actions, /key: "archive" as const[\s\S]*?onClick: \(\) => void archive/);
  assert.match(actions, /key: "delete" as const[\s\S]*?onClick: \(\) => void destroy/);
  assert.match(src.match(/async function archive[\s\S]*?\n  \}/)![0], /sendAdmin\(`\/api\/admin\/second-hand\/\$\{id\}`, "DELETE"\)/);
  assert.match(src.match(/async function destroy[\s\S]*?\n  \}/)![0], /sendAdmin\(`\/api\/admin\/second-hand\/\$\{id\}\?hard=1`, "DELETE"\)/);
  // edit is a navigation link, never a mutation.
  assert.match(actions, /key: "edit" as const, href: `\/admin\/second-hand\/\$\{x\.id\}`/);
  assert.deepEqual(recordActionsFor("secondHand"), ["edit", "archive", "delete"]);
  // The hard delete is refused with 409 when a reservation exists; the view surfaces that exact reason,
  // so an operator is told to archive instead of being given a generic failure.
  assert.match(src, /recordActionUnavailableReason\.secondHandHasReservations/);
  assert.match(
    read("app/api/admin/second-hand/[id]/route.ts"),
    /secondHandReservations\.productId[\s\S]*status:\s*409/,
    "the route must refuse a hard delete while a reservation exists"
  );
});
test("Reviews expose exactly the moderation transitions their state machine allows, and nothing else", () => {
  const src = read("app/admin/reviews-admin.tsx");
  const map = src.match(/const actionsFor[\s\S]*?\n\};/)![0];
  // pending -> approve|reject, approved -> reject only, rejected -> approve only.
  assert.match(map, /pending: \[\{ to: "approved", label: "Onayla" \}, \{ to: "rejected", label: "Reddet" \}\]/);
  assert.match(map, /approved: \[\{ to: "rejected", label: "Yayından kaldır \(reddet\)" \}\]/);
  assert.match(map, /rejected: \[\{ to: "approved", label: "Kararı geri al \(onayla\)" \}\]/);
  // Every decision goes through the moderation PATCH, and there is no DELETE anywhere on the screen.
  assert.match(src.match(/async function decide[\s\S]*?\n  \}/)![0], /method: "PATCH"/);
  assert.doesNotMatch(src, /"DELETE"/, "reviews have no delete endpoint");
  assert.doesNotMatch(src, /RecordActions/, "reviews use their own moderation buttons, not the generic set");
  assert.deepEqual(recordActionsFor("review"), []);
});

test("Service requests expose no record actions, because no detail capability exists to link to", () => {
  const src = read(SCREENS.serviceRequests);
  // This is the manual-Preview finding: the row shows a status select and nothing else, correctly.
  assert.doesNotMatch(src, /RecordActions/, "there is no service-request detail page or single-record GET route");
  assert.doesNotMatch(read("app/api/admin/service-requests/[id]/route.ts"), /export const GET/);
  assert.ok(!existsSync("app/admin/(panel)/service-requests/[id]"), "no detail page exists to link to");
  assert.deepEqual(recordActionsFor("serviceRequest"), []);
  // Status lifecycle and audit behaviour untouched: only PATCH, still audited server-side.
  assert.match(src.match(/async function applyStatus[\s\S]*?\n  \}/)![0], /sendAdmin\(`\/api\/admin\/service-requests\/\$\{id\}`, "PATCH", \{ status \}\)/);
  assert.doesNotMatch(src, /"DELETE"/, "no delete or archive was added for service requests");
  assert.match(read("app/api/admin/service-requests/[id]/route.ts"), /auditedMutation\(user, \{ action: "status"/, "audit/history behaviour preserved");
});

test("Orders offer only Görüntüle, pointing at the one detail route that genuinely exists", () => {
  const src = read(SCREENS.orders);
  assert.ok(existsSync("app/admin/(panel)/orders/[id]"), "an order detail page does exist, so View is real");
  assert.match(src, /key: "view", href: `\/admin\/orders\/\$\{o\.id\}`/);
  assert.doesNotMatch(src, /key: "(archive|delete)"/);
  assert.deepEqual(recordActionsFor("order"), ["view"]);
});

test("Blog actions bind to the exact endpoints the route implements", () => {
  const src = read(SCREENS.blogPost);
  const actions = src.match(/function actionsFor[\s\S]*?\n  \}/)![0];
  assert.match(src.match(/async function archive[\s\S]*?\n  \}/)![0], /sendAdmin\(`\/api\/admin\/blog\/\$\{id\}`, "DELETE"\)/);
  assert.match(src.match(/async function destroy[\s\S]*?\n  \}/)![0], /sendAdmin\(`\/api\/admin\/blog\/\$\{id\}\?hard=1`, "DELETE"\)/);
  assert.match(actions, /key: "edit" as const, href: `\/admin\/blog\/\$\{p\.id\}`/);
  // The archive confirmation states the post's real status, not a fixed string.
  assert.match(actions, /p\.status === "published" \? "Yayından kaldırılıp taslağa alınacak" : "Taslak olarak kalacak"/);
  assert.deepEqual(recordActionsFor("blogPost"), ["edit", "archive", "delete"]);
});