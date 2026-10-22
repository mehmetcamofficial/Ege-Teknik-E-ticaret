import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The Sentry wizard scaffolds a public demo page and an API route that throws on every
 * request. They are test fixtures, not observability: on a live store the route lets
 * anyone flood error reporting. Real reporting comes from the instrumentation and config
 * files pinned below - those must stay.
 */

test("no Sentry wizard demo surface is shipped", () => {
  const appFiles = globSync("app/**/*.{ts,tsx}");
  const demo = appFiles.filter((f) => /sentry-example/i.test(f) || /Sentry(Example|Frontend)\w*Error|sentry-example-api/.test(readFileSync(f, "utf8")));
  assert.deepEqual(demo, [], "Sentry demo page/API route must not come back");
});

test("the real Sentry integration stays wired in", () => {
  for (const file of ["instrumentation.ts", "instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts", "app/global-error.tsx"]) {
    assert.ok(existsSync(file), `${file} is part of production error reporting`);
  }
  assert.match(readFileSync("next.config.ts", "utf8"), /withSentryConfig\(/);
  assert.match(readFileSync("app/global-error.tsx", "utf8"), /captureException/);
});
