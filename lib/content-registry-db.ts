/**
 * Content registry DATABASE ADAPTER (P0-B / P1).
 *
 * This is the ONLY module in the content pipeline that may open a database connection. It is imported by
 * the importer and the exporter CLIs, never by the site, never by a generator, never by `next build`
 * (non-negotiable #1: the build must never read from the DB; the committed snapshot is canonical for it).
 *
 * `pg` is imported dynamically, inside the function that needs it, so merely importing this file — which
 * the pure-logic tests do — cannot pull a driver in or open a socket.
 */
import type {
  ContentEntryRow, ContentFaqRow, ContentLinkRow, ContentRelatedEntryRow, ContentRelatedProductRow,
  ContentRelatedServiceRow, ContentSectionRow, RegistryEntry, RegistryTables,
} from "./content-registry.ts";

/** The minimal surface this adapter needs from a pg client (Pool or a checked-out Client). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export const ENTRY_COLUMNS = [
  "id", "entry_type", "slug", "category", "title", "seo_title", "description", "lead", "answer",
  "image_key", "image_alt", "image_caption", "image_portrait", "status", "published_at", "content_hash", "source_ref",
] as const;

/** Reads the full registry in one deterministic pass, ordered by the canonical keys. */
export async function readRegistry(client: Queryable): Promise<RegistryTables> {
  const [entries, sections, faq, relatedEntries, links, relatedProducts, relatedServices] = await Promise.all([
    client.query(`SELECT ${ENTRY_COLUMNS.join(", ")} FROM content_entries ORDER BY id ASC`),
    client.query("SELECT entry_id, section_key, position, title, html FROM content_sections ORDER BY entry_id ASC, position ASC"),
    client.query("SELECT entry_id, position, question, answer FROM content_faq ORDER BY entry_id ASC, position ASC"),
    client.query("SELECT entry_id, related_entry_id, position, label FROM content_related_entries ORDER BY entry_id ASC, position ASC"),
    client.query("SELECT entry_id, position, label, href, link_kind FROM content_links ORDER BY entry_id ASC, position ASC"),
    client.query("SELECT entry_id, product_id, position, label FROM content_related_products ORDER BY entry_id ASC, position ASC"),
    client.query("SELECT entry_id, service_slug, position, label FROM content_related_services ORDER BY entry_id ASC, position ASC"),
  ]);
  return {
    entries: entries.rows as unknown as ContentEntryRow[],
    sections: sections.rows as unknown as ContentSectionRow[],
    faq: faq.rows as unknown as ContentFaqRow[],
    relatedEntries: relatedEntries.rows as unknown as ContentRelatedEntryRow[],
    links: links.rows as unknown as ContentLinkRow[],
    relatedProducts: relatedProducts.rows as unknown as ContentRelatedProductRow[],
    relatedServices: relatedServices.rows as unknown as ContentRelatedServiceRow[],
  };
}

/** Batched parameterized insert. Parameter numbering is positional and therefore injection-safe. */
async function insertMany(client: Queryable, table: string, columns: readonly string[], rows: Record<string, unknown>[]) {
  if (!rows.length) return 0;
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const placeholders = columns.map((column, columnIndex) => {
      values.push(row[column] ?? null);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, values);
  return rows.length;
}

const GUIDE_SCOPED = `entry_id IN (SELECT id FROM content_entries WHERE entry_type = 'guide')`;

/**
 * Writes entries into the registry inside ONE transaction, replacing the guide-owned rows.
 *
 * Scope discipline: it deletes and rewrites ONLY rows whose entry_type is 'guide' — the 16 entries this
 * migration owns. It never touches products, categories, orders, legal documents or any other table, and
 * it is idempotent: re-running the same guides produces the same rows.
 *
 * The 16 SLUGS ARE FROZEN. An import that would change a slug is refused, because the public URLs
 * /rehber/<slug>.html must remain unchanged (non-negotiable #5 / #6).
 */
export async function writeRegistry(
  client: Queryable,
  entries: RegistryEntry[],
  tables: RegistryTables,
  options: { existingSlugsById?: Map<string, string> } = {},
): Promise<{ counts: Record<string, number> }> {
  const frozen = options.existingSlugsById;
  if (frozen) {
    for (const entry of entries) {
      const existing = frozen.get(entry.id);
      if (existing !== undefined && existing !== entry.slug) {
        throw new Error(`refusing to change the frozen slug of ${entry.id}: "${existing}" -> "${entry.slug}"`);
      }
    }
  }
  await client.query("BEGIN");
  try {
    // Children first (FK), then parents: the guide-owned subtree is replaced wholesale.
    for (const table of ["content_links", "content_related_entries", "content_related_products", "content_related_services", "content_faq", "content_sections"]) {
      await client.query(`DELETE FROM ${table} WHERE ${GUIDE_SCOPED}`);
    }
    await client.query("DELETE FROM content_entries WHERE entry_type = 'guide'");

    const counts: Record<string, number> = {};
    counts.entries = await insertMany(client, "content_entries", ENTRY_COLUMNS, tables.entries as unknown as Record<string, unknown>[]);
    counts.sections = await insertMany(client, "content_sections", ["entry_id", "section_key", "position", "title", "html"], tables.sections as unknown as Record<string, unknown>[]);
    counts.faq = await insertMany(client, "content_faq", ["entry_id", "position", "question", "answer"], tables.faq as unknown as Record<string, unknown>[]);
    counts.relatedEntries = await insertMany(client, "content_related_entries", ["entry_id", "related_entry_id", "position", "label"], tables.relatedEntries as unknown as Record<string, unknown>[]);
    counts.links = await insertMany(client, "content_links", ["entry_id", "position", "label", "href", "link_kind"], tables.links as unknown as Record<string, unknown>[]);
    counts.relatedProducts = await insertMany(client, "content_related_products", ["entry_id", "product_id", "position", "label"], tables.relatedProducts as unknown as Record<string, unknown>[]);
    counts.relatedServices = await insertMany(client, "content_related_services", ["entry_id", "service_slug", "position", "label"], tables.relatedServices as unknown as Record<string, unknown>[]);
    await client.query("COMMIT");
    return { counts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Current entry id -> slug map, used to enforce the frozen-slug rule before writing. */
export async function readEntrySlugs(client: Queryable): Promise<Map<string, string>> {
  const { rows } = await client.query("SELECT id, slug FROM content_entries WHERE entry_type = 'guide'");
  return new Map((rows as { id: string; slug: string }[]).map((r) => [r.id, r.slug]));
}

/** Records an export in the ledger so a committed snapshot can be traced back to its content hash. */
export async function recordExport(client: Queryable, row: { id: string; targetPath: string; contentHash: string; entryCount: number; generatedBy: string }): Promise<void> {
  await client.query(
    `INSERT INTO content_exports (id, target_path, content_hash, entry_count, generated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET target_path = EXCLUDED.target_path, content_hash = EXCLUDED.content_hash, entry_count = EXCLUDED.entry_count`,
    [row.id, row.targetPath, row.contentHash, row.entryCount, row.generatedBy],
  );
}

/** Fails closed when migration 0014 has not been applied to the target database. */
export async function assertRegistrySchema(client: Queryable): Promise<void> {
  const required = [
    "content_entries", "content_sections", "content_faq", "content_related_entries", "content_links",
    "content_related_products", "content_related_services", "content_versions", "content_exports", "content_redirects",
  ];
  const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)", [required]);
  const found = new Set((rows as { table_name: string }[]).map((r) => r.table_name));
  const missing = required.filter((t) => !found.has(t));
  if (missing.length) throw new Error(`migration 0014 (content registry) is not applied; missing tables: ${missing.join(", ")}`);
}

/** Opens a pg pool. Only called from the CLIs, never at module load. */
export async function createPool(connectionString: string) {
  const { default: pg } = await import("pg");
  return new pg.Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: true } });
}

