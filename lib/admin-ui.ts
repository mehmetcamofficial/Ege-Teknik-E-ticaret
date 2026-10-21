import { roleHasPermission, type AdminPermission } from "./security-policy.ts";

/**
 * Admin Panel V2 navigation and display vocabulary. Pure (no React, no DB) so the permission
 * filtering and label completeness are unit-testable. Every item names the permission the
 * EXISTING server-side check requires to use that module; hiding an item is a convenience, the
 * API routes remain the enforcement point.
 */
export type NavItem = { href: string; label: string; icon: NavIcon; permission: AdminPermission };
export type NavSection = { title: string | null; items: NavItem[] };
export type NavIcon = "dashboard" | "orders" | "service" | "products" | "secondHand" | "taxonomy" | "inventory" | "blog" | "reviews" | "legal" | "analytics" | "finance" | "payments" | "settings" | "users";

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
  { title: "Raporlama", items: [
    { href: "/admin/analytics", label: "Analitik", icon: "analytics", permission: "admin:read" },
    { href: "/admin/finance", label: "Finans", icon: "finance", permission: "admin:read" },
  ] },
  // Phase 6D.1: only super_admin holds users:read, so this section is invisible to every other role.
  { title: "Sistem", items: [
    { href: "/admin/users", label: "Kullanıcılar & Yetkiler", icon: "users", permission: "users:read" },
    { href: "/admin/integrations/payments", label: "Ödeme Sağlayıcıları", icon: "payments", permission: "integrations:read" },
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
/**
 * Payment status vocabulary = lib/finance.ts orderPaymentStatuses (derived from the payment ledger). Anything else is
 * shown verbatim, never guessed.
 */
export const paymentStatusLabel: Record<string, string> = {
  pending: "Bekliyor", partially_paid: "Kısmen ödendi", paid: "Ödendi", failed: "Başarısız", cancelled: "İptal",
  refunded: "İade edildi", partially_refunded: "Kısmen iade edildi",
};
export const paymentStatusTone: Record<string, Tone> = {
  pending: "warning", partially_paid: "info", paid: "success", failed: "danger", cancelled: "neutral", refunded: "neutral", partially_refunded: "info",
};

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

// ---- record-management actions ---------------------------------------------------------------------
/**
 * The record actions the admin panel can offer, with their exact Turkish labels. Every admin list/table
 * screen renders these from the SAME vocabulary, so a button never says one thing on one screen and
 * something else on another. Kept pure (no React) so the label set is unit-testable.
 */
export const recordActionLabel = {
  view: "Görüntüle",
  edit: "Düzenle",
  archive: "Arşivle",
  delete: "Sil",
  publish: "Yayınla",
} as const;
export type RecordActionKey = keyof typeof recordActionLabel;

/** Why an action is unavailable, shown instead of a button that silently does nothing. */
export const recordActionUnavailableReason = {
  /** Published legal versions are immutable in the database (migration 0005), not merely read-only in the UI. */
  legalPublishedImmutable: "Yayınlanmış sürüm veritabanında kilitlidir; değiştirilemez veya silinemez.",
  /** A second-hand listing with reservations must be archived or marked sold instead. */
  secondHandHasReservations: "Bu ilana rezervasyon bağlı olduğu için kalıcı olarak silinemez; 'Satıldı' yapın.",
  /** Taxonomy rows referenced by products keep their link; only unreferenced rows can be deleted. */
  taxonomyInUse: "Bağlı ürünleri olduğu için silinemez; önce ürünlerdeki bağlantıyı kaldırın.",
} as const;

/**
 * Per-resource capability matrix. This is the single source of truth for which actions a screen may
 * render, derived from what the EXISTING endpoints actually do - never from wishful CRUD symmetry.
 *
 * Full audit of every admin navigation entry (see docs/operations/admin-capability-matrix.md):
 *  - product:      PATCH + soft DELETE. Hard delete is deliberately absent: the inventory FK needs the row.
 *  - secondHand:   PATCH + archive (soft) + hard delete, refused with 409 when a reservation exists.
 *  - blogPost:     PATCH + archive (soft) + hard delete.
 *  - taxonomy:     POST + PATCH(active, name, slug) + guarded DELETE, refused with 409 while in use.
 *  - legalVersion: draft -> edit/publish/delete; published -> view only (hard DELETE refuses with 409).
 *                  No archive: see LEGAL_ARCHIVE_DECISION below.
 *  - order:        state-machine PATCH only. Never a delete - an order is financial + acceptance history.
 *  - serviceRequest: NO actions. There is no detail page and no single-record GET route
 *                  (app/api/admin/service-requests/[id]/route.ts is PATCH-only), and the list row already
 *                  renders every column of ServiceRequestListRow, so the row IS the complete record.
 *                  A "Görüntüle" button would have nowhere to point - reporting one would be a fake action.
 *  - review:        moderation transitions only; no edit/archive/delete (see the matrix doc).
 */
export type RecordResource = "product" | "secondHand" | "blogPost" | "legalVersion" | "taxonomy" | "order" | "serviceRequest" | "review" | "user" | "inventory";
export function recordActionsFor(resource: RecordResource, state?: { published?: boolean }): RecordActionKey[] {
  if (resource === "legalVersion") return state?.published ? ["view"] : ["edit", "publish", "delete"];
  if (resource === "product") return ["edit", "archive"];
  if (resource === "secondHand" || resource === "blogPost") return ["edit", "archive", "delete"];
  if (resource === "taxonomy") return ["edit", "delete"]; // PATCH now also renames (name/slug), so "Düzenle" is real
  if (resource === "order") return ["view"]; // status transitions live on the detail screen, guarded by the order state machine
  // Service requests and reviews have NO detail route/page, and their rows already show the whole record.
  if (resource === "serviceRequest" || resource === "review") return [];
  if (resource === "user") return ["edit", "archive"]; // disable/enable; there is deliberately no user delete
  return []; // inventory: stock is edited inline in the cell itself
}

/**
 * LEGAL ARCHIVE DECISION - no `Arşivle` on a legal draft, on purpose.
 *
 * A legal version's status is DERIVED (draft/scheduled/effective/superseded) and never stored, and
 * `legal_document_versions` has no archived/withdrawn column. Inventing one would mean a new column plus
 * a new write path for a table whose whole point is that a published row can never change again
 * (migration 0005's trigger fires on ANY update of a published row). A draft can already be removed
 * through the real, audited `Sil` path, so an archive flag would add a second, weaker way to do the same
 * thing and create drafts that look removable but are not. `Arşivle` is therefore deliberately absent
 * from the legal action set rather than faked.
 */
export const LEGAL_ARCHIVE_DECISION =
  "Hukuki belge sürümlerinde arşivleme uygulanmaz: durum türetilir, arşiv alanı yoktur ve yayınlanmış satırlar değiştirilemez. Taslaklar denetimli 'Sil' yoluyla kaldırılır.";

export const tryCurrency = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);
export const trDate = (value: string | Date | null | undefined, withTime = false) =>
  value ? new Date(value).toLocaleString("tr-TR", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }) : "—";
