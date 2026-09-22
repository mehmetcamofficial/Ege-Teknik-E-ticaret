import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import test from "node:test";

const routeFiles = globSync("app/**/route.ts");

test("route modules do not export validation schemas", () => {
  for (const routeFile of routeFiles) {
    const source = readFileSync(routeFile, "utf8");
    assert.doesNotMatch(source, /^export\s+const\s+\w*Schema\b/m, `${routeFile} exports a validation schema`);
  }
});

test("route modules do not import implementation details from another route module", () => {
  for (const routeFile of routeFiles) {
    const source = readFileSync(routeFile, "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*\/route["']/, `${routeFile} imports from another route module`);
  }
});
