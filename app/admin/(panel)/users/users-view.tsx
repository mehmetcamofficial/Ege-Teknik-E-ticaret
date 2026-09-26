"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { sendAdmin, useAdminJson } from "@/components/admin/use-admin-data";
import { ADMIN_INVITE_MAX_TTL_HOURS, OPERATIONAL_GRANT_PRESETS_HOURS, PRIVILEGED_GRANT_PERMISSIONS, adminPermissions, maxGrantTtlHours, type AdminPermission, type AdminRole } from "@/lib/security-policy";
import { permissionLabel, roleLabel } from "@/lib/admin-ui";

type Grant = { id: string; permission: string; expiresAt: string };
type ManagedUser = { id: string; email: string; role: string; active: boolean; lastLoginAt: string | null; lastActivityAt: string | null; createdAt: string; grants: Grant[] };
type PendingInvite = { id: string; email: string; role: string; expiresAt: string; createdAt: string };
type AuditEntry = { id: string; actorEmail: string; action: string; entityType: string; entityId: string; createdAt: string };

/** Roles a Super Admin may hand out. The retired "owner" role is deliberately absent. */
const ASSIGNABLE: readonly { value: AdminRole; label: string }[] = [
  { value: "super_admin", label: roleLabel.super_admin },
  { value: "admin", label: roleLabel.admin },
  { value: "operations_manager", label: roleLabel.operations_manager },
  { value: "catalog_manager", label: roleLabel.catalog_manager },
  { value: "support_agent", label: roleLabel.support_agent },
  { value: "viewer", label: roleLabel.viewer },
];

/** Grantable permissions: everything super_admin holds EXCEPT payments:configure, which is never grantable. */
const GRANTABLE = (adminPermissions.super_admin as readonly AdminPermission[]).filter((p) => p !== "payments:configure");
const isPrivilegedPermission = (p: string) => (PRIVILEGED_GRANT_PERMISSIONS as readonly string[]).includes(p);

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const fmt = (v: string | null | undefined) => (v ? dateFmt.format(new Date(v)) : "—");
const hoursLabel = (h: number) => (h >= 24 ? `${h / 24} gün` : `${h} saat`);
const INVITE_TTL_PRESETS = [8, 24, 48, 72];

/**
 * Kullanıcılar & Yetkiler. Every action posts to a route that re-checks the same
 * permission server-side; the capability props below only decide what is rendered.
 * The invitation token never reaches the browser: it exists only in the e-mail.
 */
export default function UsersView({ canManageUsers, canAssignRoles, selfId }: { canManageUsers: boolean; canAssignRoles: boolean; selfId: string }) {
  const users = useAdminJson<{ users: ManagedUser[] }>("/api/admin/users");
  const invites = useAdminJson<{ invites: PendingInvite[] }>("/api/admin/users/invites");
  const audit = useAdminJson<{ entries: AuditEntry[] }>("/api/admin/audit?limit=25");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AdminRole>("admin");
  const [inviteTtl, setInviteTtl] = useState(24);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [roleDrafts, setRoleDrafts] = useState<Record<string, AdminRole>>({});
  const [confirm, setConfirm] = useState<null | { kind: "status" | "role" | "revoke"; user: ManagedUser; role?: AdminRole; grant?: Grant }>(null);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUser, setGrantUser] = useState<ManagedUser | null>(null);
  const [grantPermission, setGrantPermission] = useState<AdminPermission>("orders:write");
  const [grantTtl, setGrantTtl] = useState(8);
  const [grantReason, setGrantReason] = useState("");

  const rows = useMemo(() => users.data?.users ?? [], [users.data]);
  const activeSuperAdmins = rows.filter((u) => u.active && u.role === "super_admin").length;
  const pendingInvites = invites.data?.invites ?? [];
  const auditEntries = audit.data?.entries ?? [];
  const grantCeiling = maxGrantTtlHours(grantPermission);

  const reloadAll = () => { users.reload(); invites.reload(); audit.reload(); };
  const fail = (text: string) => { toast.error(text); setError(text); };

  /**
   * Row primitives shared by the desktop table and the mobile card list, so both
   * presentations render the same data, the same permission checks and the same actions.
   * `scope` keeps every id unique because only one of the two presentations is visible.
   */
  const isLastSuperAdmin = (u: ManagedUser) => u.active && u.role === "super_admin" && activeSuperAdmins <= 1;
  const roleControl = (u: ManagedUser, scope: string) => {
    const draft = roleDrafts[u.id] ?? (u.role as AdminRole);
    if (!canAssignRoles) return <StatusBadge tone={u.role === "super_admin" ? "info" : "neutral"}>{roleLabel[u.role] ?? u.role}</StatusBadge>;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`role-${scope}-${u.id}`} className="sr-only">{u.email} rolü</label>
        <select
          id={`role-${scope}-${u.id}`}
          className={`${selectClass} sm:w-52`}
          value={draft}
          onChange={(e) => setRoleDrafts((d) => ({ ...d, [u.id]: e.target.value as AdminRole }))}
        >
          {ASSIGNABLE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {draft !== u.role ? <Button size="sm" onClick={() => setConfirm({ kind: "role", user: u, role: draft })}>Uygula</Button> : null}
      </div>
    );
  };
  const grantChips = (u: ManagedUser) => (
    u.grants.length ? (
      <ul className="flex flex-wrap gap-1.5">
        {u.grants.map((g) => (
          <li key={g.id}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-200">
              {permissionLabel[g.permission as AdminPermission] ?? g.permission}
              <span className="font-normal">· {fmt(g.expiresAt)}</span>
              {canAssignRoles ? (
                <button type="button" onClick={() => setConfirm({ kind: "revoke", user: u, grant: g })} className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">sonlandır</button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    ) : <span className="text-sm text-muted-foreground">—</span>
  );
  const rowActions = (u: ManagedUser) => (
    <div className="flex flex-wrap justify-end gap-2">
      {canAssignRoles ? (
        <Button size="sm" variant="outline" onClick={() => { setGrantUser(u); setGrantPermission("orders:write"); setGrantTtl(8); setGrantOpen(true); }}>Geçici yetki</Button>
      ) : null}
      {canManageUsers ? (
        <Button
          size="sm"
          variant={u.active ? "destructive" : "outline"}
          title={isLastSuperAdmin(u) ? "Son aktif Süper Yönetici devre dışı bırakılamaz." : undefined}
          onClick={() => setConfirm({ kind: "status", user: u })}
        >
          {u.active ? "Devre dışı bırak" : "Etkinleştir"}
        </Button>
      ) : null}
    </div>
  );

  async function submitInvite() {
    setBusy(true);
    const r = await sendAdmin("/api/admin/users/invites", "POST", { email: inviteEmail, role: inviteRole, ttlHours: inviteTtl });
    setBusy(false);
    if (!r.ok) { fail(r.error || "Davet gönderilemedi."); return; }
    toast.success(`${inviteEmail} adresine ${hoursLabel(inviteTtl)} geçerli davet gönderildi.`);
    setError(null); setInviteOpen(false); setInviteEmail(""); reloadAll();
  }

  async function submitGrant() {
    if (!grantUser) return;
    setBusy(true);
    const r = await sendAdmin(`/api/admin/users/${grantUser.id}/grants`, "POST", { permission: grantPermission, ttlHours: grantTtl, reason: grantReason });
    setBusy(false);
    if (!r.ok) { fail(r.error || "Geçici yetki verilemedi."); return; }
    toast.success(`${grantUser.email} kullanıcısına ${permissionLabel[grantPermission]} yetkisi ${hoursLabel(grantTtl)} süreyle verildi.`);
    setError(null); setGrantOpen(false); setGrantReason(""); reloadAll();
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    let r: Awaited<ReturnType<typeof sendAdmin>> | undefined;
    if (confirm.kind === "status") r = await sendAdmin(`/api/admin/users/${confirm.user.id}/status`, "POST", { active: !confirm.user.active, confirm: true });
    else if (confirm.kind === "role" && confirm.role) r = await sendAdmin(`/api/admin/users/${confirm.user.id}/role`, "POST", { role: confirm.role, confirm: true });
    else if (confirm.kind === "revoke" && confirm.grant) r = await sendAdmin(`/api/admin/users/grants/${confirm.grant.id}/revoke`, "POST");
    setBusy(false);
    if (!r) { setConfirm(null); return; }
    if (!r.ok) { fail(r.error || "İşlem tamamlanamadı."); setConfirm(null); return; }
    toast.success(
      confirm.kind === "status"
        ? (confirm.user.active ? `${confirm.user.email} devre dışı bırakıldı ve oturumları kapatıldı.` : `${confirm.user.email} yeniden etkinleştirildi.`)
        : confirm.kind === "role" ? `${confirm.user.email} rolü güncellendi.` : "Geçici yetki sonlandırıldı.",
    );
    setError(null); setConfirm(null); reloadAll();
  }

  return (
    <>
      <PageHeader
        title="Kullanıcılar & Yetkiler"
        description="Yönetim hesaplarını, rollerini ve süreli yetkileri yönetin. Tüm değişiklikler denetim kaydına yazılır ve sunucu tarafında yetkilendirilir."
        actions={canManageUsers ? <Button onClick={() => setInviteOpen(true)}>Yönetici davet et</Button> : undefined}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Panel className="mt-6" bodyClassName="p-0" title="Yönetim hesapları" description={`${rows.length} hesap · ${activeSuperAdmins} aktif Süper Yönetici`}>
        {users.error ? <div className="p-4 sm:p-5"><Notice tone="error">{users.error}</Notice></div> : null}
        {!rows.length && !users.loading ? (
          <div className="p-4 sm:p-5"><EmptyState title="Kullanıcı bulunamadı" /></div>
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-posta</TableHead><TableHead>Rol</TableHead><TableHead>Durum</TableHead>
                  <TableHead>Son aktivite</TableHead><TableHead>Geçici yetkiler</TableHead>
                  {(canManageUsers || canAssignRoles) ? <TableHead className="text-right">İşlemler</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-[16rem] whitespace-normal font-medium">
                      {u.email}{u.id === selfId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(siz)</span> : null}
                    </TableCell>
                    <TableCell>{roleControl(u, "table")}</TableCell>
                    <TableCell><StatusBadge tone={u.active ? "success" : "neutral"}>{u.active ? "Aktif" : "Pasif"}</StatusBadge></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmt(u.lastActivityAt ?? u.lastLoginAt)}</TableCell>
                    <TableCell>{grantChips(u)}</TableCell>
                    {(canManageUsers || canAssignRoles) ? <TableCell className="text-right">{rowActions(u)}</TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile: a stacked card per account instead of a 788px horizontally scrolling table. */}
          <ul className="grid gap-3 p-3 sm:p-4 md:hidden">
            {rows.map((u) => (
              <li key={u.id} className="rounded-lg border p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium break-all">{u.email}{u.id === selfId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(siz)</span> : null}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Son aktivite: {fmt(u.lastActivityAt ?? u.lastLoginAt)}</p>
                  </div>
                  <StatusBadge tone={u.active ? "success" : "neutral"}>{u.active ? "Aktif" : "Pasif"}</StatusBadge>
                </div>
                <div className="mt-3">{roleControl(u, "card")}</div>
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Geçici yetkiler</p>
                  {grantChips(u)}
                </div>
                {(canManageUsers || canAssignRoles) ? <div className="mt-3 border-t pt-3">{rowActions(u)}</div> : null}
              </li>
            ))}
          </ul>
          </>
        )}
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Yetki özeti" description="Yetkilendirme sunucu tarafında her istekte yeniden değerlendirilir; buradaki liste yalnızca görünürlüktür.">
          <ul className="grid gap-2 sm:grid-cols-2">
            {(adminPermissions.super_admin as readonly AdminPermission[]).map((p) => (
              <li key={p} className="flex items-center gap-2 text-sm">
                <StatusBadge tone="info">Süper Yönetici</StatusBadge>{permissionLabel[p]}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Ödeme sağlayıcı yapılandırması (payments:configure) yalnızca Süper Yönetici rolündedir ve süreli yetki olarak verilemez.</p>
        </Panel>
        <Panel title="Bekleyen davetler" description="Davet bağlantısı yalnızca e-posta ile iletilir; gizli bağlantı tarayıcıya hiç dönmez.">
          {pendingInvites.length ? (
            <ul className="grid gap-2">
              {pendingInvites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="min-w-0 font-medium break-all">{i.email}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {roleLabel[i.role as AdminRole] ?? i.role} · {fmt(i.expiresAt)} <StatusBadge tone="warning">Bekliyor</StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Bekleyen davet yok.</p>}
        </Panel>
      </div>

      <Panel className="mt-6" title="Denetim geçmişi" description="Kullanıcı, rol, davet ve yetki değişikliklerinin son kayıtları.">
        {auditEntries.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Aksiyon</TableHead><TableHead>Aktör</TableHead><TableHead>Varlık</TableHead></TableRow></TableHeader>
              <TableBody>
                {auditEntries.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmt(a.createdAt)}</TableCell>
                    <TableCell className="text-sm font-medium">{a.action}</TableCell>
                    <TableCell className="max-w-[14rem] whitespace-normal text-sm break-all">{a.actorEmail}</TableCell>
                    <TableCell className="max-w-[14rem] whitespace-normal text-sm text-muted-foreground break-all">{a.entityType}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">{audit.loading ? "Yükleniyor…" : "Kayıt bulunamadı."}</p>}
      </Panel>

      {/* Davet: the raw token is created server-side and only ever emailed. */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Yönetici davet et</DialogTitle><DialogDescription>Davet bağlantısı e-posta ile gönderilir ve en fazla {ADMIN_INVITE_MAX_TTL_HOURS} saat geçerlidir.</DialogDescription></DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submitInvite(); }}>
            <FormField label="E-posta" htmlFor="invite-email">
              {/* Radix portals the dialog outside .admin-theme, so the scoped 44px control rule never
                  reaches it - the height is set explicitly to keep touch targets consistent. */}
              <Input id="invite-email" type="email" required maxLength={254} autoComplete="off" className="h-11" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </FormField>
            <FormField label="Rol" htmlFor="invite-role">
              <select id="invite-role" className={selectClass} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as AdminRole)}>
                {ASSIGNABLE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </FormField>
            <FormField label="Geçerlilik" htmlFor="invite-ttl">
              <select id="invite-ttl" className={selectClass} value={inviteTtl} onChange={(e) => setInviteTtl(Number(e.target.value))}>
                {INVITE_TTL_PRESETS.map((h) => <option key={h} value={h}>{hoursLabel(h)}</option>)}
              </select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={busy}>Vazgeç</Button>
              <Button type="submit" disabled={busy || !inviteEmail.trim()}>{busy ? "Gönderiliyor…" : "Davet gönder"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Süreli yetki: the TTL ceiling follows the permission (privileged <= 24h, operational <= 168h). */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Geçici yetki ver</DialogTitle>
            <DialogDescription>Yetki sunucu tarafında süre bitince kendiliğinden düşer. {grantCeiling > 0 ? `Üst sınır: ${hoursLabel(grantCeiling)}.` : ""}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submitGrant(); }}>
            <FormField label="Kullanıcı" htmlFor="grant-user"><Input id="grant-user" readOnly className="h-11" value={grantUser?.email ?? ""} /></FormField>
            <FormField label="Yetki" htmlFor="grant-permission">
              <select id="grant-permission" className={selectClass} value={grantPermission} onChange={(e) => setGrantPermission(e.target.value as AdminPermission)}>
                {GRANTABLE.map((p) => <option key={p} value={p}>{permissionLabel[p]}{isPrivilegedPermission(p) ? " (en fazla 24 saat)" : ""}</option>)}
              </select>
            </FormField>
            <FormField label="Süre" htmlFor="grant-ttl" hint={isPrivilegedPermission(grantPermission) ? "Güvenlik açısından ayrılmış yetkiler en fazla 24 saat sürebilir." : undefined}>
              <select id="grant-ttl" className={selectClass} value={grantTtl} onChange={(e) => setGrantTtl(Number(e.target.value))}>
                {OPERATIONAL_GRANT_PRESETS_HOURS.filter((h) => h <= grantCeiling).map((h) => <option key={h} value={h}>{hoursLabel(h)}</option>)}
              </select>
            </FormField>
            <FormField label="Gerekçe" htmlFor="grant-reason" hint="Denetim kaydına yazılır.">
              <Input id="grant-reason" maxLength={200} className="h-11" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGrantOpen(false)} disabled={busy}>Vazgeç</Button>
              <Button type="submit" disabled={busy}>{busy ? "Kaydediliyor…" : "Yetkiyi ver"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>



      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.kind === "role" ? "Rol değiştirilsin mi?" : confirm?.kind === "revoke" ? "Geçici yetki sonlandırılsın mı?" : confirm?.user.active ? "Hesap devre dışı bırakılsın mı?" : "Hesap etkinleştirilsin mi?"}
        description={confirm?.kind === "status" && confirm.user.active
          ? `${confirm.user.email} devre dışı bırakılacak ve tüm oturumları kapatılacak.`
          : confirm?.kind === "role"
            ? `${confirm?.user.email} rolü ${roleLabel[confirm.role as AdminRole] ?? confirm.role} olarak değiştirilecek. Yetki kaybı oturumları kapatır.`
            : confirm?.kind === "revoke"
              ? `${permissionLabel[(confirm?.grant?.permission ?? "") as AdminPermission] ?? confirm?.grant?.permission} yetkisi ${confirm?.user.email} için sonlandırılacak.`
              : `${confirm?.user.email} yeniden etkinleştirilecek.`}
        confirmLabel="Onayla"
        variant={confirm?.kind === "status" && confirm.user.active ? "destructive" : "default"}
        loading={busy}
        onConfirm={runConfirm}
      />
    </>
  );
}

