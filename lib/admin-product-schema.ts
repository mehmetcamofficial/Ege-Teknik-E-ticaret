import { z } from "zod";
import { DEFAULT_DELIVERY_CLASS, deliveryClasses } from "./delivery-classes.ts";

/**
 * Request bodies of the admin product API. They live here (not inline in the route files) so the validation - in
 * particular that `deliveryClass` accepts exactly the three known classes - can be unit-tested; a Next route file may
 * only export handlers. Unknown values are refused by the application, never left to the database CHECK.
 */
export const createProductSchema = z.object({
  name: z.string().min(2).max(160), slug: z.string().min(2).max(160).regex(/^[a-z0-9-]+$/), category: z.string().min(2).max(80),
  series: z.string().max(80).default(""), sku: z.string().max(80).default(""), capacity: z.string().max(80).default(""),
  energyClass: z.string().max(30).default(""), wifi: z.string().max(30).default(""), price: z.coerce.number().int().min(0), stock: z.coerce.number().int().min(0),
  saleMode: z.enum(["online", "quote", "discovery", "whatsapp", "out_of_stock"]), status: z.enum(["draft", "published"]), description: z.string().max(4000).default(""),
  imageUrl: z.string().max(1000).default(""),
  // Only the three known classes; anything else is refused here, not left to the database CHECK.
  deliveryClass: z.enum(deliveryClasses).default(DEFAULT_DELIVERY_CLASS),
  brandId:z.string().min(1).max(160).nullable().optional(),categoryId:z.string().min(1).max(160).nullable().optional(),
});

export const patchProductSchema = z.object({
  name:z.string().min(2).max(160).optional(), slug:z.string().min(2).max(160).regex(/^[a-z0-9-]+$/).optional(), category:z.string().min(2).max(80).optional(),
  series:z.string().max(80).optional(), sku:z.string().max(80).optional(), capacity:z.string().max(80).optional(), energyClass:z.string().max(30).optional(), wifi:z.string().max(30).optional(),
  stock: z.coerce.number().int().min(0).optional(), price: z.coerce.number().int().min(0).optional(), status: z.enum(["draft", "published"]).optional(),
  saleMode: z.enum(["online", "quote", "discovery", "whatsapp", "out_of_stock"]).optional(), description:z.string().max(4000).optional(), imageUrl:z.string().max(1000).optional(), deliveryClass:z.enum(deliveryClasses).optional(),
  brandId:z.string().min(1).max(160).nullable().optional(),categoryId:z.string().min(1).max(160).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0);
