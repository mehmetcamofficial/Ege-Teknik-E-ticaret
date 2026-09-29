/**
 * Content registry domain logic (P0-B / P1 foundation).
 *
 * PURE MODULE — it imports nothing from `pg`, `next` or the database, and is therefore safe to import
 * from build-time code. Its only job is to define the canonical content shape and a DETERMINISTIC
 * serialization of it, so that:
 *
 *   guides-*.mjs  --(importGuides)-->  registry entries  --(serializeRegistry)-->  snapshot JSON
 *                                                             ^                                |
 *                                                             +-------- round-trip -----------+
 *
 * Fidelity rules that this module enforces (and the tests lock):
 *   - no content text normalization: every string is stored byte-for-byte as authored;
 *   - ordering is explicit and preserved (sections, FAQ, links, related);
 *   - the snapshot is a pure function of the entries, so repeated exports are byte-identical;
 *   - the per-entry content hash is a pure function of the entry's content.
 */
import { createHash } from "node:crypto";

export const REGISTRY_SNAPSHOT_VERSION = 1;
export const REGISTRY_SNAPSHOT_PATH = "data/content/registry-snapshot.json";

/** The exact shape of one guide in scripts/klima-rehberi/guides-*.mjs (frozen sources). */
export interface SourceGuide {
  slug: string;
  category: string;
  title: string;
  seoTitle: string;
  description: string;
  lead: string;
  answer: string;
  image: { key: string; alt: string; caption: string; /** Present only when the source sets it (one guide does); absence is preserved as NULL, not as false. */ portrait?: boolean };
  sections: { id: string; title: string; html: string }[];
  faq: [string, string][];
  related: string[];
  products?: { label: string; href: string }[];
}

export interface RegistryLink {
  position: number;
  label: string;
  href: string;
  linkKind: LinkKind;
}

export type LinkKind = "link" | "catalog_filter" | "category" | "service" | "contact" | "selector" | "second_hand";

export interface RegistryEntry {
  id: string;
  entryType: "guide";
  slug: string;
  category: string;
  title: string;
  seoTitle: string;
  description: string;
  lead: string;
  answer: string;
  image: { key: string; alt: string; caption: string; portrait?: boolean };
  status: "draft" | "published" | "archived";
  /** ISO-8601 UTC. Preserved from the source; never re-derived from "now". */
  publishedAt: string;
  contentHash: string;
  sourceRef: string;
  sections: { sectionKey: string; position: number; title: string; html: string }[];
  faq: { position: number; question: string; answer: string }[];
  relatedEntries: { relatedEntryId: string; position: number; label: string }[];
  links: RegistryLink[];
  relatedProducts: { productId: string; position: number; label: string }[];
  relatedServices: { serviceSlug: string; position: number; label: string }[];
}

/** Deterministic entry id. Frozen slugs ⇒ frozen ids, so re-import is idempotent. */
export const entryId = (slug: string): string => `guide:${slug}`;

/**
 * Classifies a literal href WITHOUT altering it. This is descriptive metadata only: `href` stays the
 * canonical, verbatim value. It exists so an admin UI can group links later, never to rewrite them.
 */
export function classifyLink(href: string): LinkKind {
  if (href.startsWith("catalog.html?")) {
    if (href.includes("category=")) return "category";
    return "catalog_filter";
  }
  if (href.startsWith("services.html")) return "service";
  if (href.startsWith("contact.html")) return "contact";
  if (href.startsWith("selector.html")) return "selector";
  if (href.startsWith("second-hand.html")) return "second_hand";
  return "link";
}

/**
 * The content payload that the content hash covers. `id`, `contentHash` and `sourceRef` are deliberately
 * EXCLUDED: the hash identifies the content, not where it came from, so relocating a source file does
 * not change it while any real text/ordering change does.
 */
export function hashablePayload(entry: Omit<RegistryEntry, "contentHash" | "sourceRef" | "id">) {
  return {
    entryType: entry.entryType,
    slug: entry.slug,
    category: entry.category,
    title: entry.title,
    seoTitle: entry.seoTitle,
    description: entry.description,
    lead: entry.lead,
    answer: entry.answer,
    image: entry.image,
    status: entry.status,
    publishedAt: entry.publishedAt,
    sections: entry.sections.map((s) => ({ sectionKey: s.sectionKey, position: s.position, title: s.title, html: s.html })),
    faq: entry.faq.map((f) => ({ position: f.position, question: f.question, answer: f.answer })),
    relatedEntries: entry.relatedEntries.map((r) => ({ relatedEntryId: r.relatedEntryId, position: r.position, label: r.label })),
    links: entry.links.map((l) => ({ position: l.position, label: l.label, href: l.href, linkKind: l.linkKind })),
    relatedProducts: entry.relatedProducts.map((p) => ({ productId: p.productId, position: p.position, label: p.label })),
    relatedServices: entry.relatedServices.map((s) => ({ serviceSlug: s.serviceSlug, position: s.position, label: s.label })),
  };
}

/** Stable sha256 (hex) of a value, via a canonical JSON form with recursively sorted object keys. */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Canonical JSON: object keys sorted lexicographically at every depth, so serialization is independent
 * of property insertion order. Arrays keep their order (it is semantic: it is the source ordering).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface ImportGuidesOptions {
  /** ISO date (or datetime) of the shipped guides, preserved verbatim. Defaults to the generator's PUBLISHED. */
  publishedAt: string;
  /** Per-source-file provenance, e.g. "scripts/klima-rehberi/guides-1.mjs". */
  sourceRefFor?: (guide: SourceGuide) => string;
}

export const DEFAULT_GUIDE_PUBLISHED_AT = "2026-09-28";

/**
 * Normalizes a published date to the full ISO-8601 UTC form the `timestamptz` column returns.
 *
 * The sources carry a date ("2026-09-28"); the database returns a datetime. Normalizing ONCE, at import,
 * is what makes the import -> DB -> export round trip exactly stable instead of oscillating between the
 * two shapes. The calendar day is never changed: a bare date is pinned to midnight UTC.
 */
export function normalizePublishedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`published_at is not a valid date: "${value}"`);
  return parsed.toISOString();
}

/**
 * Converts the frozen guides into registry entries. Lossless by construction:
 * strings are copied verbatim, ordering is kept, and nothing is invented.
 *
 * `related[]` holds SLUGS, so it maps to `relatedEntries` (resolved to entry ids) — never to
 * `relatedServices`. `products[]` holds CATEGORY/FILTER/CONTACT urls, not product ids, so it maps to
 * `links` verbatim; `relatedProducts` stays empty rather than being filled with invented ids.
 */
export function importGuides(guides: SourceGuide[], options: ImportGuidesOptions): RegistryEntry[] {
  const { publishedAt, sourceRefFor } = options;
  const known = new Set(guides.map((g) => g.slug));
  return guides.map((guide) => {
    for (const related of guide.related) {
      if (!known.has(related)) throw new Error(`${guide.slug}: related target "${related}" is not an imported guide`);
      if (related === guide.slug) throw new Error(`${guide.slug}: related target must not be the guide itself`);
    }
    const base = {
      entryType: "guide" as const,
      slug: guide.slug,
      category: guide.category,
      title: guide.title,
      seoTitle: guide.seoTitle,
      description: guide.description,
      lead: guide.lead,
      answer: guide.answer,
      // `portrait` is copied only when the source sets it, so "absent" never silently becomes "false"
      image: { key: guide.image.key, alt: guide.image.alt, caption: guide.image.caption, ...(guide.image.portrait === undefined ? {} : { portrait: guide.image.portrait }) },
      status: "published" as const,
      publishedAt: normalizePublishedAt(publishedAt),
      sections: guide.sections.map((s, position) => ({ sectionKey: s.id, position, title: s.title, html: s.html })),
      faq: guide.faq.map(([question, answer], position) => ({ position, question, answer })),
      relatedEntries: guide.related.map((related, position) => ({ relatedEntryId: entryId(related), position, label: "" })),
      links: (guide.products ?? []).map((p, position) => ({ position, label: p.label, href: p.href, linkKind: classifyLink(p.href) })),
      relatedProducts: [] as { productId: string; position: number; label: string }[],
      relatedServices: [] as { serviceSlug: string; position: number; label: string }[],
    };
    return {
      id: entryId(guide.slug),
      ...base,
      contentHash: stableHash(hashablePayload(base)),
      sourceRef: sourceRefFor ? sourceRefFor(guide) : "",
    };
  });
}


/**
 * The exact row shapes the DB adapter reads/writes. Column names mirror drizzle-pg/0014_content_registry.sql.
 * The exporter reconstructs entries from these rows, so they are the DB→snapshot contract.
 */
export interface ContentEntryRow {
  id: string; entry_type: string; slug: string; category: string; title: string; seo_title: string;
  description: string; lead: string; answer: string; image_key: string; image_alt: string;
  image_caption: string; image_portrait: boolean | null; status: string; published_at: string | Date; content_hash: string; source_ref: string;
}
export interface ContentSectionRow { entry_id: string; section_key: string; position: number; title: string; html: string }
export interface ContentFaqRow { entry_id: string; position: number; question: string; answer: string }
export interface ContentRelatedEntryRow { entry_id: string; related_entry_id: string; position: number; label: string }
export interface ContentLinkRow { entry_id: string; position: number; label: string; href: string; link_kind: string }
export interface ContentRelatedProductRow { entry_id: string; product_id: string; position: number; label: string }
export interface ContentRelatedServiceRow { entry_id: string; service_slug: string; position: number; label: string }

export interface RegistryTables {
  entries: ContentEntryRow[];
  sections: ContentSectionRow[];
  faq: ContentFaqRow[];
  relatedEntries: ContentRelatedEntryRow[];
  links: ContentLinkRow[];
  relatedProducts: ContentRelatedProductRow[];
  relatedServices: ContentRelatedServiceRow[];
}

/** postgres returns timestamptz as a Date; normalize to a stable ISO string without touching content. */
const isoPublishedAt = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Deterministic order: by position within an entry, then by entry id. */
function compareRows(a: { entry_id: string; position: number }, b: { entry_id: string; position: number }): number {
  if (a.entry_id !== b.entry_id) return a.entry_id < b.entry_id ? -1 : 1;
  return a.position - b.position;
}

/** Groups child rows by their owning entry id, preserving arrival order (callers re-sort by position). */
function groupByEntry<T extends { entry_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const existing = map.get(row.entry_id);
    if (existing) existing.push(row);
    else map.set(row.entry_id, [row]);
  }
  return map;
}

/** Splits entries into the exact table rows for a write. Pure and deterministic (ordering is explicit). */
export function toTableRows(entries: RegistryEntry[]): RegistryTables {
  const tables: RegistryTables = {
    entries: [...entries]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((e) => ({
        id: e.id, entry_type: e.entryType, slug: e.slug, category: e.category, title: e.title,
        seo_title: e.seoTitle, description: e.description, lead: e.lead, answer: e.answer,
        image_key: e.image.key, image_alt: e.image.alt, image_caption: e.image.caption,
        // NULL (not false) when the source does not set it, so absence round-trips as absence
        image_portrait: e.image.portrait ?? null,
        status: e.status, published_at: e.publishedAt, content_hash: e.contentHash, source_ref: e.sourceRef,
      })),
    sections: entries.flatMap((e) => e.sections.map((s) => ({ entry_id: e.id, section_key: s.sectionKey, position: s.position, title: s.title, html: s.html }))).sort(compareRows),
    faq: entries.flatMap((e) => e.faq.map((f) => ({ entry_id: e.id, position: f.position, question: f.question, answer: f.answer }))).sort(compareRows),
    relatedEntries: entries.flatMap((e) => e.relatedEntries.map((r) => ({ entry_id: e.id, related_entry_id: r.relatedEntryId, position: r.position, label: r.label }))).sort(compareRows),
    links: entries.flatMap((e) => e.links.map((l) => ({ entry_id: e.id, position: l.position, label: l.label, href: l.href, link_kind: l.linkKind }))).sort(compareRows),
    relatedProducts: entries.flatMap((e) => e.relatedProducts.map((p) => ({ entry_id: e.id, product_id: p.productId, position: p.position, label: p.label }))).sort(compareRows),
    relatedServices: entries.flatMap((e) => e.relatedServices.map((s) => ({ entry_id: e.id, service_slug: s.serviceSlug, position: s.position, label: s.label }))).sort(compareRows),
  };
  return tables;
}

/**
 * Reconstructs entries from DB rows — the exporter's read path. Ordering is re-established from
 * `position`, never from the incidental order rows arrived in, so the snapshot is stable.
 */
export function fromTableRows(tables: RegistryTables): RegistryEntry[] {
  const sections = groupByEntry(tables.sections);
  const faq = groupByEntry(tables.faq);
  const related = groupByEntry(tables.relatedEntries);
  const links = groupByEntry(tables.links);
  const relatedProducts = groupByEntry(tables.relatedProducts);
  const relatedServices = groupByEntry(tables.relatedServices);
  function byPosition<T extends { position: number }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => a.position - b.position);
  }

  return [...tables.entries]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => {
      const id = row.id;
      return {
        id,
        entryType: row.entry_type as RegistryEntry["entryType"],
        slug: row.slug,
        category: row.category,
        title: row.title,
        seoTitle: row.seo_title,
        description: row.description,
        lead: row.lead,
        answer: row.answer,
        // rebuild the image object with `portrait` present only when the column is not NULL
        image: {
          key: row.image_key, alt: row.image_alt, caption: row.image_caption,
          ...(row.image_portrait === null || row.image_portrait === undefined ? {} : { portrait: row.image_portrait }),
        },
        status: row.status as RegistryEntry["status"],
        publishedAt: isoPublishedAt(row.published_at),
        contentHash: row.content_hash,
        sourceRef: row.source_ref,
        sections: byPosition(sections.get(id) ?? []).map((s) => ({ sectionKey: s.section_key, position: s.position, title: s.title, html: s.html })),
        faq: byPosition(faq.get(id) ?? []).map((f) => ({ position: f.position, question: f.question, answer: f.answer })),
        relatedEntries: byPosition(related.get(id) ?? []).map((r) => ({ relatedEntryId: r.related_entry_id, position: r.position, label: r.label })),
        links: byPosition(links.get(id) ?? []).map((l) => ({ position: l.position, label: l.label, href: l.href, linkKind: l.link_kind as LinkKind })),
        relatedProducts: byPosition(relatedProducts.get(id) ?? []).map((p) => ({ productId: p.product_id, position: p.position, label: p.label })),
        relatedServices: byPosition(relatedServices.get(id) ?? []).map((s) => ({ serviceSlug: s.service_slug, position: s.position, label: s.label })),
      };
    });
}

export interface RegistrySnapshot {
  snapshotVersion: number;
  /** Hash over the whole entry list: the single value that ties a build to its content. */
  contentHash: string;
  counts: { entries: number; sections: number; faq: number; relatedEntries: number; links: number; relatedProducts: number; relatedServices: number };
  entries: RegistryEntry[];
}

export function countEntries(entries: RegistryEntry[]) {
  return {
    entries: entries.length,
    sections: entries.reduce((n, e) => n + e.sections.length, 0),
    faq: entries.reduce((n, e) => n + e.faq.length, 0),
    relatedEntries: entries.reduce((n, e) => n + e.relatedEntries.length, 0),
    links: entries.reduce((n, e) => n + e.links.length, 0),
    relatedProducts: entries.reduce((n, e) => n + e.relatedProducts.length, 0),
    relatedServices: entries.reduce((n, e) => n + e.relatedServices.length, 0),
  };
}

/** Entries in canonical order: by id. This is the only order the snapshot is ever written in. */
export function sortEntries(entries: RegistryEntry[]): RegistryEntry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Projects an entry into a FIXED key order.
 *
 * This is what makes the artifact independent of how an entry was constructed: `importGuides` and
 * `fromTableRows` build their objects in different orders (JS preserves insertion order, so a plain
 * JSON.stringify would emit different bytes for identical content). Serializing through this one
 * projection guarantees the snapshot is a pure function of the CONTENT, not of the code path.
 */
export function canonicalEntry(entry: RegistryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    entryType: entry.entryType,
    slug: entry.slug,
    category: entry.category,
    title: entry.title,
    seoTitle: entry.seoTitle,
    description: entry.description,
    lead: entry.lead,
    answer: entry.answer,
    image: {
      key: entry.image.key,
      alt: entry.image.alt,
      caption: entry.image.caption,
      ...(entry.image.portrait === undefined ? {} : { portrait: entry.image.portrait }),
    },
    status: entry.status,
    publishedAt: entry.publishedAt,
    sections: entry.sections.map((s) => ({ sectionKey: s.sectionKey, position: s.position, title: s.title, html: s.html })),
    faq: entry.faq.map((f) => ({ position: f.position, question: f.question, answer: f.answer })),
    relatedEntries: entry.relatedEntries.map((r) => ({ relatedEntryId: r.relatedEntryId, position: r.position, label: r.label })),
    links: entry.links.map((l) => ({ position: l.position, label: l.label, href: l.href, linkKind: l.linkKind })),
    relatedProducts: entry.relatedProducts.map((p) => ({ productId: p.productId, position: p.position, label: p.label })),
    relatedServices: entry.relatedServices.map((s) => ({ serviceSlug: s.serviceSlug, position: s.position, label: s.label })),
    contentHash: entry.contentHash,
    sourceRef: entry.sourceRef,
  };
}

export function buildSnapshot(entries: RegistryEntry[]): RegistrySnapshot {
  const sorted = sortEntries(entries);
  return {
    snapshotVersion: REGISTRY_SNAPSHOT_VERSION,
    contentHash: stableHash(sorted.map((e) => hashablePayload(e))),
    counts: countEntries(sorted),
    entries: sorted.map(canonicalEntry) as unknown as RegistryEntry[],
  };
}

/**
 * The committed file's exact bytes. A pure function of the snapshot: no timestamps, no environment, no
 * iteration-order dependence — so two exports of the same content are byte-identical.
 */
export function serializeRegistry(entries: RegistryEntry[]): string {
  return `${JSON.stringify(buildSnapshot(entries), null, 2)}\n`;
}

/** Parses a committed snapshot back into entries. Rejects anything that is not the expected version. */
export function parseRegistrySnapshot(text: string): RegistrySnapshot {
  const parsed = JSON.parse(text) as RegistrySnapshot;
  if (parsed.snapshotVersion !== REGISTRY_SNAPSHOT_VERSION) {
    throw new Error(`unsupported registry snapshot version ${parsed.snapshotVersion}`);
  }
  return parsed;
}

/**
 * Rebuilds the ORIGINAL guide objects from registry entries.
 *
 * This exists for one reason: the round-trip fidelity test. `guidesToRegistry` → `registryToGuides`
 * must return objects deeply equal to the frozen sources, which proves the import dropped nothing.
 */
export function registryToGuides(entries: RegistryEntry[]): SourceGuide[] {
  const slugByEntryId = new Map(entries.map((e) => [e.id, e.slug]));
  return sortEntries(entries).map((e) => ({
    slug: e.slug,
    category: e.category,
    title: e.title,
    seoTitle: e.seoTitle,
    description: e.description,
    lead: e.lead,
    answer: e.answer,
    image: { key: e.image.key, alt: e.image.alt, caption: e.image.caption, ...(e.image.portrait === undefined ? {} : { portrait: e.image.portrait }) },
    sections: e.sections
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.sectionKey, title: s.title, html: s.html })),
    faq: e.faq
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((f) => [f.question, f.answer] as [string, string]),
    related: e.relatedEntries
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((r) => {
        const slug = slugByEntryId.get(r.relatedEntryId);
        if (!slug) throw new Error(`${e.slug}: related entry ${r.relatedEntryId} is not in the registry`);
        return slug;
      }),
    products: e.links
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ label: l.label, href: l.href })),
  }));
}
