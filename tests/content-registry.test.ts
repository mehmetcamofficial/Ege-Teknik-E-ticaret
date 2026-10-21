/**
 * Content registry (P0-B / P1) — fidelity, round-trip and determinism.
 *
 * These tests are the P1 gate. They assert, against the FROZEN sources in scripts/klima-rehberi/:
 *   - the exact entry / section / FAQ counts;
 *   - field-by-field normalized equality of the import (nothing dropped, nothing invented);
 *   - a lossless registry -> guide round trip;
 *   - a lossless entries -> table rows -> entries round trip (the DB shape the exporter reads);
 *   - slug uniqueness, frozen slugs, frozen public URLs;
 *   - content-hash stability and exporter determinism across repeated runs;
 *   - that today's category/catalog links are preserved as LINKS, not invented product ids.
 *
 * No database, no network, no credentials: everything here is pure logic over committed files.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { selectionGuides } from "../scripts/klima-rehberi/guides-1.mjs";
import { technologyGuides } from "../scripts/klima-rehberi/guides-2.mjs";
import { serviceGuides } from "../scripts/klima-rehberi/guides-3.mjs";
import {
  buildSnapshot, canonicalJson, countEntries, DEFAULT_GUIDE_PUBLISHED_AT, entryId, fromTableRows,
  hashablePayload, importGuides, parseRegistrySnapshot, registryToGuides, REGISTRY_SNAPSHOT_PATH,
  serializeRegistry, sortEntries, stableHash, toTableRows,
} from "../lib/content-registry.ts";
import type { SourceGuide } from "../lib/content-registry.ts";

const SOURCES: { file: string; guides: SourceGuide[] }[] = [
  { file: "scripts/klima-rehberi/guides-1.mjs", guides: selectionGuides as unknown as SourceGuide[] },
  { file: "scripts/klima-rehberi/guides-2.mjs", guides: technologyGuides as unknown as SourceGuide[] },
  { file: "scripts/klima-rehberi/guides-3.mjs", guides: serviceGuides as unknown as SourceGuide[] },
];

const fileFor = new Map<string, string>();
const guides: SourceGuide[] = [];
for (const source of SOURCES) for (const guide of source.guides) { fileFor.set(guide.slug, source.file); guides.push(guide); }

const entries = importGuides(guides, { publishedAt: DEFAULT_GUIDE_PUBLISHED_AT, sourceRefFor: (g) => fileFor.get(g.slug) ?? "" });
const bySlug = new Map(entries.map((e) => [e.slug, e]));

// ---- exact counts ------------------------------------------------------------------------------
test("all 16 guides are imported, from all three frozen source files", () => {
  assert.equal(guides.length, 16);
  assert.equal(entries.length, 16);
  assert.deepEqual(countEntries(entries), {
    entries: 16, sections: 64, faq: 31, relatedEntries: 48, links: 39, relatedProducts: 0, relatedServices: 0,
  });
  assert.deepEqual(SOURCES.map((s) => s.guides.length), [7, 4, 5]);
  for (const entry of entries) assert.match(entry.sourceRef, /^scripts\/klima-rehberi\/guides-[123]\.mjs$/);
});

test("section, FAQ, related and link counts match the sources per guide", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    assert.equal(entry.sections.length, guide.sections.length, `${guide.slug} sections`);
    assert.equal(entry.faq.length, guide.faq.length, `${guide.slug} faq`);
    assert.equal(entry.relatedEntries.length, guide.related.length, `${guide.slug} related`);
    assert.equal(entry.links.length, (guide.products ?? []).length, `${guide.slug} links`);
  }
});

// ---- field-by-field fidelity -------------------------------------------------------------------
test("every scalar field is preserved verbatim, with no text normalization", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    assert.equal(entry.slug, guide.slug);
    assert.equal(entry.category, guide.category);
    assert.equal(entry.title, guide.title);
    assert.equal(entry.seoTitle, guide.seoTitle);
    assert.equal(entry.description, guide.description);
    assert.equal(entry.lead, guide.lead);
    assert.equal(entry.answer, guide.answer);
    assert.deepEqual(entry.image, guide.image, `${guide.slug} image metadata`);
  }
});

test("published_at is preserved from the shipped guides and is never 'now'", () => {
  for (const entry of entries) {
    // the shipped date, normalized once to the exact form a timestamptz round trip returns
    assert.equal(entry.publishedAt, "2026-09-28T00:00:00.000Z");
    assert.equal(entry.publishedAt.slice(0, 10), "2026-09-28", "the calendar day is unchanged");
  }
  // the date comes from the generator's own constant, not from a literal invented here
  assert.match(readFileSync("scripts/build-klima-rehberi.mjs", "utf8"), new RegExp(`const PUBLISHED = "${DEFAULT_GUIDE_PUBLISHED_AT}"`));
  // and the value is stable: a re-run never drifts to the current date
  assert.equal(entries[0].publishedAt, entries[15].publishedAt);
});

test("section ordering and content are preserved exactly, including raw HTML whitespace", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    entry.sections.forEach((section, i) => {
      assert.equal(section.position, i, `${guide.slug} section ${i} position`);
      assert.equal(section.sectionKey, guide.sections[i].id, `${guide.slug} section ${i} key`);
      assert.equal(section.title, guide.sections[i].title);
      // byte-for-byte: the leading newline of the template literal must survive the import
      assert.equal(section.html, guide.sections[i].html, `${guide.slug} section ${i} html`);
    });
  }
});

test("FAQ ordering is preserved exactly", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    entry.faq.forEach((item, i) => {
      assert.equal(item.position, i);
      assert.equal(item.question, guide.faq[i][0], `${guide.slug} faq ${i} question`);
      assert.equal(item.answer, guide.faq[i][1], `${guide.slug} faq ${i} answer`);
    });
  }
});

test("related guide links are preserved, in order, and resolve to real entries", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    entry.relatedEntries.forEach((related, i) => {
      assert.equal(related.position, i, `${guide.slug} related ${i} order`);
      assert.equal(related.relatedEntryId, entryId(guide.related[i]));
      assert.ok(entries.some((e) => e.id === related.relatedEntryId), "related target exists");
    });
  }
});

test("category/catalog links are preserved verbatim as links, and NO product id is invented", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    const source = guide.products ?? [];
    entry.links.forEach((link, i) => {
      assert.equal(link.position, i);
      assert.equal(link.label, source[i].label, `${guide.slug} link ${i} label`);
      // href must survive byte-for-byte: percent-encoding and query order included
      assert.equal(link.href, source[i].href, `${guide.slug} link ${i} href`);
    });
    // the explicit P1 requirement: today's products[] are category URLs, not product ids
    assert.deepEqual(entry.relatedProducts, [], `${guide.slug} must not invent product ids`);
    assert.deepEqual(entry.relatedServices, [], `${guide.slug} must not misuse related[] for services`);
  }
  const btu = bySlug.get("klima-btu-hesaplama")!;
  assert.deepEqual(btu.links.map((l) => l.href), ["catalog.html?btu=9000", "catalog.html?btu=12000", "catalog.html?btu=18000", "catalog.html?btu=24000"]);
  const energy = bySlug.get("enerji-sinifi-seer-scop")!;
  assert.ok(energy.links.some((l) => l.href === "catalog.html?category=Duvar%20Tipi&series=Airy"));
});

test("image metadata is preserved for every guide", () => {
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    assert.equal(entry.image.key, guide.image.key);
    assert.equal(entry.image.alt, guide.image.alt);
    assert.equal(entry.image.caption, guide.image.caption);
  }
  assert.equal(new Set(entries.map((e) => e.image.key)).size, 16, "16 distinct image keys");
});

// ---- internal links ---------------------------------------------------------------------------
test("internal links inside section HTML are untouched (not rewritten, not absolutized)", () => {
  const sourceHtml = guides.flatMap((g) => g.sections.map((s) => s.html)).join("\n");
  assert.match(sourceHtml, /href="rehber\/klima-btu-hesaplama\.html"/, "the sources really do contain internal guide links");
  for (const guide of guides) {
    const entry = bySlug.get(guide.slug)!;
    guide.sections.forEach((section, i) => {
      const hrefs = [...section.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      const imported = [...entry.sections[i].html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(imported, hrefs, `${guide.slug} section ${i} hrefs preserved in order`);
      // An INTERNAL link must stay relative and keep its .html suffix — a P2 byte-equality prerequisite.
      // External absolute urls (a manufacturer PDF) legitimately exist in the sources and must be
      // preserved verbatim too, so they are checked for stability rather than for relativeness.
      for (const href of imported) {
        if (/^https?:\/\//.test(href)) continue;
        assert.doesNotMatch(href, /^https?:\/\//, "internal links stay relative");
        assert.match(href, /^([a-z0-9-]+\.html|rehber\/[a-z0-9-]+\.html)/, `internal href keeps its shipped form: ${href}`);
      }
    });
  }
});

// ---- round-trip fidelity ----------------------------------------------------------------------
test("registry -> guides round trip is lossless (deep equality, modulo entry ordering)", () => {
  const rebuilt = registryToGuides(entries);
  const bySource = [...guides].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  assert.deepEqual(rebuilt, bySource);
});

test("entries -> table rows -> entries round trip is lossless (the DB shape the exporter reads)", () => {
  const tables = toTableRows(entries);
  assert.equal(tables.entries.length, 16);
  assert.equal(tables.sections.length, 64);
  assert.equal(tables.faq.length, 31);
  assert.equal(tables.relatedEntries.length, 48);
  assert.equal(tables.links.length, 39);
  assert.deepEqual(tables.relatedProducts, []);
  assert.deepEqual(tables.relatedServices, []);
  const restored = fromTableRows(tables);
  assert.deepEqual(restored, sortEntries(entries));
});

test("row order from the database never leaks into the result (position wins, always)", () => {
  const tables = toTableRows(entries);
  const shuffled = {
    ...tables,
    entries: [...tables.entries].reverse(),
    sections: [...tables.sections].sort((a, b) => b.position - a.position),
    faq: [...tables.faq].reverse(),
    relatedEntries: [...tables.relatedEntries].reverse(),
    links: [...tables.links].reverse(),
  };
  assert.deepEqual(fromTableRows(shuffled), sortEntries(entries));
});

test("a published_at arriving as a Date (as postgres returns it) yields the same entry", () => {
  const tables = toTableRows(entries);
  const asDates = { ...tables, entries: tables.entries.map((r) => ({ ...r, published_at: new Date(r.published_at as string) })) };
  assert.deepEqual(fromTableRows(asDates), sortEntries(entries));
});

// ---- slugs, URLs, hashes, determinism ----------------------------------------------------------
test("slugs are unique and frozen, and the 16 public /rehber/<slug>.html URLs are unchanged", () => {
  const slugs = entries.map((e) => e.slug);
  assert.equal(new Set(slugs).size, 16, "slug uniqueness");
  assert.equal(new Set(entries.map((e) => e.id)).size, 16, "entry id uniqueness");
  const committedPages = readdirSync("public/rehber").filter((n) => n.endsWith(".html")).map((n) => n.replace(/\.html$/, "")).sort();
  assert.deepEqual([...slugs].sort(), committedPages, "every registry entry maps 1:1 to a committed public page, and no extra");
  for (const slug of slugs) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, "slug satisfies the content_entries_slug_ck CHECK");
});

test("content hashes are stable across repeated imports and reordering of the input", () => {
  const again = importGuides(guides, { publishedAt: DEFAULT_GUIDE_PUBLISHED_AT, sourceRefFor: (g) => fileFor.get(g.slug) ?? "" });
  assert.deepEqual(again, entries, "import is deterministic");
  const shuffled = importGuides([...guides].reverse(), { publishedAt: DEFAULT_GUIDE_PUBLISHED_AT, sourceRefFor: (g) => fileFor.get(g.slug) ?? "" });
  assert.deepEqual(sortEntries(shuffled), sortEntries(entries), "input order does not change the entries");
  for (const entry of entries) assert.match(entry.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(new Set(entries.map((e) => e.contentHash)).size, 16, "16 distinct content hashes");
});

test("a real content change changes the hash, and pure reordering of the ENTRY LIST does not", () => {
  const original = entries[0].contentHash;
  const edited = structuredClone(entries[0]);
  edited.title = `${edited.title}!`;
  // hashablePayload selects the content fields explicitly, so the stored hash of the UNCHANGED entry is
  // the baseline; any content edit must move away from it
  assert.equal(stableHash(hashablePayload(entries[0])), original, "the stored hash is the hash of the content payload");
  assert.notEqual(stableHash(hashablePayload(edited)), original, "a text edit changes the hash");
  // moving the source file must NOT change the content hash (sourceRef is excluded by design)
  const relocated = structuredClone(entries[0]);
  relocated.sourceRef = "scripts/klima-rehberi/guides-9.mjs";
  assert.equal(stableHash(hashablePayload(relocated)), original);
  // reordering the SECTION list is a content change and must be detected
  const reordered = structuredClone(entries[0]);
  reordered.sections = [reordered.sections[1], reordered.sections[0]];
  assert.notEqual(stableHash(hashablePayload(reordered)), original);
  // the snapshot-level hash is order-independent across the entry LIST
  const shuffledEntries = [...entries].reverse();
  assert.equal(buildSnapshot(shuffledEntries).contentHash, buildSnapshot(entries).contentHash);
});

test("canonicalJson is key-order independent but array-order sensitive", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("the exporter is deterministic: repeated runs are byte-identical", () => {
  const first = serializeRegistry(entries);
  const second = serializeRegistry(entries);
  const third = serializeRegistry(fromTableRows(toTableRows(entries)));
  assert.equal(first, second, "repeated export is byte-identical");
  assert.equal(first, third, "DB round trip exports the same bytes");
  assert.equal(stableHash(first), stableHash(second));
  // no timestamp anywhere in the artifact
  assert.doesNotMatch(first, new RegExp(String(new Date().getUTCFullYear() + 1)));
  assert.doesNotMatch(first, /generatedAt|exportedAt|timestamp/i);
});

test("the committed snapshot is exactly what the exporter produces, and parses back", () => {
  const committed = readFileSync(REGISTRY_SNAPSHOT_PATH, "utf8");
  assert.equal(committed, serializeRegistry(entries), "run: node --experimental-strip-types scripts/export-content-registry.mjs");
  const parsed = parseRegistrySnapshot(committed);
  assert.equal(parsed.snapshotVersion, 1);
  assert.equal(parsed.entries.length, 16);
  assert.equal(parsed.contentHash, buildSnapshot(entries).contentHash);
  assert.deepEqual(parsed.counts, countEntries(entries));
  // the parsed snapshot round-trips to the same guides
  assert.deepEqual(registryToGuides(parsed.entries), [...guides].sort((a, b) => (a.slug < b.slug ? -1 : 1)));
});

test("snapshot entries are in canonical id order and every nested collection is position-ordered", () => {
  const parsed = parseRegistrySnapshot(readFileSync(REGISTRY_SNAPSHOT_PATH, "utf8"));
  const ids = parsed.entries.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort(), "entries sorted by id");
  for (const entry of parsed.entries) {
    for (const collection of [entry.sections, entry.faq, entry.relatedEntries, entry.links]) {
      const positions = collection.map((c) => c.position);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b), `${entry.slug} ordered`);
    }
  }
});
