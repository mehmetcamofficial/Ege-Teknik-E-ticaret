import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const PUBLIC_DIR = "public";
const homepage = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
const storeJs = readFileSync(join(PUBLIC_DIR, "store.js"), "utf8");
const publicSources = readdirSync(PUBLIC_DIR)
  .filter((entry) => /\.(?:html|js|css)$/.test(entry))
  .map((entry) => readFileSync(join(PUBLIC_DIR, entry), "utf8"));

const BROKEN_EXTERNAL_LOGO_URL =
  "https://lh3.googleusercontent.com/aida/AEtjO1X-m38btI0omMcMjB0cwv3H2eJBt-7DQ6GXFcg-rgy6bxNqTCdNzk6x8uMBkWDyFbEHmALwCOFDU9ssfzdUMfoxk90Epi5bPxpWmeVZGY3Ivhzat4s6ynZwMCL9JfGL4cbSX43cOhWJZ1Ft-Gjvt0epWpgJuV74dlgy4eMTk7fk6ICDmjFQhU0MiQ2mddntuDwabnjNQxRvD0aMv2nc-YVNWvNH2ZHtonWQALTybCQUOEBrJSM60Cd4r90p";

test("homepage brand is semantic text rather than a remote image", () => {
  const brandLink = homepage.match(/<a\b(?=[^>]*\bdata-path="home")[^>]*>([\s\S]*?)<\/a>/)?.[1];
  assert.ok(brandLink, "homepage must keep its home brand link");
  assert.match(brandLink, /EGE TEKNİK/);
  assert.match(brandLink, /KLİMA &amp; TEKNOLOJİ/);
  assert.doesNotMatch(brandLink, /<img\b/i);
  assert.doesNotMatch(brandLink, /https?:\/\//i);
});

test("the dead external homepage logo URL is absent from every production storefront source", () => {
  for (const source of publicSources) assert.equal(source.includes(BROKEN_EXTERNAL_LOGO_URL), false);
});

test("shared storefront header retains the existing EGE TEKNİK text brand", () => {
  // Subtitle matches the homepage wordmark; dealer-status wording was removed in Phase 3A.3F
  // because the project holds no evidence for it (see tests/storefront-claims.test.ts).
  assert.match(storeJs, /class="brand" href="index\.html">EGE TEKNİK<small>KLİMA & TEKNOLOJİ<\/small>/);
});
