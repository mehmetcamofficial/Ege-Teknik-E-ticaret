import { getDb } from "@/db";
import { secondHandProducts } from "@/db/schema";
import { desc,eq } from "drizzle-orm";
import { secondHandDisplay } from "@/lib/second-hand-policy";
export async function GET(){
  const items=await getDb().select().from(secondHandProducts).where(eq(secondHandProducts.status,"published")).orderBy(desc(secondHandProducts.createdAt));
  // P3-LEGAL-USED-01: vitrin yalnızca gerçek kayıtları gösterir; boş veriden
  // "test edildi" üretilmez, kusur/eksik satırları boşsa gizlenir.
  const products=items.map((p)=>({ ...p, display: secondHandDisplay(p) }));
  return Response.json({products})
}
