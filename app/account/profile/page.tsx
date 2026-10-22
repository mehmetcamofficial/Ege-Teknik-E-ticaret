import { auth } from "@clerk/nextjs/server";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { getProfile } from "@/lib/account-resources";
import { profileStore } from "@/lib/account-resources-db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();

  const profile = await getProfile(customer, profileStore);
  if (!profile) return (await auth()).redirectToSignIn();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil Bilgileri</CardTitle>
        <CardDescription>Ad, soyad ve telefon numaranızı güncelleyin. E-posta adresiniz Clerk hesabınız tarafından yönetilir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {profile.email ? (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Hesap E-postası</span>
            <p className="text-sm text-muted-foreground">{profile.email}</p>
          </div>
        ) : null}
        <ProfileForm firstName={profile.firstName} lastName={profile.lastName} phone={profile.phone} />
      </CardContent>
    </Card>
  );
}
