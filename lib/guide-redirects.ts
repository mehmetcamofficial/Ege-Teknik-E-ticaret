/**
 * Klima Rehberi (Paket 1E): the old client-rendered guide addresses (article.html?slug=…) now live as
 * static pages under /rehber/. next.config.ts turns each entry into a permanent redirect; store-core.js
 * carries the same map as a client-side fallback (tests keep the two in sync).
 */
export const LEGACY_GUIDE_SLUGS: Record<string, string> = {
  "klima-btu-hesaplama": "klima-btu-hesaplama",
  "9000-btu-kac-metrekare": "btu-kapasite-farklari",
  "12000-btu-kac-metrekare": "btu-kapasite-farklari",
  "18000-btu-kac-metrekare": "btu-kapasite-farklari",
  "24000-btu-nerede-kullanilir": "btu-kapasite-farklari",
  "gree-serileri-karsilastirma": "gree-serileri-karsilastirma",
  "inverter-klima-nedir": "inverter-klima-nedir",
  "klima-elektrik-tuketimi": "enerji-sinifi-seer-scop",
  "enerji-sinifi-farki": "enerji-sinifi-seer-scop",
  "klima-neden-sogutmaz": "klima-neden-sogutmaz",
  "klima-neden-su-akitir": "klima-neden-su-akitir",
  "klima-bakimi-ne-zaman": "klima-bakimi-ne-zaman",
  "ikinci-el-klima-alinir-mi": "ikinci-el-klima-alinir-mi",
  "kusadasi-klima-secimi": "mekana-gore-klima-secimi",
  "yazlik-ev-klima-secimi": "mekana-gore-klima-secimi",
};

export function legacyGuideRedirects() {
  return Object.entries(LEGACY_GUIDE_SLUGS).map(([slug, target]) => ({
    source: "/article.html",
    has: [{ type: "query" as const, key: "slug", value: slug }],
    destination: `/rehber/${target}.html`,
    permanent: true,
  }));
}
