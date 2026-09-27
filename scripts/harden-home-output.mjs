import { readFile, writeFile } from "node:fs/promises";

const INDEX_PATH = new URL("../public/index.html", import.meta.url);

let html = await readFile(INDEX_PATH, "utf8");

const replacements = [
  ["Ege Teknik - GREE Klima &amp; İkinci El Outlet", "Ege Teknik - GREE Klima &amp; Spot Ürünler"],
  ["İkinci El &amp; Outlet", "Spot Ürünler"],
  [">Revizyonlu<", ">Spot<"],
];

for (const [from, to] of replacements) {
  html = html.split(from).join(to);
}

await writeFile(INDEX_PATH, html, "utf8");

const forbiddenPassiveOrigins = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.tailwindcss.com",
  "lh3.googleusercontent.com",
];

const staleTerms = [
  "İkinci El &amp; Outlet",
  ">Revizyonlu<",
];

const violations = [
  ...forbiddenPassiveOrigins.filter((origin) => html.includes(origin)).map((origin) => `external passive origin remains: ${origin}`),
  ...staleTerms.filter((term) => html.includes(term)).map((term) => `stale storefront terminology remains: ${term}`),
];

if (violations.length > 0) {
  throw new Error(`Homepage hardening gate failed:\n- ${violations.join("\n- ")}`);
}

console.log("Homepage hardening gate passed: local assets only and Spot Ürün terminology normalized.");
