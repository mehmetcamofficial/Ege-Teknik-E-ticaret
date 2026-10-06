import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const timestamps={createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow()};
export const brands=pgTable("brands",{id:text("id").primaryKey(),name:text("name").notNull(),slug:text("slug").notNull(),active:boolean("active").notNull().default(true),...timestamps},t=>[uniqueIndex("brands_slug_uq").on(t.slug)]);
export const categories=pgTable("categories",{id:text("id").primaryKey(),parentId:text("parent_id"),name:text("name").notNull(),slug:text("slug").notNull(),active:boolean("active").notNull().default(true),sortOrder:integer("sort_order").notNull().default(0),...timestamps},t=>[uniqueIndex("categories_slug_uq").on(t.slug),index("categories_parent_idx").on(t.parentId)]);
export const products=pgTable("products",{id:text("id").primaryKey(),slug:text("slug").notNull(),name:text("name").notNull(),brandId:text("brand_id").references(()=>brands.id),categoryId:text("category_id").references(()=>categories.id),category:text("category").notNull().default("Klima"),series:text("series").notNull().default(""),sku:text("sku").notNull().default(""),capacity:text("capacity").notNull().default(""),energyClass:text("energy_class").notNull().default(""),wifi:text("wifi").notNull().default(""),price:integer("price").notNull().default(0),vatRateBps:integer("vat_rate_bps").notNull().default(2000),saleMode:text("sale_mode").notNull().default("quote"),/* How the product reaches the customer (lib/delivery.ts derives installation/shipping from this one value). Unknown or new rows default to the safest class: dealer delivery with installation, never carrier shipping. */deliveryClass:text("delivery_class").notNull().default("installed_delivery"),status:text("status").notNull().default("draft"),description:text("description").notNull().default(""),imageUrl:text("image_url").notNull().default(""),shortDescription:text("short_description"),gallery:jsonb("gallery").notNull().default([]),specifications:jsonb("specifications").notNull().default({}),documents:jsonb("documents").notNull().default([]),manufacturerWarranty:jsonb("manufacturer_warranty"),sourceUrl:text("source_url"),...timestamps},t=>[uniqueIndex("products_slug_uq").on(t.slug),uniqueIndex("products_sku_uq").on(t.sku).where(sql`${t.sku} <> ''`),index("products_status_category_idx").on(t.status,t.categoryId),check("products_delivery_class_ck",sql`${t.deliveryClass} IN ('installed_delivery','shippable','local_delivery')`)]);
export const inventory=pgTable("inventory",{id:text("id").primaryKey(),productId:text("product_id").notNull().references(()=>products.id),onHand:integer("on_hand").notNull().default(0),reserved:integer("reserved").notNull().default(0),reorderLevel:integer("reorder_level").notNull().default(0),version:integer("version").notNull().default(1),...timestamps},t=>[uniqueIndex("inventory_product_uq").on(t.productId)]);
export const customers=pgTable("customers",{id:text("id").primaryKey(),firstName:text("first_name").notNull(),lastName:text("last_name").notNull(),phone:text("phone").notNull(),email:text("email").notNull().default(""),taxNumber:text("tax_number").notNull().default(""),taxOffice:text("tax_office").notNull().default(""),companyName:text("company_name").notNull().default(""),clerkUserId:text("clerk_user_id"),...timestamps},t=>[index("customers_phone_idx").on(t.phone),index("customers_email_idx").on(t.email),uniqueIndex("customers_clerk_user_uq").on(t.clerkUserId).where(sql`${t.clerkUserId} IS NOT NULL`)]);
export const addresses=pgTable("addresses",{id:text("id").primaryKey(),customerId:text("customer_id").notNull().references(()=>customers.id),type:text("type").notNull().default("shipping"),title:text("title").notNull().default(""),recipientName:text("recipient_name").notNull(),phone:text("phone").notNull(),city:text("city").notNull(),district:text("district").notNull().default(""),postalCode:text("postal_code").notNull().default(""),line1:text("line1").notNull(),line2:text("line2").notNull().default(""),billing:boolean("billing").notNull().default(false),...timestamps},t=>[index("addresses_customer_idx").on(t.customerId)]);
export const carts=pgTable("carts",{id:text("id").primaryKey(),customerId:text("customer_id").references(()=>customers.id),sessionKey:text("session_key").notNull(),status:text("status").notNull().default("active"),currency:text("currency").notNull().default("TRY"),expiresAt:timestamp("expires_at",{withTimezone:true}),...timestamps},t=>[uniqueIndex("carts_session_uq").on(t.sessionKey),index("carts_customer_status_idx").on(t.customerId,t.status)]);
export const cartItems=pgTable("cart_items",{id:text("id").primaryKey(),cartId:text("cart_id").notNull().references(()=>carts.id),productId:text("product_id").notNull().references(()=>products.id),quantity:integer("quantity").notNull().default(1),...timestamps},t=>[uniqueIndex("cart_items_cart_product_uq").on(t.cartId,t.productId),index("cart_items_cart_idx").on(t.cartId)]);
export const orders=pgTable("orders",{orderIssuedAt:timestamp("order_issued_at",{withTimezone:true}),legalEvidenceVersion:smallint("legal_evidence_version"),id:text("id").primaryKey(),orderNumber:text("order_number").notNull(),customerId:text("customer_id").references(()=>customers.id),idempotencyKey:text("idempotency_key").notNull(),customerName:text("customer_name").notNull(),phone:text("phone").notNull(),email:text("email").notNull().default(""),city:text("city").notNull(),address:text("address").notNull(),shippingAddressSnapshot:jsonb("shipping_address_snapshot").notNull().default({}),billingAddressSnapshot:jsonb("billing_address_snapshot").notNull().default({}),subtotal:integer("subtotal").notNull().default(0),vatTotal:integer("vat_total").notNull().default(0),shippingTotal:integer("shipping_total").notNull().default(0),total:integer("total").notNull().default(0),currency:text("currency").notNull().default("TRY"),paymentStatus:text("payment_status").notNull().default("pending"),status:text("status").notNull().default("pending_payment"),notes:text("notes").notNull().default(""),installationPreference:text("installation_preference"),requestFingerprint:text("request_fingerprint"),installationTotal:integer("installation_total").notNull().default(0),...timestamps},t=>[check("orders_legal_evidence_cohort_ck",sql`(${t.orderIssuedAt} IS NULL AND ${t.legalEvidenceVersion} IS NULL) OR (${t.orderIssuedAt} IS NOT NULL AND ${t.legalEvidenceVersion} IS NOT NULL AND ${t.legalEvidenceVersion} = 1)`),uniqueIndex("orders_number_uq").on(t.orderNumber),uniqueIndex("orders_idempotency_uq").on(t.idempotencyKey),index("orders_customer_created_idx").on(t.customerId,t.createdAt),index("orders_status_created_idx").on(t.status,t.createdAt)]);
export const orderItems=pgTable("order_items",{id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),productId:text("product_id").references(()=>products.id),productName:text("product_name").notNull(),productSku:text("product_sku").notNull().default(""),productSlug:text("product_slug").notNull().default(""),unitPrice:integer("unit_price").notNull(),vatRateBps:integer("vat_rate_bps").notNull(),vatAmount:integer("vat_amount").notNull(),quantity:integer("quantity").notNull(),lineTotal:integer("line_total").notNull(),productSnapshot:jsonb("product_snapshot").notNull().default({}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[index("order_items_order_idx").on(t.orderId)]);
/* Provider-neutral payment ledger (Phase 3.3A). `provider` is "manual" for operator-recorded cash/EFT/POS receipts; a
   future PayTR/iyzico integration writes its own provider name and provider_transaction_id. Checks in 0013 are NOT VALID:
   they bind every new row without rescanning history. */
export const payments=pgTable("payments",{id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),provider:text("provider").notNull(),providerTransactionId:text("provider_transaction_id"),amount:integer("amount").notNull(),currency:text("currency").notNull().default("TRY"),status:text("status").notNull().default("pending"),installmentCount:integer("installment_count").notNull().default(1),paidAt:timestamp("paid_at",{withTimezone:true}),refundedAt:timestamp("refunded_at",{withTimezone:true}),metadata:jsonb("metadata").notNull().default({}),method:text("method"),reference:text("reference").notNull().default(""),note:text("note").notNull().default(""),recordedBy:text("recorded_by").references(()=>adminUsers.id),idempotencyKey:text("idempotency_key"),...timestamps},t=>[uniqueIndex("payments_provider_tx_uq").on(t.provider,t.providerTransactionId).where(sql`${t.providerTransactionId} is not null`),index("payments_order_idx").on(t.orderId),uniqueIndex("payments_idempotency_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  check("payments_amount_ck",sql`${t.amount} > 0`),
  check("payments_status_ck",sql`${t.status} IN ('pending','paid','failed','cancelled')`),
  check("payments_method_ck",sql`${t.method} IS NULL OR ${t.method} IN ('cash','bank_transfer','pos','online')`),
  check("payments_paid_at_ck",sql`${t.status} <> 'paid' OR ${t.paidAt} IS NOT NULL`),
]);
export const shipments=pgTable("shipments",{id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),carrier:text("carrier").notNull().default(""),trackingNumber:text("tracking_number").notNull().default(""),status:text("status").notNull().default("pending"),shippedAt:timestamp("shipped_at",{withTimezone:true}),deliveredAt:timestamp("delivered_at",{withTimezone:true}),...timestamps},t=>[index("shipments_order_idx").on(t.orderId)]);
export const installationJobs=pgTable("installation_jobs",{id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),addressId:text("address_id").references(()=>addresses.id),status:text("status").notNull().default("pending"),scheduledAt:timestamp("scheduled_at",{withTimezone:true}),completedAt:timestamp("completed_at",{withTimezone:true}),technicianNotes:text("technician_notes").notNull().default(""),...timestamps},t=>[index("installation_jobs_order_idx").on(t.orderId),index("installation_jobs_status_schedule_idx").on(t.status,t.scheduledAt)]);
export const serviceRequests=pgTable("service_requests",{id:text("id").primaryKey(),requestNumber:text("request_number").notNull(),customerId:text("customer_id").references(()=>customers.id),orderId:text("order_id").references(()=>orders.id),type:text("type").notNull(),name:text("name").notNull(),phone:text("phone").notNull(),email:text("email").notNull().default(""),city:text("city").notNull(),message:text("message").notNull(),status:text("status").notNull().default("new"),source:text("source").notNull().default("web"),idempotencyKey:text("idempotency_key"),...timestamps},t=>[uniqueIndex("service_requests_number_uq").on(t.requestNumber),uniqueIndex("service_requests_idempotency_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),index("service_requests_status_created_idx").on(t.status,t.createdAt)]);
export const returns=pgTable("returns",{id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),orderItemId:text("order_item_id").references(()=>orderItems.id),reason:text("reason").notNull(),status:text("status").notNull().default("requested"),quantity:integer("quantity").notNull().default(1),requestedAt:timestamp("requested_at",{withTimezone:true}).notNull().defaultNow(),resolvedAt:timestamp("resolved_at",{withTimezone:true}),notes:text("notes").notNull().default(""),...timestamps},t=>[index("returns_order_status_idx").on(t.orderId,t.status)]);
/* Financial refund = money returned against ONE payment. Distinct from `returns` (goods coming back). */
export const refunds=pgTable("refunds",{id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),paymentId:text("payment_id").references(()=>payments.id),returnId:text("return_id").references(()=>returns.id),amount:integer("amount").notNull(),currency:text("currency").notNull().default("TRY"),status:text("status").notNull().default("pending"),providerRefundId:text("provider_refund_id"),refundedAt:timestamp("refunded_at",{withTimezone:true}),reason:text("reason").notNull().default(""),createdBy:text("created_by").references(()=>adminUsers.id),idempotencyKey:text("idempotency_key"),...timestamps},t=>[index("refunds_order_idx").on(t.orderId),index("refunds_payment_idx").on(t.paymentId),uniqueIndex("refunds_idempotency_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  check("refunds_amount_ck",sql`${t.amount} > 0`),
  check("refunds_status_ck",sql`${t.status} IN ('pending','completed','failed')`),
  check("refunds_completed_at_ck",sql`${t.status} <> 'completed' OR ${t.refundedAt} IS NOT NULL`),
]);
export const usedProducts=pgTable("used_products",{id:text("id").primaryKey(),slug:text("slug").notNull(),name:text("name").notNull(),category:text("category").notNull(),condition:text("condition").notNull().default("İyi"),testNotes:text("test_notes").notNull().default(""),warranty:text("warranty").notNull().default(""),price:integer("price").notNull().default(0),stock:integer("stock").notNull().default(1),imageUrl:text("image_url").notNull().default(""),status:text("status").notNull().default("draft"),description:text("description").notNull().default(""),...timestamps},t=>[uniqueIndex("used_products_slug_uq").on(t.slug),index("used_products_status_created_idx").on(t.status,t.createdAt)]);
export const secondHandProducts=usedProducts;
export const adminUsers=pgTable("admin_users",{id:text("id").primaryKey(),externalUserId:text("external_user_id").notNull(),email:text("email").notNull(),passwordHash:text("password_hash"),role:text("role").notNull().default("catalog_manager"),active:boolean("active").notNull().default(true),mfaEnabled:boolean("mfa_enabled").notNull().default(false),lastLoginAt:timestamp("last_login_at",{withTimezone:true}),...timestamps},t=>[uniqueIndex("admin_users_external_uq").on(t.externalUserId),uniqueIndex("admin_users_email_uq").on(t.email)]);
export const adminSessions=pgTable("admin_sessions",{id:text("id").primaryKey(),adminUserId:text("admin_user_id").notNull().references(()=>adminUsers.id),tokenHash:text("token_hash").notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),lastRotatedAt:timestamp("last_rotated_at",{withTimezone:true}).notNull().defaultNow(),revokedAt:timestamp("revoked_at",{withTimezone:true}),ipHash:text("ip_hash").notNull().default(""),userAgentHash:text("user_agent_hash").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex("admin_sessions_token_uq").on(t.tokenHash),index("admin_sessions_user_expiry_idx").on(t.adminUserId,t.expiresAt)]);
export const auditLogs=pgTable("audit_logs",{id:text("id").primaryKey(),actorUserId:text("actor_user_id").notNull(),actorEmail:text("actor_email").notNull(),action:text("action").notNull(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),payload:jsonb("payload").notNull().default({}),requestId:text("request_id").notNull().default(""),ipHash:text("ip_hash").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[index("audit_entity_idx").on(t.entityType,t.entityId),index("audit_actor_created_idx").on(t.actorUserId,t.createdAt)]);
export const secondHandReservations=pgTable("second_hand_reservations",{id:text("id").primaryKey(),productId:text("product_id").notNull().references(()=>usedProducts.id),name:text("name").notNull(),phone:text("phone").notNull(),status:text("status").notNull().default("active"),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),...timestamps},t=>[index("reservations_product_status_idx").on(t.productId,t.status)]);
export const blogPosts=pgTable("blog_posts",{id:text("id").primaryKey(),slug:text("slug").notNull(),title:text("title").notNull(),excerpt:text("excerpt").notNull().default(""),content:text("content").notNull().default(""),imageUrl:text("image_url").notNull().default(""),status:text("status").notNull().default("draft"),publishedAt:timestamp("published_at",{withTimezone:true}),...timestamps},t=>[uniqueIndex("blog_posts_slug_uq").on(t.slug),index("blog_posts_status_published_idx").on(t.status,t.publishedAt)]);
export const rateLimitBuckets=pgTable("rate_limit_buckets",{key:text("key").primaryKey(),count:integer("count").notNull().default(0),windowStartedAt:timestamp("window_started_at",{withTimezone:true}).notNull().defaultNow(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull()},t=>[index("rate_limit_expiry_idx").on(t.expiresAt)]);
export const legalDocuments=pgTable("legal_documents",{id:text("id").primaryKey(),slug:text("slug").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex("legal_documents_slug_uq").on(t.slug)]);
export const legalDocumentVersions=pgTable("legal_document_versions",{id:text("id").primaryKey(),documentId:text("document_id").notNull().references(()=>legalDocuments.id),version:integer("version").notNull(),title:text("title").notNull(),body:text("body").notNull(),contentHash:text("content_hash").notNull(),effectiveAt:timestamp("effective_at",{withTimezone:true}),publishedAt:timestamp("published_at",{withTimezone:true}),publishedBy:text("published_by"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex("legal_document_versions_doc_version_uq").on(t.documentId,t.version),check("legal_document_versions_publication_ck",sql`(${t.publishedAt} IS NULL AND ${t.publishedBy} IS NULL) OR (${t.publishedAt} IS NOT NULL AND ${t.publishedBy} IS NOT NULL AND ${t.effectiveAt} IS NOT NULL)`)]);
export const orderLegalAcceptances=pgTable("order_legal_acceptances",{slug:text("slug"),title:text("title"),version:integer("version"),templateContentHash:text("template_content_hash"),renderedBody:text("rendered_body"),renderedSha256:text("rendered_sha256"),renderContextVersion:smallint("render_context_version"),acceptanceType:text("acceptance_type"),id:text("id").primaryKey(),orderId:text("order_id").notNull().references(()=>orders.id),documentVersionId:text("document_version_id").notNull().references(()=>legalDocumentVersions.id),acceptedAt:timestamp("accepted_at",{withTimezone:true}).notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[check("order_legal_acceptances_evidence_cohort_ck",sql`(${t.slug} IS NULL AND ${t.title} IS NULL AND ${t.version} IS NULL AND ${t.templateContentHash} IS NULL AND ${t.renderedBody} IS NULL AND ${t.renderedSha256} IS NULL AND ${t.renderContextVersion} IS NULL AND ${t.acceptanceType} IS NULL) OR (${t.slug} IS NOT NULL AND ${t.title} IS NOT NULL AND ${t.version} IS NOT NULL AND ${t.templateContentHash} IS NOT NULL AND ${t.renderedBody} IS NOT NULL AND ${t.renderedSha256} IS NOT NULL AND ${t.renderContextVersion} IS NOT NULL AND ${t.acceptanceType} IS NOT NULL AND ${t.slug} IN ('distance-sales','pre-information') AND char_length(${t.title}) > 0 AND ${t.version} > 0 AND ${t.templateContentHash} ~ '^[0-9a-f]{64}$' AND char_length(${t.renderedBody}) > 0 AND ${t.renderedSha256} ~ '^[0-9a-f]{64}$' AND ${t.renderContextVersion} = 2 AND ${t.acceptanceType} = 'checkout_required')`),check("order_legal_acceptances_body_digest_ck",sql`${t.renderedBody} IS NULL OR ${t.renderedSha256} = encode(sha256(convert_to(${t.renderedBody}, 'UTF8')), 'hex')`),uniqueIndex("order_legal_acceptances_order_slug_uq").on(t.orderId,t.slug).where(sql`${t.slug} IS NOT NULL`),uniqueIndex("order_legal_acceptances_order_version_uq").on(t.orderId,t.documentVersionId),index("order_legal_acceptances_version_idx").on(t.documentVersionId)]);
export const marketingConsents=pgTable("marketing_consents",{id:text("id").primaryKey(),customerId:text("customer_id").notNull().references(()=>customers.id),channel:text("channel").notNull(),granted:boolean("granted").notNull(),orderId:text("order_id").references(()=>orders.id),source:text("source").notNull().default("checkout"),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().defaultNow()},t=>[index("marketing_consents_customer_channel_idx").on(t.customerId,t.channel,t.recordedAt),check("marketing_consents_channel_ck",sql`${t.channel} IN ('sms','email','whatsapp')`)]);
/* Customer reviews (Phase 5A). Content is immutable after insert and verification is DB-derived: see the guard trigger in drizzle-pg/0008_product_reviews.sql. */
export const productReviews=pgTable("product_reviews",{id:text("id").primaryKey(),productId:text("product_id").notNull().references(()=>products.id),rating:smallint("rating").notNull(),displayName:text("display_name").notNull(),body:text("body").notNull(),status:text("status").notNull().default("pending"),verifiedPurchase:boolean("verified_purchase").notNull().default(false),orderItemId:text("order_item_id").references(()=>orderItems.id),contentHash:text("content_hash").notNull(),idempotencyKey:text("idempotency_key").notNull(),ipHash:text("ip_hash").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),moderatedAt:timestamp("moderated_at",{withTimezone:true}),moderatedBy:text("moderated_by").references(()=>adminUsers.id),moderationNote:text("moderation_note")},t=>[
  uniqueIndex("product_reviews_idempotency_uq").on(t.idempotencyKey),
  uniqueIndex("product_reviews_order_item_live_uq").on(t.orderItemId).where(sql`${t.orderItemId} IS NOT NULL AND ${t.status} IN ('pending','approved')`),
  uniqueIndex("product_reviews_content_live_uq").on(t.productId,t.contentHash).where(sql`${t.status} IN ('pending','approved')`),
  index("product_reviews_public_idx").on(t.productId,t.status,t.createdAt,t.id),
  index("product_reviews_moderation_idx").on(t.status,t.createdAt),
  check("product_reviews_rating_ck",sql`${t.rating} BETWEEN 1 AND 5`),
  check("product_reviews_status_ck",sql`${t.status} IN ('pending','approved','rejected')`),
  check("product_reviews_display_name_ck",sql`char_length(${t.displayName}) BETWEEN 2 AND 40`),
  check("product_reviews_body_ck",sql`char_length(${t.body}) BETWEEN 10 AND 2000`),
  check("product_reviews_verified_ck",sql`${t.verifiedPurchase} = (${t.orderItemId} IS NOT NULL)`),
  check("product_reviews_content_hash_ck",sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  check("product_reviews_idempotency_ck",sql`char_length(${t.idempotencyKey}) BETWEEN 8 AND 200`),
  check("product_reviews_note_ck",sql`${t.moderationNote} IS NULL OR char_length(${t.moderationNote}) <= 500`),
  check("product_reviews_moderation_ck",sql`(${t.status} = 'pending' AND ${t.moderatedAt} IS NULL AND ${t.moderatedBy} IS NULL) OR (${t.status} <> 'pending' AND ${t.moderatedAt} IS NOT NULL AND ${t.moderatedBy} IS NOT NULL)`),
]);
/**
 * First-party analytics (Phase 6A). One row per page/product view. No raw IP, no raw
 * user-agent, no cross-site identifier - see lib/analytics.ts for exactly what visitor_id
 * is and how device/bot classification works. Aggregates are computed at query time
 * (GROUP BY over this table); a pre-aggregated rollup table is a natural follow-up once
 * traffic volume makes that worthwhile, not needed at this scale.
 */
export const analyticsEvents=pgTable("analytics_events",{id:text("id").primaryKey(),visitorId:text("visitor_id").notNull(),path:text("path").notNull(),productId:text("product_id").references(()=>products.id),referrerHost:text("referrer_host"),device:text("device").notNull(),isBot:boolean("is_bot").notNull().default(false),isNewVisitor:boolean("is_new_visitor").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  index("analytics_events_created_idx").on(t.createdAt),
  index("analytics_events_visitor_created_idx").on(t.visitorId,t.createdAt),
  index("analytics_events_path_created_idx").on(t.path,t.createdAt),
  index("analytics_events_product_created_idx").on(t.productId,t.createdAt),
  check("analytics_events_path_ck",sql`char_length(${t.path}) BETWEEN 1 AND 200 AND ${t.path} LIKE '/%'`),
  check("analytics_events_device_ck",sql`${t.device} IN ('mobile','tablet','desktop')`),
  check("analytics_events_visitor_ck",sql`${t.visitorId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
]);
/**
 * Admin "forgot password" reset tokens (Phase 6B). The raw token is a random 256-bit value the
 * caller only ever sees once, in the e-mail; only its sha256 hash is stored here, so a DB read
 * alone can never mint a valid reset. Single-use: used_at starts NULL and is set exactly once,
 * atomically with the password update and session revocation (see lib/admin-auth.ts's
 * consumePasswordResetToken) - a second attempt at the same token finds used_at already set and
 * fails, exactly like the conditional-update pattern in lib/reviews-db.ts's moderateReview.
 */
export const adminPasswordResets=pgTable("admin_password_resets",{id:text("id").primaryKey(),adminUserId:text("admin_user_id").notNull().references(()=>adminUsers.id),tokenHash:text("token_hash").notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),usedAt:timestamp("used_at",{withTimezone:true}),requestIpHash:text("request_ip_hash").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  uniqueIndex("admin_password_resets_token_uq").on(t.tokenHash),
  index("admin_password_resets_user_created_idx").on(t.adminUserId,t.createdAt),
  check("admin_password_resets_token_ck",sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
]);
/**
 * Privileged governance tables (Phase 6D.1). PayTR is OUT OF SCOPE: no credential
 * column/table exists anywhere here. integration_configs stores only metadata
 * (configured flag + short masked hint), never a secret.
 */
export const adminInvites=pgTable("admin_invites",{id:text("id").primaryKey(),email:text("email").notNull(),role:text("role").notNull(),tokenHash:text("token_hash").notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),acceptedAt:timestamp("accepted_at",{withTimezone:true}),revokedAt:timestamp("revoked_at",{withTimezone:true}),invitedBy:text("invited_by").notNull().references(()=>adminUsers.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  uniqueIndex("admin_invites_token_uq").on(t.tokenHash),
  index("admin_invites_email_created_idx").on(t.email,t.createdAt),
  check("admin_invites_token_ck",sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("admin_invites_role_ck",sql`${t.role} IN ('super_admin','admin','operations_manager','catalog_manager','support_agent','viewer')`),
  // Invitation lifetime is capped at 72 HOURS in the database, not only in code.
  check("admin_invites_expiry_ck",sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + make_interval(hours => 72)`),
]);
export const adminGrants=pgTable("admin_grants",{id:text("id").primaryKey(),adminUserId:text("admin_user_id").notNull().references(()=>adminUsers.id),permission:text("permission").notNull(),reason:text("reason").notNull().default(""),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),revokedAt:timestamp("revoked_at",{withTimezone:true}),grantedBy:text("granted_by").notNull().references(()=>adminUsers.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  index("admin_grants_user_expiry_idx").on(t.adminUserId,t.expiresAt),
  check("admin_grants_no_payments_configure_ck",sql`${t.permission} <> 'payments:configure'`),
  check("admin_grants_permission_ck",sql`${t.permission} IN ('catalog:write','orders:write','service:write','content:write','legal:write','admin:read','users:read','users:write','roles:write','integrations:read','integrations:write','payments:configure','security:write','audit:read')`),
  // DB backstop: 168 HOURS max. The per-permission 24-hour privileged ceiling is
  // enforced in code (maxGrantTtlHours) because a single CHECK cannot vary by permission.
  check("admin_grants_expiry_ck",sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + make_interval(hours => 168)`),
]);
export const integrationConfigs=pgTable("integration_configs",{key:text("key").primaryKey(),displayName:text("display_name").notNull(),configured:boolean("configured").notNull().default(false),hint:text("hint").notNull().default(""),updatedBy:text("updated_by").references(()=>adminUsers.id),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  check("integration_configs_hint_ck",sql`char_length(${t.hint}) <= 32`),
]);

/**
 * Content registry (P0-B / P1 foundation).
 *
 * Canonical editing model: these tables are canonical for EDITING; the committed deterministic snapshot
 * (data/content/registry-snapshot.json) is canonical for the BUILD. The build never queries these tables.
 * No generator, public URL, slug or rendered byte depends on them yet — P1 is foundation only.
 */
export const contentEntries=pgTable("content_entries",{id:text("id").primaryKey(),entryType:text("entry_type").notNull().default("guide"),slug:text("slug").notNull(),category:text("category").notNull(),title:text("title").notNull(),seoTitle:text("seo_title").notNull().default(""),description:text("description").notNull().default(""),lead:text("lead").notNull().default(""),answer:text("answer").notNull().default(""),imageKey:text("image_key").notNull().default(""),imageAlt:text("image_alt").notNull().default(""),imageCaption:text("image_caption").notNull().default(""),imagePortrait:boolean("image_portrait"),status:text("status").notNull().default("published"),publishedAt:timestamp("published_at",{withTimezone:true}).notNull(),contentHash:text("content_hash").notNull(),sourceRef:text("source_ref").notNull().default(""),...timestamps},t=>[
  uniqueIndex("content_entries_slug_uq").on(t.slug),
  index("content_entries_type_status_idx").on(t.entryType,t.status),
  index("content_entries_published_at_idx").on(t.publishedAt),
  check("content_entries_type_ck",sql`${t.entryType} IN ('guide')`),
  check("content_entries_status_ck",sql`${t.status} IN ('draft','published','archived')`),
  check("content_entries_slug_ck",sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("content_entries_content_hash_ck",sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
]);
/* Section and FAQ ordering is explicit: `position` is the source order and is unique per entry. */
export const contentSections=pgTable("content_sections",{entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),sectionKey:text("section_key").notNull(),position:integer("position").notNull(),title:text("title").notNull(),html:text("html").notNull()},t=>[
  uniqueIndex("content_sections_pkey").on(t.entryId,t.sectionKey),
  uniqueIndex("content_sections_position_uq").on(t.entryId,t.position),
  check("content_sections_position_ck",sql`${t.position} >= 0`),
  check("content_sections_key_ck",sql`${t.sectionKey} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);
export const contentFaq=pgTable("content_faq",{entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),position:integer("position").notNull(),question:text("question").notNull(),answer:text("answer").notNull()},t=>[
  uniqueIndex("content_faq_pkey").on(t.entryId,t.position),
  check("content_faq_position_ck",sql`${t.position} >= 0`),
]);
/* Guide -> guide relations. The guides' `related[]` holds slugs, so it lands here, NOT in content_related_services. */
export const contentRelatedEntries=pgTable("content_related_entries",{entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),relatedEntryId:text("related_entry_id").notNull().references(()=>contentEntries.id),position:integer("position").notNull(),label:text("label").notNull().default("")},t=>[
  uniqueIndex("content_related_entries_pkey").on(t.entryId,t.relatedEntryId),
  uniqueIndex("content_related_entries_position_uq").on(t.entryId,t.position),
  index("content_related_entries_related_idx").on(t.relatedEntryId),
  check("content_related_entries_position_ck",sql`${t.position} >= 0`),
  check("content_related_entries_no_self_ck",sql`${t.entryId} <> ${t.relatedEntryId}`),
]);
/* Genuine product relations only (real products.id). Left empty by the importer rather than faked. */
export const contentRelatedProducts=pgTable("content_related_products",{entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),productId:text("product_id").notNull().references(()=>products.id),position:integer("position").notNull(),label:text("label").notNull().default("")},t=>[
  uniqueIndex("content_related_products_pkey").on(t.entryId,t.productId),
  uniqueIndex("content_related_products_position_uq").on(t.entryId,t.position),
  check("content_related_products_position_ck",sql`${t.position} >= 0`),
]);
export const contentRelatedServices=pgTable("content_related_services",{entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),serviceSlug:text("service_slug").notNull(),position:integer("position").notNull(),label:text("label").notNull().default("")},t=>[
  uniqueIndex("content_related_services_pkey").on(t.entryId,t.serviceSlug),
  uniqueIndex("content_related_services_position_uq").on(t.entryId,t.position),
  check("content_related_services_position_ck",sql`${t.position} >= 0`),
]);
/* Lossless literal links: where the guides' category/catalog/contact `products[]` URLs are preserved verbatim. */
export const contentLinks=pgTable("content_links",{entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),position:integer("position").notNull(),label:text("label").notNull(),href:text("href").notNull(),linkKind:text("link_kind").notNull().default("link")},t=>[
  uniqueIndex("content_links_pkey").on(t.entryId,t.position),
  index("content_links_href_idx").on(t.href),
  check("content_links_position_ck",sql`${t.position} >= 0`),
  check("content_links_kind_ck",sql`${t.linkKind} IN ('link','catalog_filter','category','service','contact','selector','second_hand')`),
]);
/* Append-only edit history. Never read by the build; exists for audit and rollback. */
export const contentVersions=pgTable("content_versions",{id:text("id").primaryKey(),entryId:text("entry_id").notNull().references(()=>contentEntries.id,{onDelete:"cascade"}),version:integer("version").notNull(),contentHash:text("content_hash").notNull(),snapshot:jsonb("snapshot").notNull(),changedBy:text("changed_by").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  uniqueIndex("content_versions_version_uq").on(t.entryId,t.version),
  index("content_versions_entry_idx").on(t.entryId,t.version),
  check("content_versions_version_ck",sql`${t.version} >= 1`),
  check("content_versions_content_hash_ck",sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
]);
/* Ledger of exported snapshots, tying a committed file back to the content hash it came from. */
export const contentExports=pgTable("content_exports",{id:text("id").primaryKey(),targetPath:text("target_path").notNull(),contentHash:text("content_hash").notNull(),entryCount:integer("entry_count").notNull(),generatedBy:text("generated_by").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  index("content_exports_created_at_idx").on(t.createdAt),
  check("content_exports_content_hash_ck",sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  check("content_exports_entry_count_ck",sql`${t.entryCount} >= 0`),
]);
export const contentRedirects=pgTable("content_redirects",{id:text("id").primaryKey(),fromPath:text("from_path").notNull(),toPath:text("to_path").notNull(),statusCode:integer("status_code").notNull().default(308),entryId:text("entry_id").references(()=>contentEntries.id,{onDelete:"cascade"}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()},t=>[
  uniqueIndex("content_redirects_from_path_uq").on(t.fromPath),
  check("content_redirects_status_ck",sql`${t.statusCode} IN (301,308)`),
]);
