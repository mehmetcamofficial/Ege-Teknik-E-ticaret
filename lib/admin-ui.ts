import { roleHasPermission, type AdminPermission } from "./security-policy.ts";

/**
 * Admin Panel V2 navigation and display vocabulary. Pure (no React, no DB) so the permission
 * filtering and label completeness are unit-testable. Every item names the permission the
 * EXISTING server-side check requires to use that module; hiding an item is a convenience, the
 * API routes remain the enforcement point.
 */
export type NavItem = { href: string; label: string; icon: NavIcon; permission: AdminPermission };
export type NavSection = { title: string | null; items: NavItem[] };
export type NavIcon = "dashboard" | "orders" | "service" | "products" | "secondHand" | "taxonomy" | "inventory" | "blog" | "reviews" | "legal" | "analytics" | "settings" | "users";

export const ADMIN_NAV: readonly NavSection[] = [
  { title: null, items: [{ href: "/admin", label: "Genel Bakış", icon: "dashboard", permission: "admin:read" }] },
  { title: "Satış", items: [
    { href: "/admin/orders", label: "Siparişler", icon: "orders", permission: "admin:read" },
    { href: "/admin/service-requests", label: "Servis & Keşif", icon: "service", permission: "admin:read" },
  ] },
  { title: "Katalog", items: [
    { href: "/admin/products", label: "Ürünler", icon: "products", permission: "admin:read" },
    { href: "/admin/second-hand", label: "İkinci El / Outlet", icon: "secondHand", permission: "admin:read" },
    { href: "/admin/catalog-taxonomy", label: "Kategoriler & Markalar", icon: "taxonomy", permission: "admin:read" },
    { href: "/admin/inventory", label: "Stok Yönetimi", icon: "inventory", permission: "admin:read" },
  ] },
  { title: "İçerik", items: [
    { href: "/admin/blog", label: "Blog", icon: "blog", permission: "admin:read" },
    // Both of these are write-gated for READS too on the server (reviews GET, every legal route).
    { href: "/admin/reviews", label: "Yorumlar", icon: "reviews", permission: "content:write" },
    { href: "/admin/legal", label: "Hukuki Belgeler", icon: "legal", permission: "legal:write" },
  ] },
  { title: "Raporlama", items: [{ href: "/admin/analytics", label: "Analitik", icon: "analytics", permission: "admin:read" }] },
  // Phase 6D.1: only super_admin holds users:read, so this section is invisible to every other role.
  { title: "Sistem", items: [
    { href: "/admin/users", label: "Kullanıcılar & Yetkiler", icon: "users", permission: "users:read" },
    { href: "/admin/settings", label: "Ayarlar", icon: "settings", permission: "admin:read" },
  ] },
];

/** Sections with no permitted item disappear entirely. */
export function visibleNav(role: string): NavSection[] {
  return ADMIN_NAV.map((s) => ({ ...s, items: s.items.filter((i) => roleHasPermission(role, i.permission)) })).filter((s) => s.items.length > 0);
}

/** Longest-prefix match, so /admin/products/new highlights "Ürünler" and /admin highlights only itself. */
export function activeNavHref(pathname: string, sections: readonly NavSection[]): string | null {
  const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const matches = hrefs.filter((h) => pathname === h || (h !== "/admin" && pathname.startsWith(h + "/")));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export const roleLabel: Record<string, string> = {
  super_admin: "Süper Yönetici", admin: "Yönetici",
  owner: "Sahip (devredışı, legacy)", operations_manager: "Operasyon Yöneticisi", catalog_manager: "Katalog Yöneticisi", support_agent: "Destek Uzmanı", viewer: "İzleyici",
};
export const permissionLabel: Record<AdminPermission, string> = {
  "admin:read": "Yönetim panelini görüntüleme", "catalog:write": "Katalog ve stok düzenleme", "orders:write": "Sipariş durumu güncelleme",
  "service:write": "Servis talebi güncelleme", "content:write": "Blog ve yorum yönetimi", "legal:write": "Hukuki belge yayınlama",
  "users:read": "Kullanıcıları görüntüleme", "users:write": "Kullanıcı davet/yönetim", "roles:write": "Rol ve süreli yetki yönetimi",
  "integrations:read": "Entegrasyon durumunu görüntüleme", "integrations:write": "Entegrasyon yapılandırma",
  "payments:configure": "Ödeme sağlayıcı yapılandırma (yalnızca Süper Yönetici)", "security:write": "Güvenlik yapılandırması", "audit:read": "Denetim kayıtlarını görüntüleme",
};

// ---- status vocabulary ----------------------------------------------------------------------------
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Keys must equal lib/order-domain.ts orderStatuses (enforced by tests/admin-ui.test.ts). */
export const orderStatusLabel: Record<string, string> = {
  pending_payment: "Ödeme bekliyor", paid: "Ödendi", preparing: "Hazırlanıyor", shipped: "Kargoya verildi", delivery: "Teslimatta",
  delivered: "Teslim edildi", installation: "Montaj", completed: "Tamamlandı", cancelled: "İptal", returned: "İade", service: "Servis",
};
export const orderStatusTone: Record<string, Tone> = {
  pending_payment: "warning", paid: "info", preparing: "info", shipped: "info", delivery: "info", delivered: "success",
  installation: "info", completed: "success", cancelled: "danger", returned: "danger", service: "warning",
};
/** Only values the checkout actually writes are named; anything else is shown verbatim, never guessed. */
export const paymentStatusLabel: Record<string, string> = { pending: "Bekliyor", paid: "Ödendi", failed: "Başarısız", refunded: "İade edildi" };

export const serviceStatuses = ["new", "contacted", "scheduled", "completed", "cancelled"] as const;
export const serviceStatusLabel: Record<string, string> = { new: "Yeni", contacted: "Arandı", scheduled: "Planlandı", completed: "Tamamlandı", cancelled: "İptal" };
export const serviceStatusTone: Record<string, Tone> = { new: "warning", contacted: "info", scheduled: "info", completed: "success", cancelled: "neutral" };
export const OPEN_SERVICE_STATUSES = ["new", "contacted", "scheduled"] as const;

export const publishLabel: Record<string, string> = { draft: "Taslak", published: "Yayında", sold: "Satıldı" };
export const publishTone: Record<string, Tone> = { draft: "neutral", published: "success", sold: "info" };

// ---- stock ----------------------------------------------------------------------------------------
/**
 * Display-only threshold for the "az stok" warning - there was no stock threshold anywhere before
 * this, so it is stated in the UI rather than presented as a business rule. Stock only matters for
 * products the storefront sells online (store.js: `sale: saleMode === 'online'`), and only while
 * published; quote/discovery/WhatsApp products never show a stock warning.
 */
export const LOW_STOCK_THRESHOLD = 3;
export type StockLevel = "ok" | "low" | "out" | "untracked";
export function stockLevel(p: { stock: number; status: string; saleMode: string }): StockLevel {
  if (p.status !== "published" || p.saleMode !== "online") return "untracked";
  if (p.stock <= 0) return "out";
  return p.stock <= LOW_STOCK_THRESHOLD ? "low" : "ok";
}
export const stockLabel: Record<StockLevel, string> = { ok: "Stokta", low: "Az stok", out: "Tükendi", untracked: "Takip dışı" };
export const stockTone: Record<StockLevel, Tone> = { ok: "success", low: "warning", out: "danger", untracked: "neutral" };

export const tryCurrency = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);
export const trDate = (value: string | Date | null | undefined, withTime = false) =>
  value ? new Date(value).toLocaleString("tr-TR", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }) : "—";
