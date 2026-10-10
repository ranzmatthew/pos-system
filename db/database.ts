import * as SQLite from 'expo-sqlite';

// Single shared database connection.
let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) db = SQLite.openDatabaseSync('inventory-pos.db');
  return db;
}

// Create tables on first launch, and upgrade old installs.
export async function initDb(): Promise<void> {
  const d = getDb();
  await d.execAsync(`
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
  `);

  const version = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (Number(version?.user_version ?? 0) < 1) {
    // Migration 1: preserve local integer product IDs while adding stable cloud
    // mappings. Each ALTER skips if a partially applied/fresh schema has it.
    for (const sql of [
      `ALTER TABLE products ADD COLUMN client_uuid TEXT`,
      `ALTER TABLE products ADD COLUMN remote_id TEXT`,
      `ALTER TABLE products ADD COLUMN synced INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized'`,
      `ALTER TABLE sales ADD COLUMN client_uuid TEXT DEFAULT NULL`,
      `ALTER TABLE sales ADD COLUMN synced INTEGER NOT NULL DEFAULT 0`,
    ]) {
      try { await d.execAsync(sql); } catch { /* Already present in a fresh or partially migrated database. */ }
    }

    // Old sales keep their IDs and get stable idempotency keys; products get
    // valid UUIDs without changing any local sale-item foreign keys.
    await d.execAsync(`UPDATE sales SET client_uuid = 'local-' || id WHERE client_uuid IS NULL OR client_uuid = '';`);
    const productsWithoutClientId = await d.getAllAsync<{ id: number }>(
      'SELECT id FROM products WHERE client_uuid IS NULL OR client_uuid = \'\''
    );
    for (const product of productsWithoutClientId) {
      await d.runAsync('UPDATE products SET client_uuid = ? WHERE id = ?', [makeClientUuid(), product.id]);
    }
    await d.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_client_uuid ON products(client_uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_remote_id ON products(remote_id) WHERE remote_id IS NOT NULL;
    `);
    await d.execAsync('PRAGMA user_version = 1');
  }
  await d.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_uuid_unique ON sales(client_uuid);
  `);
}

// Random ID for each sale. Two offline phones will never pick the same one.
export function makeClientUuid(): string {
  const part = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  const a = part();
  const b = part().slice(0, 4);
  const c = '4' + part().slice(1, 4);
  const d = ((parseInt(part().slice(0, 2), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + part().slice(2, 4);
  const e = part() + part().slice(0, 4);
  return `${a}-${b}-${c}-${d}-${e}`;
}

export async function countUnsyncedProducts(): Promise<number> {
  const row = await getDb().getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM products WHERE synced = 0');
  return Number(row?.n ?? 0);
}

export type CartLine = { productId: number; qty: number };

// The most important rule: sale + stock update happen together.
// If the app crashes halfway, neither half is saved alone.
export async function saveSale(
  lines: CartLine[],
  cashReceived: number
): Promise<{ saleId: number; clientUuid: string; total: number; change: number }> {
  const d = getDb();

  // Load current price, cost and stock for each product.
  let total = 0;
  let profit = 0;
  const detailed: { productId: number; qty: number; price: number; cost: number }[] = [];

  for (const line of lines) {
    const row = await d.getFirstAsync<{ price: number; cost: number; stock: number }>(
      'SELECT price, cost, stock FROM products WHERE id = ?',
      [line.productId]
    );
    if (!row) throw new Error('Product not found: ' + line.productId);
    if (row.stock < line.qty) throw new Error('Not enough stock.');
    const lineTotal = row.price * line.qty;
    const lineProfit = (row.price - row.cost) * line.qty;
    total += lineTotal;
    profit += lineProfit;
    detailed.push({ productId: line.productId, qty: line.qty, price: row.price, cost: row.cost });
  }

  if (cashReceived < total) throw new Error('Cash is less than total.');
  const change = cashReceived - total;
  const clientUuid = makeClientUuid();
  let saleId = 0;

  // Save sale, items and stock drop in one transaction.
  // synced = 0 means "waiting in the outbox, send when online".
  await d.withTransactionAsync(async () => {
    const res = await d.runAsync(
      'INSERT INTO sales (client_uuid, total, profit, payment_type, cash_received, change_given, synced) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [clientUuid, total, profit, 'cash', cashReceived, change]
    );
    saleId = Number(res.lastInsertRowId);

    for (const item of detailed) {
      await d.runAsync(
        'INSERT INTO sale_items (sale_id, product_id, qty, price, cost, line_total, line_profit) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [saleId, item.productId, item.qty, item.price, item.cost, item.price * item.qty, (item.price - item.cost) * item.qty]
      );
      await d.runAsync('UPDATE products SET stock = stock - ? WHERE id = ?', [item.qty, item.productId]);
    }
  });

  return { saleId, clientUuid, total, change };
}

export type QueuedItem = {
  productId: number;
  name: string;
  qty: number;
  price: number;
  cost: number;
  lineTotal: number;
  lineProfit: number;
};

export type QueuedSale = {
  localId: number;
  clientUuid: string;
  total: number;
  profit: number;
  paymentType: string;
  cashReceived: number;
  changeGiven: number;
  createdAt: string;
  items: QueuedItem[];
};

// The outbox: every sale with synced = 0 is waiting to send.
export async function getUnsyncedSales(): Promise<QueuedSale[]> {
  const d = getDb();
  const sales = await d.getAllAsync<{
    id: number;
    client_uuid: string;
    total: number;
    profit: number;
    payment_type: string;
    cash_received: number;
    change_given: number;
    created_at: string;
  }>('SELECT id, client_uuid, total, profit, payment_type, cash_received, change_given, created_at FROM sales WHERE synced = 0 ORDER BY id ASC LIMIT 50');

  const out: QueuedSale[] = [];
  for (const s of sales) {
    const items = await d.getAllAsync<{
      product_id: number;
      name: string;
      qty: number;
      price: number;
      cost: number;
      line_total: number;
      line_profit: number;
    }>(
      'SELECT si.product_id, p.name, si.qty, si.price, si.cost, si.line_total, si.line_profit FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?',
      [s.id]
    );
    out.push({
      localId: s.id,
      clientUuid: s.client_uuid,
      total: s.total,
      profit: s.profit,
      paymentType: s.payment_type,
      cashReceived: s.cash_received,
      changeGiven: s.change_given,
      createdAt: s.created_at,
      items: items.map((i) => ({
        productId: i.product_id,
        name: i.name,
        qty: i.qty,
        price: i.price,
        cost: i.cost,
        lineTotal: i.line_total,
        lineProfit: i.line_profit,
      })),
    });
  }
  return out;
}

export async function markSaleSynced(clientUuid: string): Promise<void> {
  await getDb().runAsync('UPDATE sales SET synced = 1 WHERE client_uuid = ?', [clientUuid]);
}

export async function countUnsynced(): Promise<number> {
  const row = await getDb().getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM sales WHERE synced = 0');
  return Number(row?.n ?? 0);
}

export async function getSyncValue(key: string): Promise<string> {
  const row = await getDb().getFirstAsync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
  return row?.value ?? '';
}

export async function setSyncValue(key: string, value: string): Promise<void> {
  await getDb().runAsync('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

// Helper: pesos string for the screen. 12500 -> "125.00"
export function pesos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}
