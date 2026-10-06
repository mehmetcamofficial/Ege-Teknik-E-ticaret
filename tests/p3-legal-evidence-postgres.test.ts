import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { register } from "node:module";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { orders, orderLegalAcceptances } from "../db/schema.ts";
import { bootstrapDisposableDatabase, defaultStageDeps } from "../scripts/disposable-postgres-bootstrap.mjs";
import { hashLegalDocument } from "../lib/legal.ts";
import { digestRenderedLegalBody, signLegalPreviewToken, verifyLegalPreviewToken } from "../lib/legal-preview-token.ts";
import { DEFAULT_LEGAL_TEMPLATE_BODY } from "./support/order-route-fakes.ts";
import { TEST_LEGAL_PREVIEW_SECRET } from "./support/legal-preview-harness.ts";

const url = process.env.P3B_PG_URL;
const skip = !url;
let pool: pg.Pool;
let POST: (r: Request) => Promise<Response>;
let previewPOST: (r: Request) => Promise<Response>;
const slugs = ["distance-sales", "pre-information"];
const title = (slug: string) => `DISPOSABLE TEST ONLY ${slug}`;
const body = DEFAULT_LEGAL_TEMPLATE_BODY;
const contentHash = (slug: string) => hashLegalDocument({ title: title(slug), body });
const payload = () => ({ customerName: "Sentetik Müşteri", phone: "05550000000", email: "synthetic@example.test", city: "İzmir", district: "Aliağa", address: "<b>Test adresi</b> Mahallesi 1 Sokak", paymentProvider: "discovery", expectedTotal: 12000, items: [{ productId: "p3b-product", quantity: 1 }], legalAcceptances: slugs.map((slug) => `p3b-${slug}`) });
const request = (data: unknown, key: string = randomUUID()) => new Request("https://shop.test/api/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(data) });
async function preview() { const response = await previewPOST(request(payload())); assert.equal(response.status, 200); return await response.json() as { legalPreviewToken: string; orderIssuedAt: number; orderNumber: string; documents: { slug: string; documentVersionId: string; renderedBody: string }[] }; }

before(async () => {
  if (!url) return;
  const target = new URL(url);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname.startsWith("/sprintb"), "disposable loopback only");
  register("./support/p3-order-postgres-hooks.mjs", import.meta.url);
  const infra = await import("./support/p3-order-postgres.ts"); pool = infra.pool;
  POST = (await import("../app/api/orders/route.ts")).POST;
  previewPOST = (await import("../app/api/checkout/legal-preview/route.ts")).POST;
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  const old = mkdtempSync(join(tmpdir(), "p3b-old-migrations-")); mkdirSync(join(old, "meta"));
  writeFileSync(join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 15) }));
  for (const entry of journal.entries.slice(0, 15)) cpSync(`drizzle-pg/${entry.tag}.sql`, join(old, `${entry.tag}.sql`));
  try { await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url, journal, migrationsFolder: old, ...defaultStageDeps }); }
  finally { rmSync(old, { recursive: true, force: true }); }
  for (const slug of [...slugs, "kvkk"]) {
    await pool.query("insert into legal_documents(id,slug) values($1,$2)", [`doc-${slug}`, slug]);
    await pool.query("insert into legal_document_versions(id,document_id,version,title,body,content_hash,effective_at,published_at,published_by) values($1,$2,1,$3,$4,$5,'2001-01-01','2001-01-01','disposable-test')", [`p3b-${slug}`, `doc-${slug}`, title(slug), body, contentHash(slug)]);
  }
  await pool.query("insert into orders(id,order_number,idempotency_key,customer_name,phone,city,address) values('legacy-order','LEGACY-P3B','legacy-key','Test','05550000000','İzmir','Legacy address')");
  await pool.query("insert into order_legal_acceptances(id,order_id,document_version_id,accepted_at) values('legacy-acceptance','legacy-order','p3b-distance-sales',now())");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-pg" });
  await pool.query("insert into products(id,slug,name,price,vat_rate_bps,sale_mode,status,delivery_class) values('p3b-product','p3b-product','Sentetik <b>Klima</b>',12000,2000,'online','published','installed_delivery')");
  await pool.query("insert into inventory(id,product_id,on_hand) values('p3b-stock','p3b-product',1000)");
});
after(async () => { if (pool) await pool.end(); });

const acceptedAt = new Date("2026-10-06T00:00:00.000Z");
async function insertOrder(client: pg.PoolClient, id: string) {
  await client.query("insert into orders(id,order_number,idempotency_key,customer_name,phone,city,address,order_issued_at,legal_evidence_version,created_at) values($1,$1,$1,'Test','05550000000','İzmir','Test address',$2,1,$3)", [id, new Date(acceptedAt.getTime() - 1000), acceptedAt]);
}
async function insertEvidence(client: pg.PoolClient, id: string, slug: string, over: Record<string, unknown> = {}) {
  const row = { id: randomUUID(), order_id: id, document_version_id: `p3b-${slug}`, accepted_at: acceptedAt, slug, title: title(slug), version: 1, template_content_hash: contentHash(slug), rendered_body: "Türkçe <script>text</script>", rendered_sha256: digestRenderedLegalBody("Türkçe <script>text</script>"), render_context_version: 2, acceptance_type: "checkout_required", ...over };
  const keys = Object.keys(row); await client.query(`insert into order_legal_acceptances(${keys.join(",")}) values(${keys.map((_, i) => `$${i+1}`).join(",")})`, Object.values(row));
}
async function transaction(work: (client: pg.PoolClient, id: string) => Promise<void>) {
  const client = await pool.connect(); const id = randomUUID();
  try { await client.query("begin"); await insertOrder(client, id); await work(client, id); await client.query("commit"); return id; }
  catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

test("P3 migration preserves pre-existing legacy order/acceptance without backfill", { skip }, async () => {
  const order = (await pool.query("select * from orders where id='legacy-order'")).rows[0]; assert.equal(order.order_issued_at, null); assert.equal(order.legal_evidence_version, null);
  const row = (await pool.query("select * from order_legal_acceptances where id='legacy-acceptance'")).rows[0];
  for (const field of ["slug","title","version","template_content_hash","rendered_body","rendered_sha256","render_context_version","acceptance_type"]) assert.equal(row[field], null);
});
test("P3 schema/migration additions, nullability, checks and indexes match Drizzle", { skip }, async () => {
  for (const table of [orders, orderLegalAcceptances]) {
    const config = getTableConfig(table);
    const cols = (await pool.query("select column_name, is_nullable, data_type from information_schema.columns where table_schema='public' and table_name=$1", [config.name])).rows;
    for (const col of config.columns) { const actual = cols.find((c) => c.column_name === col.name); assert.ok(actual); assert.equal(actual.is_nullable, col.notNull ? "NO" : "YES"); assert.equal(actual.data_type, col.getSQLType()); }
    const checks = (await pool.query("select conname from pg_constraint where conrelid=$1::regclass and contype='c'", [config.name])).rows.map((r) => r.conname);
    for (const ck of config.checks) assert.ok(checks.includes(ck.name));
    const indexes = (await pool.query("select indexname from pg_indexes where schemaname='public' and tablename=$1", [config.name])).rows.map((r) => r.indexname);
    for (const index of config.indexes) assert.ok(indexes.includes(index.config.name));
  }
});
test("P3 valid two-document evidence commits and lifecycle fields remain mutable", { skip }, async () => {
  const id = await transaction(async (c, id) => { for (const slug of slugs) await insertEvidence(c, id, slug); });
  await pool.query("update orders set status='paid',payment_status='paid',notes='Operational note' where id=$1", [id]);
  assert.equal((await pool.query("select count(*)::int as n from order_legal_acceptances where order_id=$1", [id])).rows[0].n, 2);
});
test("P3 incomplete/one-document transactions cannot commit and leave no order", { skip }, async () => {
  for (const count of [0,1]) await assert.rejects(transaction(async (c, id) => { if (count) await insertEvidence(c, id, slugs[0]); }), /exactly two/);
});
test("P3 duplicate slug, extra slug, half cohort, malformed hash and wrong context fail closed", { skip }, async () => {
  await assert.rejects(transaction(async (c,id) => { await insertEvidence(c,id,slugs[0]); await insertEvidence(c,id,slugs[0]); }));
  for (const over of [{slug:"cookies"}, {title:null}, {rendered_sha256:"ABC"}, {template_content_hash:"bad"}, {render_context_version:1}, {version:0}, {acceptance_type:"optional"}]) await assert.rejects(transaction((c,id) => insertEvidence(c,id,slugs[0],over)));
});
test("P3 source provenance and body/hash correspondence are enforced by DB", { skip }, async () => {
  for (const over of [{title:"forged"}, {version:2}, {template_content_hash:"a".repeat(64)}, {document_version_id:"p3b-pre-information"}, {rendered_sha256:"0".repeat(64)}]) await assert.rejects(transaction((c,id) => insertEvidence(c,id,slugs[0],over)));
});
test("P3 evidence UPDATE/DELETE/TRUNCATE and parent identity mutations are rejected", { skip }, async () => {
  const id = await transaction(async (c,id) => { for (const slug of slugs) await insertEvidence(c,id,slug); });
  await assert.rejects(pool.query("update order_legal_acceptances set rendered_body=rendered_body where order_id=$1",[id]), /immutable/);
  await assert.rejects(pool.query("delete from order_legal_acceptances where order_id=$1",[id]), /immutable/);
  await assert.rejects(pool.query("truncate order_legal_acceptances"), /truncated/);
  for (const assignment of ["order_number='changed'", "order_issued_at=now()", "legal_evidence_version=null", "idempotency_key='changed'", "request_fingerprint='changed'", "created_at=now()", "id='changed'"]) await assert.rejects(pool.query(`update orders set ${assignment} where id=$1`,[id]), /immutable/);
});
test("P3 real preview/order route persists exact text and replays expired token without new evidence", { skip }, async () => {
  const p = await preview(); const key = randomUUID(); const input = { ...payload(), legalPreviewToken: p.legalPreviewToken };
  const r = await POST(request(input,key)); assert.equal(r.status,201,JSON.stringify(await r.clone().json()));
  const order = (await pool.query("select * from orders where idempotency_key=$1",[key])).rows[0]; const rows = (await pool.query("select * from order_legal_acceptances where order_id=$1 order by slug",[order.id])).rows;
  assert.equal(order.order_issued_at.getTime(),p.orderIssuedAt); assert.equal(order.legal_evidence_version,1); assert.equal(rows.length,2);
  for (const row of rows) { const shown = p.documents.find((d) => d.slug===row.slug)!; assert.equal(row.rendered_body,shown.renderedBody); assert.equal(row.rendered_sha256,digestRenderedLegalBody(shown.renderedBody)); assert.equal(row.document_version_id,shown.documentVersionId); assert.equal(row.render_context_version,2); assert.equal(row.accepted_at.getTime(),order.created_at.getTime()); }
  const verified = verifyLegalPreviewToken(p.legalPreviewToken,TEST_LEGAL_PREVIEW_SECRET); assert.ok(verified.ok);
  const expired = signLegalPreviewToken({...verified.payload,expiresAt:Date.now()-1},TEST_LEGAL_PREVIEW_SECRET);
  const replay = await POST(request({...input,legalPreviewToken:expired},key)); assert.equal(replay.status,200);
  assert.deepEqual((await pool.query("select * from order_legal_acceptances where order_id=$1 order by slug",[order.id])).rows,rows);
  assert.doesNotMatch(JSON.stringify(await replay.json()), /rendered_body|renderedBody|templateContentHash/);
  assert.equal((await POST(request({...input,customerName:"Different"},key))).status,409);
});
test("P3 real concurrent same-key attempts commit one order and exactly two evidence rows (20x stress)", { skip }, async () => {
  for (let i=0;i<20;i++) { const p=await preview(); const key=randomUUID(); const input={...payload(),legalPreviewToken:p.legalPreviewToken}; const responses=await Promise.all(Array.from({length:4},()=>POST(request(input,key)))); assert.deepEqual(responses.map((r)=>r.status).sort(),[200,200,200,201]); const rows=(await pool.query("select o.id,count(a.id)::int n from orders o join order_legal_acceptances a on a.order_id=o.id where o.idempotency_key=$1 group by o.id",[key])).rows; assert.equal(rows.length,1); assert.equal(rows[0].n,2); }
});
test("P3 evidence failure and inventory failure roll back all commerce writes", { skip }, async () => {
  const before = async () => (await pool.query("select (select count(*) from orders) orders,(select count(*) from customers) customers,(select count(*) from addresses) addresses,(select count(*) from order_items) items,(select count(*) from order_legal_acceptances) evidence,(select on_hand from inventory where id='p3b-stock') stock")).rows[0];
  const snapshot=await before();
  await pool.query("create function p3b_test_reject_evidence() returns trigger language plpgsql as $$ begin raise exception 'injected evidence failure'; end $$");
  await pool.query("create trigger p3b_test_reject before insert on order_legal_acceptances for each row execute function p3b_test_reject_evidence()");
  const p=await preview(); assert.equal((await POST(request({...payload(),legalPreviewToken:p.legalPreviewToken}))).status,500); assert.deepEqual(await before(),snapshot);
  await pool.query("drop trigger p3b_test_reject on order_legal_acceptances; drop function p3b_test_reject_evidence()");
  await pool.query("update inventory set on_hand=0 where id='p3b-stock'"); const empty=await before(); const p2=await preview(); assert.equal((await POST(request({...payload(),legalPreviewToken:p2.legalPreviewToken}))).status,409); assert.deepEqual(await before(),empty);
  await pool.query("update inventory set on_hand=$1 where id='p3b-stock'",[snapshot.stock]);
});
test("P3 reserved code-owned Preview versions cannot become committed evidence", { skip }, async () => {
  await assert.rejects(transaction((c,id)=>insertEvidence(c,id,slugs[0],{document_version_id:"p2-preview-fixture-distance-sales-render-1"})));
});
test("P3 legacy committed replay remains compatible", { skip }, async () => {
  const { orderRequestFingerprint, orderRequestSchema }=await import("../lib/order-domain.ts");
  await pool.query("update orders set request_fingerprint=$1 where id='legacy-order'",[orderRequestFingerprint(orderRequestSchema.parse(payload()),new Map([["p3b-product",1]]))]);
  assert.equal((await POST(request(payload(),"legacy-key"))).status,200);
});
test("P3 legal source writer waits for checkout document shared lock", { skip }, async () => {
  const c=await pool.connect(); try { await c.query("begin"); await c.query("select id from legal_documents where slug='distance-sales' for share"); const writer=await pool.connect(); try { await writer.query("begin; set local lock_timeout='100ms'"); await assert.rejects(writer.query("insert into legal_document_versions(id,document_id,version,title,body,content_hash) values($1,'doc-distance-sales',2,'Draft','Test',$2)",[randomUUID(),"a".repeat(64)]),/lock timeout/); await writer.query("rollback"); } finally { writer.release(); } await c.query("rollback"); } finally {c.release();}
});

test("P3 restricted runtime role cannot mutate evidence or disable its guards", { skip }, async () => {
  const id = await transaction(async (c,id) => { for (const slug of slugs) await insertEvidence(c,id,slug); });
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='p3b_runtime') THEN CREATE ROLE p3b_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END $$");
  await pool.query("grant usage on schema public to p3b_runtime; grant select,insert,update,delete,truncate on all tables in schema public to p3b_runtime");
  const c = await pool.connect();
  try {
    await c.query("set role p3b_runtime");
    await assert.rejects(c.query("update order_legal_acceptances set title=title where order_id=$1",[id]), /immutable/);
    await assert.rejects(c.query("delete from order_legal_acceptances where order_id=$1",[id]), /immutable/);
    await assert.rejects(c.query("truncate order_legal_acceptances"), /truncated/);
    await assert.rejects(c.query("alter table order_legal_acceptances disable trigger all"), /owner/);
    await assert.rejects(c.query("set session_replication_role=replica"), /permission/);
    await c.query("update orders set notes='Runtime lifecycle update' where id=$1",[id]);
  } finally { await c.query("reset role"); c.release(); }
});

test("P3 effective-time and product-price changes require fresh authority without altering prior evidence", { skip }, async () => {
  const future = new Date(Date.now()+86_400_000);
  await pool.query("insert into legal_document_versions(id,document_id,version,title,body,content_hash,effective_at,published_at,published_by) values('p3b-ds-future','doc-distance-sales',2,$1,$2,$3,$4,now(),'disposable-test')",[title(slugs[0]),body,contentHash(slugs[0]),future]);
  const p=await preview(); assert.equal(p.documents.find(d=>d.slug===slugs[0])!.documentVersionId,'p3b-distance-sales');
  const key=randomUUID(), input={...payload(),legalPreviewToken:p.legalPreviewToken};
  assert.equal((await POST(request(input,key))).status,201);
  const historical=(await pool.query("select a.* from order_legal_acceptances a join orders o on o.id=a.order_id where o.idempotency_key=$1 order by a.slug",[key])).rows;
  const stale=await preview();
  await pool.query("insert into legal_document_versions(id,document_id,version,title,body,content_hash,effective_at,published_at,published_by) values('p3b-ds-current','doc-distance-sales',3,$1,$2,$3,now(),now(),'disposable-test')",[title(slugs[0]),body,contentHash(slugs[0])]);
  const count=Number((await pool.query('select count(*) n from orders')).rows[0].n);
  const rejected=await POST(request({...payload(),legalPreviewToken:stale.legalPreviewToken})); assert.equal(rejected.status,409);
  assert.equal(Number((await pool.query('select count(*) n from orders')).rows[0].n),count);
  assert.equal((await POST(request(input,key))).status,200);
  assert.deepEqual((await pool.query("select a.* from order_legal_acceptances a join orders o on o.id=a.order_id where o.idempotency_key=$1 order by a.slug",[key])).rows,historical);
  const fresh=await preview(); assert.equal(fresh.documents.find(d=>d.slug===slugs[0])!.documentVersionId,'p3b-ds-current');
  const changed={...payload(),legalAcceptances:slugs.map(slug=>slug===slugs[0]?'p3b-ds-current':`p3b-${slug}`),legalPreviewToken:fresh.legalPreviewToken};
  await pool.query("update products set price=13000 where id='p3b-product'");
  assert.equal((await POST(request(changed))).status,409);
  assert.equal(Number((await pool.query('select count(*) n from orders')).rows[0].n),count);
  await pool.query("update products set price=12000 where id='p3b-product'");
  assert.equal((await POST(request(changed))).status,201);
});
