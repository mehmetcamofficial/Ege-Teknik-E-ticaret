/**
 * Public product slugs, prepared but NOT wired into any route.
 *
 * Product ids are immutable (orders, inventory and carts reference them). Today a product's slug equals its id and the storefront
 * addresses products by `?id=`. These are the 12 reviewed, required OLD -> NEW proposals (9 identifiers containing "montaj-dahil" and
 * 3 whose capacity number contradicts the official model). They are lookup aliases only: nothing here renames an id or issues a redirect.
 * Any future redirect must stay temporary until the new product route is verified.
 */
export const PRODUCT_SLUG_REDIRECTS: Readonly<Record<string, string>> = {
  "gree-aphro-a-18-000-btu-duvar-tipi-inverter-klima-montaj-dahil-31": "aphro-18000-btu",
  "gree-aphro-a-24-000-btu-duvar-tipi-inverter-klima-montaj-dahil-25": "aphro-24000-btu",
  "gree-fairy-a-12-000-btu-duvar-tipi-inverter-klima-beyaz-montaj-dahil-11": "fairy-12000-btu-beyaz",
  "gree-fairy-a-18-000-btu-duvar-tipi-inverter-klima-beyaz-montaj-dahil-30": "fairy-18000-btu-beyaz",
  "gree-fairy-a-18-000-btu-duvar-tipi-inverter-klima-siyah-montaj-dahil-16": "fairy-18000-btu-antrasit",
  "gree-fairy-a-24-000-btu-duvar-tipi-inverter-klima-beyaz-montaj-dahil-24": "fairy-24000-btu-beyaz",
  "gree-fairy-a-24-000-btu-duvar-tipi-inverter-klima-siyah-montaj-dahil-15": "fairy-24000-btu-antrasit",
  "gree-fairy-a-9-000-btu-duvar-tipi-inverter-klima-beyaz-montaj-dahil-5": "fairy-9000-btu-beyaz",
  "gree-fairy-a-9-000-btu-duvar-tipi-inverter-klima-siyah-montaj-dahil-29": "fairy-9000-btu-antrasit",
  "multi-duvar-tipi-amber-ic-unite-24000-btu-h": "multi-duvar-tipi-amber-ic-unite-9000-btu-h",
  "multi-duvar-tipi-fairy-ic-unite-12000-btu-h": "multi-duvar-tipi-fairy-ic-unite-18000-btu-h",
  "multi-sistem-klima-dis-unitesi-r32-48000-btu-h": "multi-sistem-klima-dis-unitesi-r32-42000-btu-h",
};

export type ProductIdentifierResolution =
  | { status: "product"; productId: string; canonicalSlug: string | null; viaAlias: boolean }
  | { status: "not-found" };

/**
 * Resolves a public identifier (a product id, or a proposed new slug) to exactly one existing product.
 * The immutable id always wins, so an existing id can never be shadowed by an alias.
 */
export function resolveProductIdentifier(identifier: string, knownIds: ReadonlySet<string>, redirects: Readonly<Record<string, string>> = PRODUCT_SLUG_REDIRECTS): ProductIdentifierResolution {
  if (knownIds.has(identifier)) return { status: "product", productId: identifier, canonicalSlug: redirects[identifier] ?? null, viaAlias: false };
  const matches = Object.entries(redirects).filter(([, slug]) => slug === identifier).map(([id]) => id).filter((id) => knownIds.has(id));
  return matches.length === 1 ? { status: "product", productId: matches[0], canonicalSlug: identifier, viaAlias: true } : { status: "not-found" };
}
