import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STOREFRONT_GRANTS_FILE, storefrontGrantStatements } from "../scripts/checkout-storefront-grants.mjs";

const source = readFileSync(STOREFRONT_GRANTS_FILE, "utf8");
const grants: (role: string) => string[] = storefrontGrantStatements;

// The reviewed minimum, written out a SECOND time on purpose: the SQL file and this list must change together or this test fails.
const EXPECTED = [
  'GRANT USAGE ON SCHEMA public TO "r"',
  'GRANT SELECT ON products, inventory, legal_documents, legal_document_versions, rate_limit_buckets TO "r"',
  'GRANT INSERT ON customers, addresses, orders, order_items, order_legal_acceptances, rate_limit_buckets TO "r"',
  'GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO "r"',
  'GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO "r"',
  'GRANT DELETE ON rate_limit_buckets TO "r"',
  'GRANT UPDATE (created_at) ON legal_documents TO "r"',
  'GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO "r"',
  'GRANT EXECUTE ON FUNCTION public.checkout_replay_by_key(text,text) TO "r"',
];

test("the canonical storefront grants are exactly the reviewed minimum", () => {
  assert.deepEqual(grants("r"), EXPECTED);
});

test("no statement is broader than the minimum: no PUBLIC, no ALL, no GRANT OPTION, no sensitive table read, no product/order write, no sequence or schema CREATE", () => {
  for (const statement of grants("r")) {
    assert.match(statement, /^GRANT /);
    assert.doesNotMatch(statement, /\bALL\b|ALL TABLES|ALL FUNCTIONS|WITH GRANT OPTION|\bTRUNCATE\b|\bREFERENCES\b|\bTRIGGER\b|\bSEQUENCE|\bCREATE\b|\bTEMP/i, statement);
    assert.ok(statement.endsWith(' TO "r"'), "exactly one grantee, the storefront role");
  }
  const text = grants("r").join("\n");
  assert.doesNotMatch(text, /SELECT ON[^\n]*\b(orders|customers|addresses|order_items|order_legal_acceptances|admin_users|audit_logs)\b/, "the replay reads orders only through checkout_replay_by_key");
  assert.doesNotMatch(text, /UPDATE[^\n]*ON (products|orders)\b/);
  assert.doesNotMatch(text, /DELETE ON (?!rate_limit_buckets)/);
  assert.doesNotMatch(text, /notification_outbox/, "the outbox INSERT is a separate, optional grant");
});

test("the role name is quoted and validated; a hostile name never reaches a statement", () => {
  assert.deepEqual(grants("Store_Role$1")[0], 'GRANT USAGE ON SCHEMA public TO "Store_Role$1"');
  for (const bad of ['x"; DROP ROLE y; --', "a b", "", "1abc", "a".repeat(64), "pub\u0000lic", "r\"", undefined as unknown as string]) assert.throws(() => grants(bad), /invalid storefront role name/);
});

test("the helper refuses a file that has drifted from the one-grant-per-statement shape", () => {
  const withComment = '-- c\nGRANT USAGE ON SCHEMA public TO :"storefront_role";\n';
  assert.deepEqual(storefrontGrantStatements("r", withComment), ['GRANT USAGE ON SCHEMA public TO "r"']);
  for (const drifted of ["", "-- only comments\n", 'REVOKE ALL ON x FROM :"storefront_role";\n', 'GRANT SELECT ON a TO PUBLIC;\n', 'GRANT SELECT ON a TO :"storefront_role"; DROP TABLE a;\n'])
    assert.throws(() => storefrontGrantStatements("r", drifted), /storefront grants/);
});

test("the operator file documents the psql usage and what is deliberately not granted, and states it is not applied", () => {
  assert.match(source, /NOT APPLIED ANYWHERE/);
  assert.match(source, /psql -v ON_ERROR_STOP=1 -v storefront_role=/);
  assert.match(source, /Deliberately NOT granted/);
  assert.match(source, /migrations 0017, 0018 and 0019/);
});
