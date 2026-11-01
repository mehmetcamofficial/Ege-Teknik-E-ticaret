-- R-04: send budget for the notification worker (per-recipient and global caps on what is actually handed to the e-mail provider).
-- ADDITIVE ONLY: two new tables and one function; no existing row, column, index, constraint or grant is changed.
--
-- Why at send time: this is the only point that bounds real provider spend. The checkout never waits for it (an order is committed
-- before any notification is considered) and a retry of the same notification must not be charged twice, which only the worker, holding the
-- outbox row, can know.
--
-- Design:
--   notification_send_budget       fixed-window counters (hour / day, UTC) keyed by an OPAQUE bucket key. The application builds the key as an
--                                  HMAC of the normalised recipient, so this table never holds an e-mail address.
--   notification_send_reservation  one row per outbox row that has been allowed to send: a retry, a replay or a stale second worker finds its
--                                  reservation and spends nothing more.
--   reserve_notification_send()    SECURITY DEFINER, the ONLY way to touch the two tables. All-or-nothing: either every bucket of the request is
--                                  incremented (and the reservation recorded) or nothing is. Two concurrent callers can never push a bucket past its
--                                  limit: the increment is a single INSERT ... ON CONFLICT DO UPDATE ... WHERE used < limit, serialised per bucket row by
--                                  PostgreSQL, and buckets are locked in a fixed order so concurrent reservations cannot deadlock.
--   Nothing here can be reached by the storefront or the admin application, and the worker gets EXECUTE on the function only
--   (docs/ops/notification-worker-grants-20261024.sql); it has no privilege on either table.
--
-- Return value: 'reserved' | 'already' (this outbox row was reserved within the last six hours: a retry, replay or stale second claim, no new spend) |
-- 'limited:<n>' (entry n, 1-based, was full; nothing changed). A reservation older than six hours (the retry schedule is 2.6 h in all) no longer excuses
-- a send: a later admin requeue is a NEW decision, so it is charged again and can be limited again. `p_at` is NULL in production (the database clock decides
-- the windows); tests inject a time.
-- UYGULANMADI: Neon/Preview/Production veritabanına uygulama.
-- ROLLOUT ORDER: this migration, then the operator SQL (it grants EXECUTE on the function and fails atomically with 42883 without it), then the worker
-- code (it fails closed, sends nothing, when the function is missing). ROLLBACK (a person, on purpose; stop the worker first):
--   BEGIN; DROP FUNCTION public.reserve_notification_send(text, text[], text[], integer[], timestamptz);
--          DROP TABLE public.notification_send_reservation; DROP TABLE public.notification_send_budget; COMMIT;
-- After a rollback a worker build that still calls the function stops sending (fail closed); the previous worker build runs without any send budget.
CREATE TABLE "notification_send_budget" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"used" integer NOT NULL,
	CONSTRAINT "notification_send_budget_pk" PRIMARY KEY ("bucket_key", "window_start"),
	CONSTRAINT "notification_send_budget_key_ck" CHECK ("notification_send_budget"."bucket_key" ~ '^[A-Za-z0-9:_-]{1,120}$'),
	CONSTRAINT "notification_send_budget_used_ck" CHECK ("notification_send_budget"."used" >= 1)
);
--> statement-breakpoint
CREATE INDEX "notification_send_budget_window_idx" ON "notification_send_budget" USING btree ("window_start");
--> statement-breakpoint
CREATE TABLE "notification_send_reservation" (
	"outbox_id" text PRIMARY KEY NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "notification_send_reservation_outbox_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
REVOKE ALL ON TABLE "notification_send_budget", "notification_send_reservation" FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.reserve_notification_send(p_outbox_id text, p_keys text[], p_windows text[], p_limits integer[], p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $reserve$
DECLARE
  r record;
  n integer;
  ts timestamptz := COALESCE(p_at, now());
  ws timestamptz;
  failed text;
BEGIN
  IF p_outbox_id IS NULL OR p_outbox_id !~ '^[A-Za-z0-9_-]{1,80}$'
     OR p_keys IS NULL OR p_windows IS NULL OR p_limits IS NULL
     OR cardinality(p_keys) NOT BETWEEN 1 AND 40
     OR cardinality(p_keys) <> cardinality(p_windows) OR cardinality(p_keys) <> cardinality(p_limits) THEN
    RAISE EXCEPTION 'invalid reservation request' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT t.k, t.w, t.l FROM unnest(p_keys, p_windows, p_limits) AS t(k, w, l) LOOP
    IF r.k IS NULL OR r.k !~ '^[A-Za-z0-9:_-]{1,120}$' OR r.w IS NULL OR r.w NOT IN ('hour', 'day') OR r.l IS NULL OR r.l NOT BETWEEN 1 AND 1000000 THEN
      RAISE EXCEPTION 'invalid reservation request' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  BEGIN
    INSERT INTO public.notification_send_reservation AS rv (outbox_id, reserved_at) VALUES (p_outbox_id, ts)
      ON CONFLICT (outbox_id) DO UPDATE SET reserved_at = EXCLUDED.reserved_at WHERE rv.reserved_at < ts - interval '6 hours';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RETURN 'already';
    END IF;
    FOR r IN SELECT t.k, t.w, t.l, t.o FROM unnest(p_keys, p_windows, p_limits) WITH ORDINALITY AS t(k, w, l, o) ORDER BY t.k, t.w LOOP
      ws := date_trunc(r.w, ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      INSERT INTO public.notification_send_budget AS b (bucket_key, window_start, used) VALUES (r.k, ws, 1)
        ON CONFLICT (bucket_key, window_start) DO UPDATE SET used = b.used + 1 WHERE b.used < r.l;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 0 THEN
        RAISE EXCEPTION 'send budget exhausted' USING ERRCODE = 'NB001', DETAIL = r.o::text;
      END IF;
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'NB001' THEN
    -- The block above is rolled back as a whole: the reservation row and every increment made so far disappear.
    GET STACKED DIAGNOSTICS failed = PG_EXCEPTION_DETAIL;
    RETURN 'limited:' || failed;
  END;
  -- Housekeeping, bounded per call: counters older than three days can never matter again.
  DELETE FROM public.notification_send_budget WHERE ctid IN (SELECT ctid FROM public.notification_send_budget WHERE window_start < ts - interval '3 days' LIMIT 20);
  RETURN 'reserved';
END
$reserve$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reserve_notification_send(text, text[], text[], integer[], timestamptz) FROM PUBLIC;
