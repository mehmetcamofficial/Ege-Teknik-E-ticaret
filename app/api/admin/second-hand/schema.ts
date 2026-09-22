import { z } from "zod";

export const secondHandSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(2).max(160).regex(/^[a-z0-9-]+$/),
  category: z.string().min(2).max(80),
  condition: z.string().max(80).default("İyi"),
  testNotes: z.string().max(3000).default(""),
  warranty: z.string().max(160).default(""),
  price: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0).max(99),
  imageUrl: z.string().max(1000).default(""),
  status: z.enum(["draft", "published", "sold"]),
  description: z.string().max(4000).default(""),
});
