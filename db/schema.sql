-- Inventory POS database
-- Money is stored in centavos (integers) to avoid rounding errors.
-- Example: 12500 = 125.00 pesos.

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT,
  remote_id TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  barcode TEXT DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'Uncategorized',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_client_uuid ON products(client_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_remote_id ON products(remote_id) WHERE remote_id IS NOT NULL;

-- client_uuid lets two phones create sales offline without clashing online.
-- synced = 0 means "waiting to send", synced = 1 means "online already".
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT DEFAULT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  profit INTEGER NOT NULL DEFAULT 0,
  payment_type TEXT NOT NULL DEFAULT 'cash',
  cash_received INTEGER NOT NULL DEFAULT 0,
  change_given INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0,
  line_profit INTEGER NOT NULL DEFAULT 0
);

-- Small key-value store. Used for last sync time.
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_uuid ON sales(client_uuid);
CREATE INDEX IF NOT EXISTS idx_sales_synced ON sales(synced);
CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
