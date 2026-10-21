import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out:"./drizzle-pg",
  schema:"./db/schema.ts",
  dialect:"postgresql",
  dbCredentials:{ url:process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
  strict:true,
  verbose:true,
});
