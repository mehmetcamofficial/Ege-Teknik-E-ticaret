import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runAuditedMutation, type AuditEntry, type AuditedDeps } from "../lib/admin-mutation.ts";

type Db = { products: Map<string, string>; audit: AuditEntry[] };
const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({ actorUserId: "admin-1", actorEmail: "a@example.test", action: "update", entityType: "product", entityId: "p1", payload: {}, ...over });

/** A transactional fake: writes are staged and only committed if the whole callback resolves (snapshot rollback otherwise). */
function fake(options: { failAudit?: boolean } = {}) {
  const db: Db = { products: new Map([["p1", "old"]]), audit: [] };
  const deps: AuditedDeps<Db> = {
    transaction: async (work) => {
      const staged: Db = { products: new Map(db.products), audit: [...db.audit] };
      const result = await work(staged);
      db.products = staged.products; db.audit = staged.audit; // commit
      return result;
    },
    insertAudit: async (tx, e) => { if (options.failAudit) throw new Error("audit insert failed"); tx.audit.push(e); },
  };
  return { db, deps };
}

test("mutation and audit both commit together", async () => {
  const { db, deps } = fake();
  await runAuditedMutation(deps, entry(), async (tx) => { tx.products.set("p1", "new"); });
  assert.equal(db.products.get("p1"), "new");
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0].action, "update");
});

test("an audit insert failure rolls the business mutation back", async () => {
  const { db, deps } = fake({ failAudit: true });
  await assert.rejects(runAuditedMutation(deps, entry(), async (tx) => { tx.products.set("p1", "new"); }), /audit insert failed/);
  assert.equal(db.products.get("p1"), "old", "the change must not survive without its audit");
  assert.equal(db.audit.length, 0);
});

test("a failed or refused mutation leaves no audit row", async () => {
  const { db, deps } = fake();
  await assert.rejects(runAuditedMutation(deps, entry(), async () => { throw new Error("linked products exist"); }), /linked products/);
  assert.equal(db.audit.length, 0);
  assert.equal(db.products.get("p1"), "old");
});

test("a retry after a failed attempt records exactly one audit row (no duplicate for the failed try)", async () => {
  const { db, deps } = fake();
  let attempts = 0;
  const run = () => runAuditedMutation(deps, entry(), async (tx) => { attempts += 1; if (attempts === 1) throw new Error("transient"); tx.products.set("p1", "new"); });
  await assert.rejects(run());
  await run();
  assert.equal(db.audit.length, 1);
  assert.equal(db.products.get("p1"), "new");
});

test("the audit entry can be derived from the mutation result", async () => {
  const { db, deps } = fake();
  await runAuditedMutation(deps, (result: { id: string }) => entry({ entityId: result.id, action: "create" }), async (tx) => { tx.products.set("p2", "x"); return { id: "p2" }; });
  assert.equal(db.audit[0].entityId, "p2");
  assert.equal(db.audit[0].action, "create");
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const AUDITED = [
  "app/api/admin/products/route.ts", "app/api/admin/products/[id]/route.ts",
  "app/api/admin/second-hand/route.ts", "app/api/admin/second-hand/[id]/route.ts",
  "app/api/admin/taxonomy/route.ts", "app/api/admin/blog/route.ts", "app/api/admin/blog/[id]/route.ts",
  "app/api/admin/service-requests/[id]/route.ts",
];

test("every governed admin mutation route writes its audit through auditedMutation, never as a separate statement", () => {
  for (const path of AUDITED) {
    const src = read(path);
    assert.match(src, /auditedMutation\(/, path);
    assert.doesNotMatch(src, /insert\(auditLogs\)/, `${path} still writes audit outside the mutation transaction`);
  }
});

test("order transitions already carry their audit inside the transition transaction", () => {
  assert.match(read("lib/order-transition-db.ts"), /insertAudit:\(/);
  assert.match(read("lib/order-transition.ts"), /await tx\.insertAudit\(/);
});

test("permissions are unchanged: each audited route still authorizes before mutating", () => {
  for (const path of AUDITED) assert.match(read(path), /getAdminUser\("(catalog|content|service):write"\)/, path);
});

test("the helper is the only place that binds the audit insert to the mutation transaction", () => {
  const bound = read("lib/admin-audited-db.ts");
  assert.match(bound, /db\.transaction\(work\)/);
  assert.match(bound, /insertAudit: async \(tx, e\) =>/);
});

// Intentionally NOT converted (documented in the sprint report): the audit belongs to an external-side-effect flow.
test("known deferrals keep their own audit paths: product image upload (Blob + audit tolerance) and catalog import", () => {
  assert.match(read("app/api/admin/products/[id]/image/route.ts"), /insertAuditLog/);
  assert.match(read("app/api/admin/catalog/import/route.ts"), /auditLogs/);
});
