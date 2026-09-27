import { readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowLeftRight,
  ArrowRight,
  Award,
  BadgeCheck,
  Building2,
  Calculator,
  CalendarDays,
  CircleDot,
  Cog,
  Fan,
  Gauge,
  Grid2X2,
  Hammer,
  Headphones,
  Heart,
  Info,
  MapPin,
  MessageCircle,
  Network,
  Package,
  Phone,
  Ruler,
  Search,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Truck,
  User,
  Wrench,
} from "lucide-react";
import { compile } from "tailwindcss";

const INDEX_PATH = new URL("../public/index.html", import.meta.url);
const TAILWIND_DIR = new URL("../node_modules/tailwindcss/", import.meta.url);
const OUTPUT_PATH = new URL("../public/home.css", import.meta.url);

const html = await readFile(INDEX_PATH, "utf8");

function collectCandidates(source) {
  const candidates = new Set();
  const patterns = [
    /\bclass\s*=\s*["']([^"']+)["']/g,
    /\bclassName\s*=\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      for (const token of match[1].split(/\s+/)) {
        if (token) candidates.add(token);
      }
    }
  }
  return [...candidates];
}

const materialToLucide = {
  ac_unit: Snowflake,
  apartment: Building2,
  arrow_forward: ArrowRight,
  award_star: Award,
  build: Wrench,
  build_circle: Wrench,
  calculate: Calculator,
  calendar_month: CalendarDays,
  calendar_today: CalendarDays,
  call: Phone,
  chat: MessageCircle,
  favorite: Heart,
  grid_view: Grid2X2,
  handyman: Hammer,
  headset_mic: Headphones,
  home_repair_service: Wrench,
  hub: Network,
  hvac: Fan,
  info: Info,
  inventory_2: Package,
  local_shipping: Truck,
  location_on: MapPin,
  person: User,
  precision_manufacturing: Cog,
  sanitizer: Sparkles,
  search: Search,
  shield: Shield,
  shopping_bag: ShoppingBag,
  speed: Gauge,
  straightening: Ruler,
  straighten: Ruler,
  support_agent: Headphones,
  swap_horiz: ArrowLeftRight,
  verified: BadgeCheck,
  verified_user: ShieldCheck,
};

function replaceMaterialSymbols(source) {
  return source.replace(
    /<span\s+class="material-symbols-outlined([^\"]*)"([^>]*)>([^<]+)<\/span>/g,
    (_match, extraClasses, extraAttributes, rawName) => {
      const name = rawName.trim();
      const Icon = materialToLucide[name] ?? CircleDot;
      const className = extraClasses.trim();
      const svg = renderToStaticMarkup(
        createElement(Icon, {
          "aria-hidden": "true",
          focusable: "false",
          size: "1em",
          strokeWidth: 2,
          className: className || undefined,
        }),
      );
      if (!extraAttributes.includes("aria-label")) return svg;
      return svg.replace("<svg", `<svg${extraAttributes}`);
    },
  );
}

const [themeCss, preflightCss, utilitiesCss] = await Promise.all([
  readFile(new URL("theme.css", TAILWIND_DIR), "utf8"),
  readFile(new URL("preflight.css", TAILWIND_DIR), "utf8"),
  readFile(new URL("utilities.css", TAILWIND_DIR), "utf8"),
]);

const customTheme = String.raw`
@theme {
  --color-on-secondary-fixed: #002113;
  --color-badge-secondhand-dark-bg: #1E293B;
  --color-secondary-fixed: #6ffbbe;
  --color-error: #ba1a1a;
  --color-error-container: #ffdad6;
  --color-inverse-on-surface: #ebf2f0;
  --color-on-tertiary-container: #3fa1e6;
  --color-on-tertiary-fixed-variant: #004b73;
  --color-surface-container-highest: #dde4e2;
  --color-inverse-surface: #2b3231;
  --color-badge-brand-new-bg: #ECFDF5;
  --color-whatsapp-green: #0F7A42;
  --color-secondary-container: #6cf8bb;
  --color-surface-cooling: #EBF1F0;
  --color-surface-bright: #f4fbf9;
  --color-on-surface-variant: #414845;
  --color-status-amber: #D97706;
  --color-on-secondary-fixed-variant: #005236;
  --color-primary-container: #0f382e;
  --color-border-subtle: #E2E8F0;
  --color-tertiary-container: #003554;
  --color-surface-cooling-subtle: #F0FDF4;
  --color-surface-container-lowest: #ffffff;
  --color-on-secondary: #ffffff;
  --color-outline-variant: #c0c8c4;
  --color-primary-fixed: #c1ecdd;
  --color-surface-tint: #3f665a;
  --color-surface-container-high: #e2eae8;
  --color-on-primary: #ffffff;
  --color-primary: #00221a;
  --color-secondary-fixed-dim: #4edea3;
  --color-surface-dim: #d4dcd9;
  --color-on-tertiary: #ffffff;
  --color-badge-secondhand-dark-text: #F8FAFC;
  --color-badge-brand-new-text: #065F46;
  --color-surface-warm: #FBFBF9;
  --color-tertiary-fixed: #cce5ff;
  --color-primary-fixed-dim: #a6cfc1;
  --color-inverse-primary: #a6cfc1;
  --color-background: #f4fbf9;
  --color-surface: #f4fbf9;
  --color-border-cooling: #CFE4E1;
  --color-on-surface: #161d1c;
  --color-badge-secondhand-bg: #FEF3C7;
  --color-on-error: #ffffff;
  --color-on-primary-fixed-variant: #274e43;
  --color-surface-variant: #dde4e2;
  --color-cooling-tint: #E0F2FE;
  --color-tertiary: #001f34;
  --color-secondary: #006c49;
  --color-surface-container: #e8efed;
  --color-on-secondary-container: #00714d;
  --color-surface-container-low: #eef5f3;
  --color-on-background: #161d1c;
  --color-on-primary-container: #7aa295;
  --color-badge-secondhand-text: #92400E;
  --color-on-error-container: #93000a;
  --color-on-primary-fixed: #002019;
  --color-outline: #717975;
  --color-on-tertiary-fixed: #001d31;
  --color-tertiary-fixed-dim: #93ccff;

  --spacing-margin: 2.5rem;
  --spacing-space-3xl: 6rem;
  --spacing-space-lg: 1.5rem;
  --spacing-gutter: 1.5rem;
  --spacing-space-md: 1rem;
  --spacing-space-xs: 0.5rem;
  --spacing-space-sm: 0.75rem;
  --spacing-margin-mobile: 1rem;
  --spacing-space-xl: 2.5rem;
  --spacing-gutter-mobile: 0.75rem;
  --spacing-space-2xs: 0.25rem;
  --spacing-space-2xl: 4rem;

  --font-metric-display: ui-sans-serif, system-ui, sans-serif;
  --font-display-lg-mobile: ui-sans-serif, system-ui, sans-serif;
  --font-body-sm: ui-sans-serif, system-ui, sans-serif;
  --font-headline-xl: ui-sans-serif, system-ui, sans-serif;
  --font-label-md: ui-sans-serif, system-ui, sans-serif;
  --font-body-md: ui-sans-serif, system-ui, sans-serif;
  --font-headline-md: ui-sans-serif, system-ui, sans-serif;
  --font-headline-sm: ui-sans-serif, system-ui, sans-serif;
  --font-body-lg: ui-sans-serif, system-ui, sans-serif;
  --font-label-sm: ui-sans-serif, system-ui, sans-serif;
  --font-headline-xl-mobile: ui-sans-serif, system-ui, sans-serif;
  --font-display-lg: ui-sans-serif, system-ui, sans-serif;
  --font-headline-lg: ui-sans-serif, system-ui, sans-serif;
  --font-metric-label: ui-sans-serif, system-ui, sans-serif;

  --text-metric-display: 32px;
  --text-metric-display--line-height: 36px;
  --text-display-lg-mobile: 36px;
  --text-display-lg-mobile--line-height: 44px;
  --text-body-sm: 13px;
  --text-body-sm--line-height: 20px;
  --text-headline-xl: 40px;
  --text-headline-xl--line-height: 48px;
  --text-label-md: 14px;
  --text-label-md--line-height: 20px;
  --text-body-md: 15px;
  --text-body-md--line-height: 24px;
  --text-headline-md: 22px;
  --text-headline-md--line-height: 30px;
  --text-headline-sm: 18px;
  --text-headline-sm--line-height: 26px;
  --text-body-lg: 17px;
  --text-body-lg--line-height: 26px;
  --text-label-sm: 12px;
  --text-label-sm--line-height: 16px;
  --text-headline-xl-mobile: 28px;
  --text-headline-xl-mobile--line-height: 36px;
  --text-display-lg: 56px;
  --text-display-lg--line-height: 64px;
  --text-headline-lg: 30px;
  --text-headline-lg--line-height: 38px;
  --text-metric-label: 12px;
  --text-metric-label--line-height: 16px;
}
`;

const sourceCss = `@layer theme {${themeCss}}\n@layer base {${preflightCss}}\n${customTheme}\n${utilitiesCss}`;
const compiler = await compile(sourceCss);
const generated = compiler.build(collectCandidates(html));

await writeFile(OUTPUT_PATH, generated, "utf8");

let outputHtml = replaceMaterialSymbols(html)
  .replace(/<link href="https:\/\/fonts\.googleapis\.com" rel="preconnect">\s*/g, "")
  .replace(/<link crossorigin="" href="https:\/\/fonts\.gstatic\.com" rel="preconnect">\s*/g, "")
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=[^"]+" rel="stylesheet">\s*/g, "")
  .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/g, "")
  .replace(/<script id="tailwind-config">[\s\S]*?<\/script>\s*/g, "")
  .replace("https://lh3.googleusercontent.com/aida-public/AB6AXuAPXAQVcmh9ZnQt48l2CH1dbn8QkO6Mjoa2eW9ToEezm-6606zJBlMutbIYDMOOEhdsfcOupa_5ea39hZ4IT_KA8BC_Xm5L9dBDcAARNgxxOMs0ygxcL1aV2QoDNjmF5wyazqzH3-EolNpVcx5pvGYu_ol4QPzW4FE6goOCe_v6LEpgfn0PnpjmQZ3DLH3wsXND7DYWKFhc3SuVUThP3dYdtu9SBk3jNXvIw1y0sl-pk_HYQYbEjYtg5g", "assets/home/hero-aegean-ac.svg")
  .replace("https://lh3.googleusercontent.com/aida-public/AB6AXuBZVBqUxIRbwQqYAQBrJyaBMAz7RZeagfkZ_6F-7T9ONyi4O3txjOolQIgvteRrHbVVZRq2U9WQM-h3tXqs3RdsokANxslKFxPchrQ9zb_eqm5n0UwG694BpIpvUl0AMtS8lD46qXFG2PW6BgdB_jCn2xEJy4QDoqy8qIiX8--pKNUEa8sMg60aND5W66eJdW22ed9fCt5YvS4_PKFaKDeZ4fODl5LWlmPrvjwWWhaJy3hA7QyLj_L6ZA", "assets/home/gree-airy-representative.svg")
  .replace("https://lh3.googleusercontent.com/aida-public/AB6AXuCX18xwY2nPCBBIZaMd9TcLW5oRueGb7CGCgnjpNyYbTYRuQh74maMMcvBJY6AGQRautRF71sUE9wHwAzLHcK0CrRCDkAJKfuPuUEK2mY5E9NmXdvHd3h2amAYJ5UguVZ-4Bf8pIw7b_XXW66MewNNC0pPFewzovTaH8yX4JYAnvZCkJ4HK4OfNCXu-RHBEPH_UW0iwkgy17BEBcfc83Wc7km9Cu01F45e7s5N4BDmQVMU94uRDO_GWuQ", "assets/home/gree-fairy-representative.svg");

if (!outputHtml.includes('href="home.css"')) {
  outputHtml = outputHtml.replace("</head>", '<link rel="stylesheet" href="home.css"></head>');
}

await writeFile(INDEX_PATH, outputHtml, "utf8");
console.log(`Compiled homepage CSS with ${collectCandidates(html).length} candidates and localized Material Symbols.`);
