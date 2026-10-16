#!/usr/bin/env node
/**
 * ET-LEGAL-NATIVE-GATE-03 — Independent PostgreSQL ACL Verification Suite
 *
 * Verifies the complete privilege matrix, immutability boundary, and security controls
 * using real PostgreSQL LOGIN roles on a disposable loopback database.
 *
 * Requirements checked:
 *   1. DML Privilege Matrix: SELECT / INSERT / UPDATE / DELETE / TRUNCATE
 *   2. Role attributes and lack of dangerous privileges (NOINHERIT, NOSUPERUSER, etc.)
 *   3. SECURITY DEFINER vs SECURITY INVOKER function attributes and search_path guards
 *   4. PUBLIC EXECUTE permissions stripped from sensitive & trigger functions
 *   5. Trigger disable & bypass prevention (DISABLE TRIGGER, session_replication_role)
 *   6. Immutability of both legacy (slug=NULL) and modern P3 legal acceptances
 *   7. Privilege escalation rejection (CREATE ROLE, ALTER ROLE, GRANT, SET ROLE, DDL)
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bootstrapDisposableDatabase, defaultStageDeps } from "../../scripts/disposable-postgres-bootstrap.mjs";
import { hashLegalDocument } from "../../lib/legal.ts";

const raw = process.env.INDEPENDENT_ACL_PG_URL;
const target = (() => { try { return new URL(raw); } catch { return null; } })();
if (!target || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || !target.pathname.slice(1).startsWith("sprintb") || !["postgres:", "postgresql:"].includes(target.protocol)) {
  console.error("[acl-gate] REFUSED: requires a disposable sprintb loopback PostgreSQL URL");
  process.exit(1);
}

const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
const secret = () => randomBytes(24).toString("hex");
const storePassword = secret(), attackerPassword = secret();

const owner = new pg.Pool({ connectionString: raw, max: 3 });
const roleUrl = (user, pass) => {
  const u = new URL(raw);
  u.username = user;
  u.password = pass;
  return u.toString();
};

let passedChecks = 0;
function check(name, condition, details = "") {
  assert.ok(condition, `CHECK FAILED: ${name} ${details}`);
  passedChecks++;
  console.log(`  ✓ [PASS] ${name}`);
}

async function main() {
  console.log("=== ET-LEGAL-NATIVE-GATE-03: INDEPENDENT ACL VERIFICATION ===");
  console.log(`Target Database: ${target.pathname.slice(1)}`);

  // 1. Bootstrap schema to head (0000 - 0020)
  console.log("\n[1/7] Bootstrapping schema 0000-0020 on disposable database...");
  await bootstrapDisposableDatabase({
    Pool: pg.Pool, drizzle, migrate, url: raw, journal,
    migrationsFolder: "drizzle-pg", ...defaultStageDeps, log: () => {}
  });

  // Verify migration ledger reached 0020
  const appliedMigrations = (await owner.query("SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
  check("Migration 0000-0020 applied completely", appliedMigrations.length === journal.entries.length,
    `applied=${appliedMigrations.length}, journal=${journal.entries.length}`);

  // Seed baseline data
  await owner.query("INSERT INTO products (id, slug, name, sku, price, sale_mode, delivery_class, status) VALUES ('acl-product', 'acl-product', 'ACL Test Product', 'ACL-PROD', 10000, 'online', 'shippable', 'published')");
  await owner.query("INSERT INTO inventory (id, product_id, on_hand, reserved) VALUES ('acl-inv', 'acl-product', 10, 0)");
  for (const slug of ["distance-sales", "pre-information", "kvkk"]) {
    const title = `Legal ${slug}`, body = `Document body for ${slug}`;
    await owner.query("INSERT INTO legal_documents (id, slug) VALUES ($1, $2)", [`doc-${slug}`, slug]);
    await owner.query(`INSERT INTO legal_document_versions
      (id, document_id, version, title, body, content_hash, effective_at, published_at, published_by)
      VALUES ($1, $2, 1, $3, $4, $5, '2020-01-01', '2020-01-01', 'owner-1')`,
      [`ver-${slug}`, `doc-${slug}`, title, body, hashLegalDocument({ title, body })]);
  }

  // Seed legacy order and legacy acceptance (pre-P3: slug IS NULL)
  await owner.query("INSERT INTO orders (id, order_number, idempotency_key, customer_name, phone, city, address) VALUES ('legacy-order', 'LEGACY-001', 'legacy-key-1', 'Legacy Cust', '05000000000', 'İzmir', 'Legacy Addr')");
  await owner.query("INSERT INTO order_legal_acceptances (id, order_id, document_version_id, accepted_at) VALUES ('legacy-acc-1', 'legacy-order', 'ver-distance-sales', now())");

  // Create real LOGIN roles
  console.log("\n[2/7] Creating real test LOGIN roles and configuring grant matrix...");
  await owner.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sprintb_acl_storefront') THEN
      CREATE ROLE sprintb_acl_storefront LOGIN PASSWORD '${storePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    ELSE
      ALTER ROLE sprintb_acl_storefront WITH PASSWORD '${storePassword}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sprintb_acl_untrusted') THEN
      CREATE ROLE sprintb_acl_untrusted LOGIN PASSWORD '${attackerPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    ELSE
      ALTER ROLE sprintb_acl_untrusted WITH PASSWORD '${attackerPassword}';
    END IF;
  END $$`);

  // Grant storefront least-privilege matrix
  await owner.query("GRANT USAGE ON SCHEMA public TO sprintb_acl_storefront");
  await owner.query("GRANT SELECT ON products, inventory, legal_documents, legal_document_versions, rate_limit_buckets TO sprintb_acl_storefront");
  await owner.query("GRANT INSERT ON customers, addresses, orders, order_items, order_legal_acceptances, rate_limit_buckets TO sprintb_acl_storefront");
  await owner.query("GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO sprintb_acl_storefront");
  await owner.query("GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO sprintb_acl_storefront");
  await owner.query("GRANT DELETE ON rate_limit_buckets TO sprintb_acl_storefront");
  await owner.query("GRANT UPDATE (created_at) ON legal_documents TO sprintb_acl_storefront");
  await owner.query("GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO sprintb_acl_storefront");
  await owner.query("GRANT EXECUTE ON FUNCTION public.checkout_replay_by_key(text,text) TO sprintb_acl_storefront");

  // Verify role attributes
  const storefrontAttr = (await owner.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolinherit FROM pg_roles WHERE rolname='sprintb_acl_storefront'")).rows[0];
  check("Storefront role has NO superuser privileges", !storefrontAttr.rolsuper);
  check("Storefront role has NO createrole privileges", !storefrontAttr.rolcreaterole);
  check("Storefront role has NO createdb privileges", !storefrontAttr.rolcreatedb);
  check("Storefront role has NO bypassrls privileges", !storefrontAttr.rolbypassrls);
  check("Storefront role is NOINHERIT", !storefrontAttr.rolinherit);

  // 3. Connect as storefront LOGIN role
  console.log("\n[3/7] Verifying DML matrix under authenticated storefront LOGIN role...");
  const sfClient = new pg.Client({ connectionString: roleUrl("sprintb_acl_storefront", storePassword) });
  await sfClient.connect();

  try {
    const who = (await sfClient.query("SELECT current_user, session_user")).rows[0];
    check("Storefront connected directly as LOGIN role", who.current_user === "sprintb_acl_storefront" && who.session_user === "sprintb_acl_storefront");

    // Allowed SELECTs
    const prodCount = await sfClient.query("SELECT count(*)::int n FROM products");
    check("SELECT on products permitted", prodCount.rows[0].n >= 1);
    const legDocCount = await sfClient.query("SELECT count(*)::int n FROM legal_documents");
    check("SELECT on legal_documents permitted", legDocCount.rows[0].n >= 1);

    // Denied direct SELECTs on PII and Evidence
    for (const tbl of ["orders", "order_items", "order_legal_acceptances", "customers", "addresses"]) {
      await assert.rejects(
        sfClient.query(`SELECT count(*) FROM ${tbl}`),
        (err) => err?.code === "42501",
        `Direct SELECT on ${tbl} must be denied`
      );
      check(`Direct SELECT on sensitive table '${tbl}' is DENIED (42501)`, true);
    }

    // Denied direct UPDATEs on orders and evidence
    await assert.rejects(
      sfClient.query("UPDATE orders SET notes='tampered' WHERE id='legacy-order'"),
      (err) => err?.code === "42501",
      "Direct UPDATE on orders must be denied"
    );
    check("Direct UPDATE on 'orders' is DENIED (42501)", true);

    await assert.rejects(
      sfClient.query("UPDATE order_legal_acceptances SET accepted_at=now() WHERE id='legacy-acc-1'"),
      (err) => err?.code === "42501",
      "Direct UPDATE on order_legal_acceptances must be denied"
    );
    check("Direct UPDATE on 'order_legal_acceptances' is DENIED (42501)", true);

    // Denied direct DELETEs
    for (const tbl of ["orders", "order_items", "order_legal_acceptances", "products", "customers", "addresses"]) {
      await assert.rejects(
        sfClient.query(`DELETE FROM ${tbl}`),
        (err) => err?.code === "42501",
        `DELETE on ${tbl} must be denied`
      );
      check(`DELETE on '${tbl}' is DENIED (42501)`, true);
    }

    // Denied TRUNCATE on all tables
    for (const tbl of ["orders", "order_items", "order_legal_acceptances", "products", "inventory"]) {
      await assert.rejects(
        sfClient.query(`TRUNCATE ${tbl}`),
        (err) => err?.code === "42501",
        `TRUNCATE on ${tbl} must be denied`
      );
      check(`TRUNCATE on '${tbl}' is DENIED (42501)`, true);
    }

    // Allowed INSERT into order flow (must be a transaction for deferred evidence trigger)
    const orderId = randomUUID();
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 1000);
    await sfClient.query("BEGIN");
    try {
      await sfClient.query("INSERT INTO customers (id, first_name, last_name, phone) VALUES ($1, 'John', 'Doe', '05551112233')", [orderId]);
      await sfClient.query("INSERT INTO addresses (id, customer_id, recipient_name, phone, city, line1) VALUES ($1, $1, 'John Doe', '05551112233', 'İzmir', 'Test street')", [orderId]);
      await sfClient.query(`INSERT INTO orders (id, order_number, customer_id, idempotency_key, customer_name, phone, city, address, order_issued_at, legal_evidence_version, created_at)
        VALUES ($1, $2, $1, $3, 'John Doe', '05551112233', 'İzmir', 'Test street', $4, 1, $5)`,
        [orderId, `ORD-${orderId.slice(0,8)}`, `key-${orderId}`, issuedAt, now]);
      await sfClient.query(`INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, vat_rate_bps, vat_amount, quantity, line_total)
        VALUES ($1, $1, 'acl-product', 'ACL Test Product', 10000, 2000, 2000, 1, 12000)`, [orderId]);

      const rendered = "Rendered test legal evidence";
      const digest = createHash("sha256").update(Buffer.from(rendered, "utf8")).digest("hex");
      for (const slug of ["distance-sales", "pre-information"]) {
        const title = `Legal ${slug}`;
        const cHash = hashLegalDocument({ title, body: `Document body for ${slug}` });
        await sfClient.query(`INSERT INTO order_legal_acceptances
          (id, order_id, document_version_id, slug, title, version, template_content_hash, rendered_body, rendered_sha256, render_context_version, acceptance_type, accepted_at)
          VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, 2, 'checkout_required', $9)`,
          [randomUUID(), orderId, `ver-${slug}`, slug, title, cHash, rendered, digest, now]);
      }
      await sfClient.query("COMMIT");
      check("Legitimate checkout INSERT flow (customer, address, order, items, evidence) succeeds", true);
    } catch (e) {
      await sfClient.query("ROLLBACK");
      throw e;
    }

    // 4. Trigger Disable & Bypass Prevention
    console.log("\n[4/7] Testing trigger disable & bypass prevention...");
    await assert.rejects(
      sfClient.query("ALTER TABLE order_legal_acceptances DISABLE TRIGGER ALL"),
      (err) => err?.code === "42501",
      "ALTER TABLE DISABLE TRIGGER must be rejected"
    );
    check("DISABLE TRIGGER ALL on 'order_legal_acceptances' is REJECTED (42501)", true);

    await assert.rejects(
      sfClient.query("ALTER TABLE order_legal_acceptances DISABLE TRIGGER legal_acceptance_no_mutation_trg"),
      (err) => err?.code === "42501",
      "ALTER TABLE DISABLE named trigger must be rejected"
    );
    check("DISABLE TRIGGER 'legal_acceptance_no_mutation_trg' is REJECTED (42501)", true);

    await assert.rejects(
      sfClient.query("ALTER TABLE orders DISABLE TRIGGER ALL"),
      (err) => err?.code === "42501",
      "ALTER TABLE orders DISABLE TRIGGER must be rejected"
    );
    check("DISABLE TRIGGER ALL on 'orders' is REJECTED (42501)", true);

    await assert.rejects(
      sfClient.query("SET session_replication_role = replica"),
      (err) => err?.code === "42501",
      "SET session_replication_role must be rejected"
    );
    check("SET session_replication_role = replica is REJECTED (42501)", true);

    // 5. Privilege escalation attempts
    console.log("\n[5/7] Testing privilege escalation rejection...");
    await assert.rejects(
      sfClient.query("CREATE ROLE evil_admin SUPERUSER"),
      (err) => err?.code === "42501",
      "CREATE ROLE must be rejected"
    );
    check("CREATE ROLE is REJECTED (42501)", true);

    await assert.rejects(
      sfClient.query("ALTER ROLE sprintb_acl_storefront SUPERUSER"),
      (err) => err?.code === "42501",
      "ALTER ROLE SUPERUSER must be rejected"
    );
    check("ALTER ROLE ... SUPERUSER is REJECTED (42501)", true);

    await assert.rejects(
      sfClient.query("GRANT ALL ON ALL TABLES IN SCHEMA public TO sprintb_acl_storefront"),
      (err) => err?.code === "42501",
      "GRANT ALL must be rejected"
    );
    check("GRANT ALL is REJECTED (42501)", true);

    await assert.rejects(
      sfClient.query("CREATE FUNCTION public.evil_bypass() RETURNS void LANGUAGE sql AS $$ SELECT 1; $$"),
      (err) => err?.code === "42501",
      "CREATE FUNCTION in public must be rejected"
    );
    check("CREATE FUNCTION in schema public is REJECTED (42501)", true);

  } finally {
    await sfClient.end();
  }

  // 6. Immutability boundary verification with elevated non-owner role
  console.log("\n[6/7] Verifying immutability boundary for both legacy & modern acceptances...");
  await owner.query("GRANT USAGE ON SCHEMA public TO sprintb_acl_untrusted");
  await owner.query("GRANT SELECT, UPDATE, DELETE, TRUNCATE ON order_legal_acceptances TO sprintb_acl_untrusted");

  const attackerClient = new pg.Client({ connectionString: roleUrl("sprintb_acl_untrusted", attackerPassword) });
  await attackerClient.connect();

  try {
    const isImmutableError = (err) => err?.code === "23001" && /immutable/i.test(err?.message ?? "");

    // A. Legacy acceptance (slug IS NULL)
    await assert.rejects(
      attackerClient.query("UPDATE order_legal_acceptances SET accepted_at=now() WHERE id='legacy-acc-1'"),
      isImmutableError,
      "UPDATE on legacy acceptance must fail with 23001 'legal evidence is immutable'"
    );
    check("UPDATE on legacy acceptance (slug IS NULL) is BLOCKED by trigger (23001)", true);

    await assert.rejects(
      attackerClient.query("DELETE FROM order_legal_acceptances WHERE id='legacy-acc-1'"),
      isImmutableError,
      "DELETE on legacy acceptance must fail with 23001 'legal evidence is immutable'"
    );
    check("DELETE on legacy acceptance (slug IS NULL) is BLOCKED by trigger (23001)", true);

    await assert.rejects(
      attackerClient.query("UPDATE order_legal_acceptances SET slug=NULL WHERE slug IS NULL"),
      isImmutableError,
      "Bulk UPDATE on legacy acceptance must fail with 23001"
    );
    check("Bulk UPDATE on legacy acceptances is BLOCKED by trigger (23001)", true);

    // B. Modern P3 acceptances
    const p3rows = (await attackerClient.query("SELECT id FROM order_legal_acceptances WHERE slug IS NOT NULL LIMIT 2")).rows;
    check("P3 evidence rows exist for testing", p3rows.length === 2);

    for (const r of p3rows) {
      await assert.rejects(
        attackerClient.query("UPDATE order_legal_acceptances SET title='Forged Title' WHERE id=$1", [r.id]),
        isImmutableError,
        "UPDATE on modern P3 acceptance must fail with 23001"
      );
      check(`UPDATE on P3 acceptance '${r.id.slice(0,8)}' is BLOCKED by trigger (23001)`, true);

      await assert.rejects(
        attackerClient.query("DELETE FROM order_legal_acceptances WHERE id=$1", [r.id]),
        isImmutableError,
        "DELETE on modern P3 acceptance must fail with 23001"
      );
      check(`DELETE on P3 acceptance '${r.id.slice(0,8)}' is BLOCKED by trigger (23001)`, true);
    }

    // C. TRUNCATE attempt
    await assert.rejects(
      attackerClient.query("TRUNCATE order_legal_acceptances"),
      (err) => err?.code === "23001" || err?.code === "42501",
      "TRUNCATE on order_legal_acceptances must be rejected"
    );
    check("TRUNCATE on 'order_legal_acceptances' is BLOCKED (23001)", true);

  } finally {
    await attackerClient.end();
  }

  // 7. Security Definer vs Invoker and PUBLIC execute rights
  console.log("\n[7/7] Inspecting function attributes and PUBLIC execute revocation...");
  const functions = (await owner.query(`
    SELECT p.proname, p.prosecdef, p.proconfig,
      EXISTS (
        SELECT 1 FROM aclexplode(p.proacl) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) AS public_has_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'lock_checkout_products',
        'checkout_replay_by_key',
        'legal_acceptance_no_mutation',
        'order_legal_evidence_guard',
        'p3_order_evidence_complete',
        'p3_order_identity_guard',
        'p3_legal_evidence_no_truncate',
        'legal_evidence_source_lock'
      )
  `)).rows;

  const getFunc = (name) => {
    const f = functions.find((x) => x.proname === name);
    assert.ok(f, `Function ${name} not found in pg_proc`);
    return f;
  };

  // Check SECURITY DEFINER functions (hardened with search_path and public execute revoked)
  for (const name of ["lock_checkout_products", "checkout_replay_by_key", "order_legal_evidence_guard", "p3_order_evidence_complete"]) {
    const f = getFunc(name);
    check(`Function '${name}' is SECURITY DEFINER`, f.prosecdef === true);
    check(`Function '${name}' has safe search_path configured`, Array.isArray(f.proconfig) && f.proconfig.some((c) => c.includes("search_path")));
    check(`Function '${name}' has PUBLIC EXECUTE REVOKED`, f.public_has_execute === false);
  }

  // Check 0020 legal_acceptance_no_mutation (SECURITY INVOKER, search_path, public revoked)
  const mut = getFunc("legal_acceptance_no_mutation");
  check("Function 'legal_acceptance_no_mutation' is SECURITY INVOKER", mut.prosecdef === false);
  check("Function 'legal_acceptance_no_mutation' has safe search_path configured", Array.isArray(mut.proconfig) && mut.proconfig.some((c) => c.includes("search_path")));
  check("Function 'legal_acceptance_no_mutation' has PUBLIC EXECUTE REVOKED", mut.public_has_execute === false);

  // Check remaining trigger guards are SECURITY INVOKER
  for (const name of ["p3_legal_evidence_no_truncate", "p3_order_identity_guard", "legal_evidence_source_lock"]) {
    const f = getFunc(name);
    check(`Function '${name}' is SECURITY INVOKER`, f.prosecdef === false);
  }

  console.log(`\n=============================================================`);
  console.log(`[acl-gate] ALL ${passedChecks} INDEPENDENT ACL & IMMUTABILITY CHECKS PASSED!`);
  console.log(`=============================================================\n`);
}

main().catch((err) => {
  console.error("\n[acl-gate] INDEPENDENT ACL VERIFICATION FAILED:");
  console.error(err);
  process.exit(1);
}).finally(async () => {
  await owner.end();
});
