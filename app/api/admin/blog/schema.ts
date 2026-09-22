import { z } from "zod";

export const blogSchema = z.object({
  title: z.string().min(3).max(180),
  slug: z.string().min(2).max(180).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().max(500).default(""),
  content: z.string().min(20).max(30000),
  imageUrl: z.string().max(1000).default(""),
  status: z.enum(["draft", "published"]),
});
