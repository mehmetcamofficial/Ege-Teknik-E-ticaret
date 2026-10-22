CREATE TABLE "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"type" text DEFAULT 'shipping' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"city" text NOT NULL,
	"district" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"line1" text NOT NULL,
	"line2" text DEFAULT '' NOT NULL,
	"billing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"external_user_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'catalog_manager' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text DEFAULT '' NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"session_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"tax_number" text DEFAULT '' NOT NULL,
	"tax_office" text DEFAULT '' NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"address_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"technician_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"product_name" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"product_slug" text DEFAULT '' NOT NULL,
	"unit_price" integer NOT NULL,
	"vat_rate_bps" integer NOT NULL,
	"vat_amount" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"product_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" text,
	"idempotency_key" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"address" text NOT NULL,
	"shipping_address_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_address_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"vat_total" integer DEFAULT 0 NOT NULL,
	"shipping_total" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_transaction_id" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"installment_count" integer DEFAULT 1 NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand_id" text,
	"category_id" text,
	"category" text DEFAULT 'Klima' NOT NULL,
	"series" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"capacity" text DEFAULT '' NOT NULL,
	"energy_class" text DEFAULT '' NOT NULL,
	"wifi" text DEFAULT '' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"vat_rate_bps" integer DEFAULT 2000 NOT NULL,
	"sale_mode" text DEFAULT 'quote' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"payment_id" text,
	"return_id" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_products" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"condition" text DEFAULT 'İyi' NOT NULL,
	"test_notes" text DEFAULT '' NOT NULL,
	"warranty" text DEFAULT '' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 1 NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "second_hand_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"request_number" text NOT NULL,
	"customer_id" text,
	"order_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"carrier" text DEFAULT '' NOT NULL,
	"tracking_number" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_jobs" ADD CONSTRAINT "installation_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_jobs" ADD CONSTRAINT "installation_jobs_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_reservations" ADD CONSTRAINT "second_hand_reservations_product_id_used_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."used_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_customer_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_external_uq" ON "admin_users" USING btree ("external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uq" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blog_posts_slug_uq" ON "blog_posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "blog_posts_status_published_idx" ON "blog_posts" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_uq" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_product_uq" ON "cart_items" USING btree ("cart_id","product_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_session_uq" ON "carts" USING btree ("session_key");--> statement-breakpoint
CREATE INDEX "carts_customer_status_idx" ON "carts" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "installation_jobs_order_idx" ON "installation_jobs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "installation_jobs_status_schedule_idx" ON "installation_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_product_uq" ON "inventory" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_uq" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_uq" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_tx_uq" ON "payments" USING btree ("provider","provider_transaction_id") WHERE "payments"."provider_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("sku") WHERE "products"."sku" <> '';--> statement-breakpoint
CREATE INDEX "products_status_category_idx" ON "products" USING btree ("status","category_id");--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "returns_order_status_idx" ON "returns" USING btree ("order_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "used_products_slug_uq" ON "used_products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "used_products_status_created_idx" ON "used_products" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reservations_product_status_idx" ON "second_hand_reservations" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_number_uq" ON "service_requests" USING btree ("request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_idempotency_uq" ON "service_requests" USING btree ("idempotency_key") WHERE "service_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "service_requests_status_created_idx" ON "service_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");