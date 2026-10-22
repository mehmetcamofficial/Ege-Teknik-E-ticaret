import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const publicHtml = readdirSync("public").filter((name) => name.endsWith(".html")).map((name) => readFileSync(`public/${name}`, "utf8")).join("\n");
const deployableSource = [publicHtml, readFileSync("lib/legal-render.ts", "utf8")].join("\n");

test("the production build is a direct Next build with no source-rewriting wrapper", () => {
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(existsSync("scripts/build-home-css.mjs"), false);
  assert.equal(existsSync("public/home.css"), false);
  assert.doesNotMatch(packageJson.scripts.build, /git checkout|git restore|build-home-css|public\/index\.html/i);
});

test("deployable storefront and legal HTML have no obsolete runtime style or font dependency", () => {
  assert.doesNotMatch(deployableSource, /cdn\.tailwindcss\.com/i);
  assert.doesNotMatch(deployableSource, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  assert.doesNotMatch(deployableSource, /material[ -]symbols/i);
  assert.doesNotMatch(deployableSource, /home\.css/i);
  assert.match(readFileSync("lib/legal-render.ts", "utf8"), /href="\/store\.css"/);
});
