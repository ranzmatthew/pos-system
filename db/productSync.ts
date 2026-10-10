import { getDb, makeClientUuid } from './database';

export type LocalProduct = {
  id: number;
  client_uuid: string;
  remote_id: string | null;
  name: string;
  barcode: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
};

export type RemoteProduct = {
  id: string;
  client_id: string | null;
  name: string;
  sku: string | null;
  price_cents: number;
  cost_cents: number;
  stock: number;
  category: string;
  reorder_level: number;
};

export async function upsertPulledProduct(remote: RemoteProduct): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    let local = await db.getFirstAsync<{ id: number; synced: number }>(
      'SELECT id, synced FROM products WHERE remote_id = ? OR (? IS NOT NULL AND client_uuid = ?) LIMIT 1',
      [remote.id, remote.client_id, remote.client_id]
    );
    if (!local) {
      await db.runAsync(
        `INSERT INTO products (client_uuid, remote_id, synced, name, barcode, price, cost, stock, category)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [remote.client_id ?? makeClientUuid(), remote.id, remote.name, remote.sku ?? '', remote.price_cents,
          remote.cost_cents, remote.stock, remote.category ?? 'Uncategorized']
      );
      return;
    }

    const pending = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = ? AND s.synced = 0',
      [local.id]
    );
    const preserveLocal = local.synced === 0;
    const preserveStock = Number(pending?.count ?? 0) > 0;
    await db.runAsync(
      `UPDATE products SET remote_id = ?, synced = CASE WHEN ? THEN 0 ELSE 1 END,
       name = CASE WHEN ? THEN name ELSE ? END,
       barcode = CASE WHEN ? THEN barcode ELSE ? END,
       price = CASE WHEN ? THEN price ELSE ? END,
       cost = CASE WHEN ? THEN cost ELSE ? END,
       category = CASE WHEN ? THEN category ELSE ? END,
       stock = CASE WHEN ? THEN stock ELSE ? END
       WHERE id = ?`,
      [remote.id, preserveLocal ? 1 : 0,
        preserveLocal ? 1 : 0, remote.name,
        preserveLocal ? 1 : 0, remote.sku ?? '',
        preserveLocal ? 1 : 0, remote.price_cents,
        preserveLocal ? 1 : 0, remote.cost_cents,
        preserveLocal ? 1 : 0, remote.category ?? 'Uncategorized',
        preserveStock ? 1 : 0, remote.stock,
        local.id]
    );
  });
}

export async function getRemoteProductId(localProductId: number): Promise<string | null> {
  const row = await getDb().getFirstAsync<{ remote_id: string | null }>(
    'SELECT remote_id FROM products WHERE id = ?', [localProductId]
  );
  return row?.remote_id ?? null;
}

export async function getUnsyncedProducts(limit = 50): Promise<LocalProduct[]> {
  return getDb().getAllAsync<LocalProduct>(
    `SELECT id, client_uuid, remote_id, name, barcode, price, cost, stock, category
     FROM products WHERE synced = 0 ORDER BY id LIMIT ?`, [limit]
  );
}

export async function markProductSynced(snapshot: LocalProduct, remoteId: string): Promise<void> {
  // Keep the remote mapping even if the row changed during the network request.
  // In that case, leave it pending so the newer local values are pushed next.
  await getDb().runAsync(
    `UPDATE products SET remote_id = ?,
     synced = CASE WHEN client_uuid IS ? AND name IS ? AND barcode IS ? AND price IS ?
       AND cost IS ? AND stock IS ? AND category IS ? THEN 1 ELSE 0 END
     WHERE id = ?`,
    [remoteId, snapshot.client_uuid, snapshot.name, snapshot.barcode, snapshot.price,
      snapshot.cost, snapshot.stock, snapshot.category, snapshot.id]
  );
}
