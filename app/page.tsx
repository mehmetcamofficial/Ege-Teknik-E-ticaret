import { redirect } from "next/navigation";
import { ensureCatalogInitialized } from "@/lib/catalog-service";

export default async function Home() {
  await ensureCatalogInitialized();
  redirect("/index.html");
}
