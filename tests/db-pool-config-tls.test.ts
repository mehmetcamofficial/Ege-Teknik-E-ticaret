import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tls from "node:tls";
import pg from "pg";
import { scopedPoolSettings } from "../lib/db-pool-config.ts";

/**
 * Real TLS handshakes with the real `pg` driver against a loopback server that speaks just enough of the PostgreSQL protocol (SSLRequest -> 'S') and then
 * presents a SELF-SIGNED certificate. It is a TLS server only: it never sees a startup message, a password or a query, and it is not a database.
 * Production settings are used so the loopback host needs no Preview identity; the pin and the sslmode handling are what is under test.
 */
let dir = "", key = "", cert = "";
const server = net.createServer((socket) => {
  socket.on("error", () => {});
  socket.once("data", () => {
    socket.write("S");
    const secure = new tls.TLSSocket(socket, { isServer: true, key, cert });
    secure.on("error", () => {});
    secure.on("data", () => secure.destroy());
  });
});
let port = 0;

test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), "pool-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  key = readFileSync(join(dir, "k.pem"), "utf8"); cert = readFileSync(join(dir, "c.pem"), "utf8");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });

const urlFor = (query: string) => `postgresql://app_role:pw@127.0.0.1:${port}/appdb${query}`;
const CERT_ERROR = /self[- ]signed|unable to verify|certificate/i;
/** The error a connection attempt ends with: a certificate error means TLS refused the server; anything else means TLS was accepted. */
async function outcome(config: pg.ClientConfig): Promise<string> {
  const client = new pg.Client({ connectionTimeoutMillis: 5000, ...config });
  client.on("error", () => {});
  try { await client.connect(); return "connected"; } catch (error) { return error instanceof Error ? error.message : String(error); } finally { client.end().catch(() => {}); }
}
const withTlsVerificationOff = async <T>(fn: () => Promise<T>) => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try { return await fn(); } finally { if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before; }
};

test("CONTROL: with sslmode in the URL and verification switched off for the process, the old pool config accepts a self-signed server", async () => {
  const result = await withTlsVerificationOff(() => outcome({ connectionString: urlFor("?sslmode=require"), ssl: { rejectUnauthorized: true } }));
  assert.doesNotMatch(result, CERT_ERROR, `the old pin was replaced by the driver and TLS was accepted (the attempt then ended with: ${result.slice(0, 80)})`);
});

test("the scoped settings refuse a self-signed server for every sslmode, even with verification switched off for the process", async () => {
  for (const query of ["?sslmode=require", "?sslmode=verify-ca", "?sslmode=verify-full", ""]) {
    const settings = scopedPoolSettings("storefront", urlFor(query), { APP_ENV: "production" });
    const result = await withTlsVerificationOff(() => outcome({ connectionString: settings.connectionString, ssl: settings.ssl }));
    assert.match(result, CERT_ERROR, `${query || "(no sslmode)"}: the certificate must be verified`);
  }
});

test("a disposable local database keeps its plain, non-TLS connection (the server here only speaks TLS, so the attempt must not start one)", async () => {
  const local = `postgresql://u:pw@127.0.0.1:${port}/sprintb_local`;
  const settings = scopedPoolSettings("storefront", local, { APP_ENV: "development" });
  assert.equal(settings.ssl, false);
  assert.doesNotMatch(await outcome({ connectionString: settings.connectionString, ssl: settings.ssl, connectionTimeoutMillis: 800 }), CERT_ERROR, "no TLS handshake was attempted");
});
