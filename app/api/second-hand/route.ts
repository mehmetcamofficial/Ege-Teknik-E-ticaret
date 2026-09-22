import { getDb } from "@/db";
import { secondHandProducts } from "@/db/schema";
import { desc,eq } from "drizzle-orm";
export async function GET(){const items=await getDb().select().from(secondHandProducts).where(eq(secondHandProducts.status,"published")).orderBy(desc(secondHandProducts.createdAt));return Response.json({products:items})}
