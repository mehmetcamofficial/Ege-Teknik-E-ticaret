import Link from "next/link";
import { PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin-page";
import { permissionLabel, roleLabel } from "@/lib/admin-ui";
import { adminPermissions, type AdminRole } from "@/lib/security-policy";

export const dynamic = "force-dynamic";

/** Read-only account view: nothing here changes roles, sessions, or credentials. */
export default async function SettingsPage() {
  const admin = await requireAdminPage();
  const perms = adminPermissions[admin.role as AdminRole] ?? [];
  return (
    <>
      <PageHeader title="Ayarlar" description="Hesap bilgileriniz ve yetkileriniz." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Hesap">
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-muted-foreground">E-posta</dt><dd className="font-medium break-all">{admin.email}</dd></div>
            <div><dt className="text-muted-foreground">Rol</dt><dd className="font-medium">{roleLabel[admin.role] ?? admin.role}</dd></div>
          </dl>
        </Panel>
        <Panel title="Yetkiler" description="Rolünüze tanımlı işlemler. Yetkiler sunucu tarafında her istekte yeniden kontrol edilir.">
          <ul className="grid gap-2">{perms.map((p) => <li key={p} className="flex items-center gap-2 text-sm"><StatusBadge tone="success">Açık</StatusBadge>{permissionLabel[p]}</li>)}</ul>
        </Panel>
        <Panel title="Parola" className="xl:col-span-2">
          <p className="text-sm text-muted-foreground">Parolanızı değiştirmek için e-posta ile sıfırlama bağlantısı isteyin. Sıfırlama tamamlandığında bu cihaz dahil tüm oturumlarınız kapatılır.</p>
          <p className="mt-3"><Link href="/admin/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Parola sıfırlama bağlantısı iste</Link></p>
        </Panel>
      </div>
    </>
  );
}
