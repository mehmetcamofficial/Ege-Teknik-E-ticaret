import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import test from "node:test";
import { LEGAL_ARCHIVE_DECISION, recordActionLabel, recordActionsFor, recordActionUnavailableReason } from "../lib/admin-ui.ts";

const read = (f: string) => readFileSync(f, "utf8");
const ui = read("components/admin/record-actions.tsx");

// ---- the shared vocabulary ------------------------------------------------------------------------
test("every record action has the exact Turkish label the admin UI shows", () => {
  assert.deepEqual(recordActionLabel, { view: "Görüntüle", edit: "Düzenle", archive: "Arşivle", delete: "Sil", publish: "Yayınla" });
  assert.ok(Object.values(recordActionLabel).every((l) => l === l.trim() && l.length > 0));
});
test("the capability matrix mirrors the endpoints that actually exist, not CRUD symmetry", () => {
  // products: the route's DELETE is a SOFT archive; there is deliberately no hard delete.
  assert.deepEqual(recordActionsFor("product"), ["edit", "archive"]);
  // second-hand/blog: archive + hard delete both exist.
  assert.deepEqual(recordActionsFor("secondHand"), ["edit", "archive", "delete"]);
  assert.deepEqual(recordActionsFor("blogPost"), ["edit", "archive", "delete"]);
  // legal: a draft can be edited, published and deleted; a published version can only be viewed.
test("structural guard: no test body is left unclosed, and the wiring block stays top-level", () => {
  // Regression guard. The "RecordActions is keyboard-reachable..." test once lost its closing `});`,
  // so every declaration after it - including the `screens` table and its generated tests - was
  // lexically nested inside it. On Node 22 (pinned by .nvmrc, used by CI) the runner then tracked
  // those as subtests and cancelled them (`cancelledByParent`), failing the quality job; Node 24
  // tolerated it, so it passed locally. `CALL` is concatenated so this guard cannot match itself.
  const CALL = "test" + "(";
  const source = read("tests/admin-record-actions.test.ts");
  const lines = source.split("\n");
  assert.equal(lines.filter((l) => l.startsWith(CALL)).length, 19, "nineteen tests must be top-level");
  // One indented call site inside the loop generates one test per screens entry (four at run time).
  assert.equal(lines.filter((l) => l.startsWith("  " + CALL)).length, 1, "exactly one loop-generated test call site");
  assert.ok(lines.some((l) => l.startsWith("const screens")), "the screens table must be declared at top level");
  assert.ok(lines.some((l) => l.startsWith("for (const [file, keys] of screens)")), "the loop must be top-level");
});
  assert.deepEqual(recordActionsFor("legalVersion", { published: false }), ["edit", "publish", "delete"]);
  assert.deepEqual(recordActionsFor("legalVersion", { published: true }), ["view"]);
  // taxonomy: PATCH now also renames (name/slug), so "Düzenle" is a real operation.
  assert.deepEqual(recordActionsFor("taxonomy"), ["edit", "delete"]);
  // Financial, acceptance-bearing and audit records never get a destructive action.
  assert.deepEqual(recordActionsFor("order"), ["view"]);
  // Service requests and reviews have NO detail surface: no detail page, no single-record GET route.
  // Their list row already renders the whole record, so offering "view" would be a fake action.
  assert.deepEqual(recordActionsFor("serviceRequest"), [], "no detail capability exists to link to");
  assert.deepEqual(recordActionsFor("review"), []);
  assert.doesNotMatch(read("app/api/admin/service-requests/[id]/route.ts"), /export const GET/, "still PATCH-only");
  assert.ok(!existsSync("app/admin/(panel)/service-requests/[id]"), "no service-request detail page exists");
  assert.ok(!existsSync("app/admin/(panel)/reviews/[id]"), "no review detail page exists");
  // A user can be disabled but never deleted; inventory edits stock inline in the cell.
  assert.deepEqual(recordActionsFor("user"), ["edit", "archive"]);
  assert.deepEqual(recordActionsFor("inventory"), []);
  for (const list of [recordActionsFor("product"), recordActionsFor("secondHand"), recordActionsFor("taxonomy")]) {
    assert.ok(!list.includes("publish"), "publishing is a legal/blog concept, not a generic action");
  }
  for (const resource of ["order", "serviceRequest", "review", "user", "inventory"] as const) {
    assert.ok(!recordActionsFor(resource).includes("delete"), `${resource} must never offer a hard delete`);
  }
});
test("the legal archive decision is recorded as a decision, not left as a missing button", () => {
  // No Arşivle on a legal version: status is derived, there is no archived column, and a published row
  // can never change. Drafts are removed through the audited Sil path instead.
  for (const state of [{ published: false }, { published: true }]) {
    assert.ok(!recordActionsFor("legalVersion", state).includes("archive"));
  }
  assert.match(LEGAL_ARCHIVE_DECISION, /arşivleme uygulanmaz/);
  // The table the decision rests on must not have grown an archive column.
  const line = read("db/schema.ts").split("\n").find((l) => l.startsWith("export const legalDocumentVersions"))!;
  assert.doesNotMatch(line, /archived|withdrawn/i, "no pseudo-archive column may be added to legal_document_versions");
});
test("an unavailable action always carries a human-readable Turkish reason", () => {
  for (const reason of Object.values(recordActionUnavailableReason)) assert.ok(reason.length > 20 && /[.şğüöçıİ]$/u.test(reason));
});

// ---- the shared component -------------------------------------------------------------------------
test("RecordActions renders labels from the shared vocabulary and never hardcodes them", () => {
  assert.match(ui, /recordActionLabel\[action\.key\]/);
  for (const label of Object.values(recordActionLabel)) assert.doesNotMatch(ui, new RegExp(`>${label}<`), "labels must come from the map, not be retyped");
});
test("RecordActions confirms archive/delete, and a confirmation is never skipped for a destructive action", () => {
  assert.match(ui, /if \(action\.confirm\) return setPending\(action\);\s*\n\s*action\.onClick\?\.\(\);/, "a confirmed action must go through the dialog, an unconfirmed one must run directly");
  assert.match(ui, /variant=\{pending && isDestructive\(pending\.key\) \? "destructive" : "default"\}/);
});
test("an unavailable action stays visible and disabled with its reason, instead of vanishing", () => {
  assert.match(ui, /if \(action\.unavailableReason\)/);
  assert.match(ui, /disabled\s*\n?\s*title=\{action\.unavailableReason\}/);
  assert.match(ui, /\{action\.unavailableReason\}/);
});
test("RecordActions is keyboard-reachable, labelled per record, and wraps on narrow screens", () => {
  assert.match(ui, /role="group" aria-label=\{label\}/);
  assert.match(ui, /flex flex-wrap items-center gap-1\.5/);
  // A real <button>, not a clickable <div>/<span>: every action renders through <Button>.
  assert.match(ui, /<Button key=\{action\.key\} type="button"/);
  assert.doesNotMatch(ui, /onClick[\s\S]{0,60}<(div|span)/, "no clickable non-button element");
});

// ---- wiring: each audited screen renders the shared actions -------------------------------------
const screens: [string, string[]][] = [
  ["app/admin/legal-admin.tsx", ["view", "edit", "publish", "delete"]],
  ["app/admin/(panel)/products/products-view.tsx", ["edit", "archive"]],
  ["app/admin/(panel)/second-hand/second-hand-view.tsx", ["edit", "archive", "delete"]],
  ["app/admin/(panel)/blog/blog-view.tsx", ["edit", "archive", "delete"]],
];
for (const [file, keys] of screens) {
  test(`${file} renders the shared RecordActions with ${keys.join("/")}`, () => {
    const src = read(file);
    assert.match(src, /<RecordActions actions=/, "must use the shared component");
    assert.match(src, /import \{ RecordActions[^}]*\} from "@\/components\/admin\/record-actions"/);
    // The legal screen builds its set from a byKey map, the others from an inline literal array.
    for (const key of keys) assert.match(src, new RegExp(`key: "${key}"`), `missing ${key}`);
    // The action cell is reachable by assistive tech with a record-specific name.
    assert.match(src, /label=\{`\$\{[^}]+\}[^`]*işlemleri`\}/);
  });
}
test("no screen retypes a destructive action's label inline", () => {
  // Archive/Sil must come from RecordActions; the legal editor's own "Yayınla" is its publish control,
  // which is a form action rather than a list row action, so it is excluded on purpose.
  for (const [file] of screens) assert.doesNotMatch(read(file), />\s*(Arşivle|Sil|Görüntüle|Düzenle)\s*<\/Button>/, `${file} must use the shared labels`);
});

// ---- confirmations name the record, not just the action -----------------------------------------
test("every destructive confirmation names the record it will act on", () => {
  for (const file of ["app/admin/legal-admin.tsx", "app/admin/(panel)/products/products-view.tsx", "app/admin/(panel)/second-hand/second-hand-view.tsx", "app/admin/(panel)/blog/blog-view.tsx"]) {
    const src = read(file);
    for (const m of src.matchAll(/confirm: \{ title: "([^"]+)", confirmLabel: "([^"]+)",\s*\n\s*description: <span><strong>\{([^}]+)\}<\/strong>/g)) {
      assert.ok(m[1].length > 5, `${file}: confirmation title must be specific`);
      assert.match(m[2], /^Evet, /u, `${file}: confirm button must be an explicit "Evet, …"`);
      assert.ok(m[3].length > 2, `${file}: confirmation must interpolate the record's own field`);
    }
  }
});
test("every archive/delete action is confirmed, and the dialog keeps the project's cancel label", () => {
  for (const [file] of screens) {
    const src = read(file);
    const destructive = (src.match(/key: "(archive|delete)" as const/g) ?? []).length;
    const confirmed = (src.match(/key: "(archive|delete)" as const[\s\S]{0,400}?confirm: \{/g) ?? []).length;
    assert.equal(confirmed, destructive, `${file}: every archive/delete action must be confirmed`);
  }
  assert.match(ui, /cancelLabel=\{pending\?\.confirm\?\.cancelLabel \?\? "Vazgeç"\}/);
});

test("RecordActions performs no I/O of its own and never imports server-only code", () => {
  assert.doesNotMatch(ui, /fetch\(|useAdminJson|sendAdmin|@\/db|drizzle-orm|process\.env/);
});

// ---- screens that must NOT grow invented actions ---------------------------------------------------
test("read-only and workflow screens expose no destructive record action", () => {
  for (const file of [
    "app/admin/(panel)/orders/order-detail-view.tsx",
    "app/admin/(panel)/inventory/inventory-view.tsx",
    "app/admin/(panel)/finance/finance-view.tsx",
    "app/admin/analytics-admin.tsx",
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /RecordActions/, `${file} has no lifecycle endpoints, so it must not gain record actions`);
    assert.doesNotMatch(src, /sendAdmin\([^)]*"DELETE"/, `${file} must not call DELETE`);
  }
  // Orders and service requests may offer a view action, but never a destructive one.
  for (const file of ["app/admin/(panel)/orders/orders-view.tsx", "app/admin/(panel)/service-requests/service-requests-view.tsx"]) {
    assert.doesNotMatch(read(file), /key: "(archive|delete)"/, `${file} must not offer a destructive record action`);
  }
  // Nothing anywhere hard-deletes an order, a service request, a review or a user.
  for (const dir of ["orders", "service-requests", "reviews", "users"]) {
    for (const f of globSync(`app/admin/**/${dir}*.tsx`).concat(globSync(`app/admin/**/${dir}/**/*.tsx`))) {
      assert.doesNotMatch(read(f), /\?hard=1/, `${f} must not hard-delete`);
    }
  }
});
test("a hard-delete URL appears only where the route actually supports one", () => {
  for (const [file, url] of Object.entries({
    "app/admin/(panel)/second-hand/second-hand-view.tsx": "/api/admin/second-hand/${id}?hard=1",
    "app/admin/(panel)/blog/blog-view.tsx": "/api/admin/blog/${id}?hard=1",
  })) assert.ok(read(file).includes(url), file);
  // products only ever soft-archives, so a ?hard=1 must never appear there.
  assert.doesNotMatch(read("app/admin/(panel)/products/products-view.tsx"), /hard=1/);
});

// ---- legal save UX ---------------------------------------------------------------------------------
test("saving a legal draft confirms success, collapses to the list, and keeps the same document", () => {
  const save = read("app/admin/legal-admin.tsx").match(/async function saveDraft\(\)[\s\S]*?\n  \}/)![0];
  assert.match(save, /toast\.success\("Taslak başarıyla kaydedildi\."\)/);
  assert.match(save, /await loadVersions\(slug, showLegacy\)/, "the list must refresh so the saved row shows its actions");
  assert.match(save, /setSelected\(null\)/, "the editor collapses back to the list");
  assert.doesNotMatch(save, /setSlug\(/, "the document selection must not change on save");
  assert.match(save, /if \(!saved\) return;/, "a failed save must not clear the editor or claim success");
});
test("a failed legal save keeps the editor contents and shows the server's own error", () => {
  const src = read("app/admin/legal-admin.tsx");
  assert.match(src.match(/async function send\([\s\S]*?\n  \}/)![0], /if \(!r\.ok\) setNote\(json\.error \?\? "İşlem başarısız\."\)/);
  const save = src.match(/async function saveDraft\(\)[\s\S]*?\n  \}/)![0];
  assert.doesNotMatch(save, /setDraft\(/, "the draft buffer is never cleared by a save");
});
test("the legal screen derives its actions from the version status, and published versions stay read-only", () => {
  const src = read("app/admin/legal-admin.tsx");
  const fn = src.match(/function actionsFor[\s\S]*?\n  \}/)![0];
  assert.match(fn, /const draftVersion = v\.status === "draft";/);
  assert.match(fn, /unavailableReason: locked/, "edit/publish/delete must be disabled for published versions, not hidden");
  assert.match(src, /readOnly=\{!isDraft\}/);
  assert.match(src, /recordActionUnavailableReason\.legalPublishedImmutable/);
});
test("the legal confirmation dialogs follow the renamed target state, with no stale boolean left", () => {
  const src = read("app/admin/legal-admin.tsx");
  assert.doesNotMatch(src, /setDeleteOpen|setPublishOpen|deleteOpen=|publishOpen=/, "stale boolean dialog state must be gone");
  assert.match(src, /open=\{Boolean\(deleteTarget\)\}/);
  assert.match(src, /open=\{Boolean\(publishTarget\)\}/);
});


