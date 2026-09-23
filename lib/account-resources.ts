/**
 * Customer account resources: profile, addresses, orders - scoped to the
 * already-resolved internal customer (see lib/customer-identity.ts for how
 * that customer is resolved from a verified Clerk session).
 *
 * Framework-free on purpose (no next/*, @clerk/*, or db import), same as
 * lib/customer-identity.ts, so ownership and IDOR behaviour can be unit
 * tested under plain `node --test` with in-memory fake stores. The real
 * Drizzle wiring lives in lib/account-resources-db.ts.
 *
 * The single rule every function here enforces: every store call that reads,
 * changes or removes a resource is scoped by the resolved customer.id in the
 * SAME call as the resource id - never "look it up, then check the owner in
 * application code". That atomic contract is what lib/account-resources-db.ts
 * must implement with a single `WHERE id = ... AND customer_id = ...` query,
 * so there is no gap between an ownership check and the mutation it guards.
 */

import { z } from "zod";
import type { AuthenticatedCustomer } from "@/lib/customer-identity";

// ---------------------------------------------------------------------------
// Mutation sequence
// ---------------------------------------------------------------------------

export type MutationResult = { ok: boolean; error?: string };

export const SESSION_MISSING_ERROR = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";

/**
 * The one sequence every /account mutation runs, in this order:
 *   1. throttle - an over-limit client never reaches identity resolution or the store;
 *   2. resolve the customer from the verified session - never from a request value;
 *   3. mutate, with the store scoping the write to that customer.
 * Each step short-circuits the rest, so a rejected step can never lead to a write.
 */
export async function runAccountMutation<C>(steps: {
  rateLimit: () => Promise<string | null>;
  resolveCustomer: () => Promise<C | null>;
  mutate: (customer: C) => Promise<MutationResult>;
}): Promise<MutationResult> {
  const limited = await steps.rateLimit();
  if (limited) return { ok: false, error: limited };
  const customer = await steps.resolveCustomer();
  if (!customer) return { ok: false, error: SESSION_MISSING_ERROR };
  const result = await steps.mutate(customer);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Only fields the customer may edit. Deliberately excludes id, clerkUserId
 * and email: email is owned by Clerk (see lib/customer-identity.ts's profile
 * seed), and clerkUserId is the identity link itself - neither is a profile
 * field a client request can ever influence here.
 */
export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "Ad gerekli.").max(100),
  lastName: z.string().trim().min(1, "Soyad gerekli.").max(100),
  phone: z.string().trim().min(7, "Geçerli bir telefon numarası girin.").max(30),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export type CustomerProfile = { id: string; firstName: string; lastName: string; phone: string; email: string };

export type ProfileStore = {
  /** Must select the exact customer row (WHERE id = customerId). */
  getOwnedProfile: (customerId: string) => Promise<CustomerProfile | null>;
  /** Must update the exact customer row (WHERE id = customerId) and return the updated fields, or null if no such row exists. */
  updateOwnedProfile: (customerId: string, patch: ProfileUpdateInput) => Promise<CustomerProfile | null>;
};

export async function getProfile(customer: AuthenticatedCustomer, store: ProfileStore) {
  return store.getOwnedProfile(customer.id);
}

export async function updateProfile(customer: AuthenticatedCustomer, input: unknown, store: ProfileStore) {
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Geçersiz veri." };
  const updated = await store.updateOwnedProfile(customer.id, parsed.data);
  if (!updated) return { ok: false as const, error: "Profil güncellenemedi." };
  return { ok: true as const, profile: updated };
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export const addressInputSchema = z.object({
  title: z.string().trim().max(100).default(""),
  recipientName: z.string().trim().min(2, "Alıcı adı gerekli.").max(150),
  phone: z.string().trim().min(7, "Geçerli bir telefon numarası girin.").max(30),
  city: z.string().trim().min(2, "Şehir gerekli.").max(100),
  district: z.string().trim().max(100).default(""),
  postalCode: z.string().trim().max(20).default(""),
  line1: z.string().trim().min(5, "Adres satırı gerekli.").max(300),
  line2: z.string().trim().max(300).default(""),
  billing: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

export type CustomerAddress = AddressInput & { id: string; customerId: string; type: string };

export type AddressStore = {
  listOwnedAddresses: (customerId: string) => Promise<CustomerAddress[]>;
  /** Always inserts with customerId = customerId; the caller's input never carries a customerId. */
  createOwnedAddress: (customerId: string, input: AddressInput, id: string) => Promise<CustomerAddress>;
  /** Must match WHERE id = addressId AND customer_id = customerId in one query; null if not found or not owned. */
  getOwnedAddress: (customerId: string, addressId: string) => Promise<CustomerAddress | null>;
  /** Same atomic ownership match as getOwnedAddress; null if not found or not owned - never partially applies. */
  updateOwnedAddress: (customerId: string, addressId: string, input: AddressInput) => Promise<CustomerAddress | null>;
  /** Same atomic ownership match; returns whether a row was actually deleted. */
  deleteOwnedAddress: (customerId: string, addressId: string) => Promise<boolean>;
};

/** The single source of truth for deriving addresses.type from the billing flag, so the API and the DB layer can never disagree. */
export function addressType(input: AddressInput) {
  return input.billing ? "billing" : "shipping";
}

export async function listAddresses(customer: AuthenticatedCustomer, store: AddressStore) {
  return store.listOwnedAddresses(customer.id);
}

export async function createAddress(customer: AuthenticatedCustomer, input: unknown, id: string, store: AddressStore) {
  const parsed = addressInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Geçersiz adres bilgisi." };
  const created = await store.createOwnedAddress(customer.id, parsed.data, id);
  return { ok: true as const, address: created };
}

/** Malformed/empty/absurdly long ids are ordinary strings the store's equality match will simply never find - never a special case, never a throw. */
export async function getAddress(customer: AuthenticatedCustomer, addressId: string, store: AddressStore) {
  if (typeof addressId !== "string" || addressId.length === 0 || addressId.length > 200) return null;
  return store.getOwnedAddress(customer.id, addressId);
}

export async function updateAddress(customer: AuthenticatedCustomer, addressId: string, input: unknown, store: AddressStore) {
  if (typeof addressId !== "string" || addressId.length === 0 || addressId.length > 200) return { ok: false as const, error: "Adres bulunamadı." };
  const parsed = addressInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Geçersiz adres bilgisi." };
  const updated = await store.updateOwnedAddress(customer.id, addressId, parsed.data);
  if (!updated) return { ok: false as const, error: "Adres bulunamadı." };
  return { ok: true as const, address: updated };
}

export async function deleteAddress(customer: AuthenticatedCustomer, addressId: string, store: AddressStore) {
  if (typeof addressId !== "string" || addressId.length === 0 || addressId.length > 200) return { ok: false as const, error: "Adres bulunamadı." };
  const deleted = await store.deleteOwnedAddress(customer.id, addressId);
  if (!deleted) return { ok: false as const, error: "Adres bulunamadı." };
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Orders (read-only for customers - no payments, no status changes here)
// ---------------------------------------------------------------------------

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  currency: string;
  createdAt: Date;
};

export type OrderItemView = {
  id: string;
  productName: string;
  productSku: string;
  productSlug: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type OrderDetail = OrderSummary & {
  subtotal: number;
  vatTotal: number;
  shippingTotal: number;
  paymentStatus: string;
  shippingAddressSnapshot: unknown;
  billingAddressSnapshot: unknown;
  items: OrderItemView[];
};

export type OrderStore = {
  listOwnedOrders: (customerId: string) => Promise<OrderSummary[]>;
  /** Must match WHERE id = orderId AND customer_id = customerId in one query; null if not found or not owned. Never authorizes by email, phone or order number alone. */
  getOwnedOrder: (customerId: string, orderId: string) => Promise<OrderDetail | null>;
};

export async function listOrders(customer: AuthenticatedCustomer, store: OrderStore) {
  return store.listOwnedOrders(customer.id);
}

export async function getOrder(customer: AuthenticatedCustomer, orderId: string, store: OrderStore) {
  if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 200) return null;
  return store.getOwnedOrder(customer.id, orderId);
}
