-- GDRIVE-03 synthetic source data. Deterministic, invented, no personal or production data.
-- Used only against a disposable loopback PostgreSQL (CI service container or a local scratch cluster).
CREATE TABLE gd03_customers (
  id integer PRIMARY KEY,
  label text NOT NULL UNIQUE,
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 3)
);
CREATE TABLE gd03_orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES gd03_customers(id),
  total_minor integer NOT NULL CHECK (total_minor >= 0),
  note text
);
CREATE INDEX gd03_orders_customer_idx ON gd03_orders (customer_id);
CREATE VIEW gd03_order_totals AS
  SELECT customer_id, count(*) AS orders, sum(total_minor) AS total_minor FROM gd03_orders GROUP BY customer_id;
INSERT INTO gd03_customers SELECT g, 'synthetic-customer-' || g, (g % 3) + 1 FROM generate_series(1, 200) g;
INSERT INTO gd03_orders SELECT g, ((g * 7) % 200) + 1, (g * 137) % 50000, CASE WHEN g % 10 = 0 THEN NULL ELSE 'synthetic order ' || g END
  FROM generate_series(1, 2000) g;
