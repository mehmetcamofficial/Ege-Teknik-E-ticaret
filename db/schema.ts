import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = { createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`) };

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), slug: text("slug").notNull().unique(), name: text("name").notNull(), category: text("category").notNull(),
  series: text("series").notNull().default(""), sku: text("sku").notNull().default(""), capacity: text("capacity").notNull().default(""),
  energyClass: text("energy_class").notNull().default(""), wifi: text("wifi").notNull().default(""), price: integer("price").notNull().default(0),
  stock: integer("stock").notNull().default(0), saleMode: text("sale_mode").notNull().default("quote"), status: text("status").notNull().default("draft"),
  description: text("description").notNull().default(""), ...timestamps,
}, (t) => [index("products_status_category_idx").on(t.status, t.category)]);

export const serviceRequests = sqliteTable("service_requests", {
  id: text("id").primaryKey(), requestNumber: text("request_number").notNull().unique(), type: text("type").notNull(), name: text("name").notNull(),
  phone: text("phone").notNull(), email: text("email").notNull().default(""), city: text("city").notNull(), message: text("message").notNull(),
  status: text("status").notNull().default("new"), source: text("source").notNull().default("web"), ...timestamps,
}, (t) => [index("service_requests_status_created_idx").on(t.status, t.createdAt)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), orderNumber: text("order_number").notNull().unique(), customerName: text("customer_name").notNull(), phone: text("phone").notNull(),
  email: text("email").notNull().default(""), city: text("city").notNull(), address: text("address").notNull(), total: integer("total").notNull().default(0),
  status: text("status").notNull().default("draft"), paymentProvider: text("payment_provider"), ...timestamps,
}, (t) => [index("orders_status_created_idx").on(t.status, t.createdAt)]);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id), productId: text("product_id"), productName: text("product_name").notNull(),
  unitPrice: integer("unit_price").notNull(), quantity: integer("quantity").notNull().default(1), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("order_items_order_idx").on(t.orderId)]);

export const secondHandReservations = sqliteTable("second_hand_reservations", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(), name: text("name").notNull(), phone: text("phone").notNull(),
  status: text("status").notNull().default("active"), expiresAt: text("expires_at").notNull(), ...timestamps,
}, (t) => [index("reservations_product_status_idx").on(t.productId, t.status)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), actorUserId: text("actor_user_id").notNull(), actorEmail: text("actor_email").notNull(), action: text("action").notNull(),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)]);
