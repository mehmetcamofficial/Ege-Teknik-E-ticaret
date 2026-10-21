import { z } from "zod";

// Phone or e-mail: the customer may choose how to be reached, but at least one real contact channel is required.
export const serviceRequestSchema = z.object({
  type: z.string().min(1).max(40), name: z.string().min(2).max(100), phone: z.string().trim().min(7).max(30).optional().or(z.literal("")),
  email: z.string().trim().email().max(150).optional().or(z.literal("")), city: z.string().min(2).max(100), message: z.string().min(3).max(3000),
}).refine((r) => Boolean(r.phone) || Boolean(r.email), { message: "Telefon veya e-posta gerekli.", path: ["phone"] });
