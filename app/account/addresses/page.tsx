import { auth } from "@clerk/nextjs/server";
import { getAuthenticatedCustomer } from "@/lib/customer-auth";
import { listAddresses } from "@/lib/account-resources";
import { addressStore } from "@/lib/account-resources-db";
import { AddressesManager } from "./addresses-manager";

export default async function AddressesPage() {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return (await auth()).redirectToSignIn();

  const addresses = await listAddresses(customer, addressStore);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Adreslerim</h2>
        <p className="text-sm text-muted-foreground">Teslimat ve fatura adreslerinizi buradan yönetebilirsiniz.</p>
      </div>
      <AddressesManager addresses={addresses} />
    </div>
  );
}
