// The local database is the write path. This outbox sends stable IDs through
// owner-scoped RPCs so replaying a queued operation cannot duplicate it.
import {
  countUnsynced,
  countUnsyncedProducts,
  getDb,
  getUnsyncedSales,
  markSaleSynced,
  setSyncValue,
} from '../db/database';
import { getRemoteProductId, getUnsyncedProducts, markProductSynced } from '../db/productSync';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';

export type SyncResult = {
  pushed: number;
  remaining: number;
  pushedSales: number;
  pushedProducts: number;
  remainingSales: number;
  remainingProducts: number;
  note: string;
};

export async function pushLocalProduct(product: Awaited<ReturnType<typeof getUnsyncedProducts>>[number]): Promise<string> {
  const clientId = getSupabase();
  const queued = await getDb().getFirstAsync<{ qty: number }>(
    `SELECT COALESCE(SUM(si.qty), 0) AS qty
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE si.product_id = ? AND s.synced = 0`,
    [product.id]
  );
  // The first remote stock value includes units already reserved by queued
  // sales. The sale RPC then applies those queued decrements exactly once.
  const initialStock = product.stock + Number(queued?.qty ?? 0);
  const { data, error } = await clientId.rpc('save_native_product', {
    p_client_id: product.client_uuid,
    p_name: product.name,
    p_sku: product.barcode || null,
    p_price_cents: product.price,
    p_cost_cents: product.cost,
    p_stock: initialStock,
    p_category: product.category || 'Uncategorized',
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error(`Supabase did not return a product ID for ${product.name}.`);
  await markProductSynced(product, data);
  return data;
}

function emptyResult(note: string, remainingSales: number, remainingProducts: number): SyncResult {
  return {
    pushed: 0,
    remaining: remainingSales + remainingProducts,
    pushedSales: 0,
    pushedProducts: 0,
    remainingSales,
    remainingProducts,
    note,
  };
}

export async function syncNow(): Promise<SyncResult> {
  const sales = await getUnsyncedSales();
  const salesCount = await countUnsynced();
  const products = await getUnsyncedProducts();
  const productCount = await countUnsyncedProducts();
  if (salesCount === 0 && productCount === 0) return emptyResult('Everything is synced.', 0, 0);
  if (!isSupabaseConfigured()) {
    return emptyResult('Supabase is not configured. Changes stay on this phone.', salesCount, productCount);
  }

  let pushedSales = 0;
  let pushedProducts = 0;
  try {
    const online = getSupabase();
    const { data: sessionData, error: sessionError } = await online.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) throw new Error('Sign in before sending queued changes.');

    for (const product of products) {
      await pushLocalProduct(product);
      pushedProducts += 1;
    }

    for (const sale of sales) {
      const lines = [];
      for (const item of sale.items) {
        const remoteProductId = await getRemoteProductId(item.productId);
        if (!remoteProductId) {
          throw new Error(`Product mapping is missing for ${item.name}. Sale ${sale.clientUuid} remains queued.`);
        }
        lines.push({
          product_id: remoteProductId,
          name: item.name,
          qty: item.qty,
          price_cents: item.price,
          cost_cents: item.cost,
        });
      }
      const { error } = await online.rpc('complete_pos_sale', {
        p_sale: {
          client_id: sale.clientUuid,
          subtotal_cents: sale.total,
          discount_type: 'none',
          discount_cents: 0,
          total_cents: sale.total,
          profit_cents: sale.profit,
          payment: sale.paymentType,
          created_at: sale.createdAt,
          lines,
        },
      });
      if (error) throw error;
      await markSaleSynced(sale.clientUuid);
      pushedSales += 1;
    }

    await setSyncValue('last_push', new Date().toISOString());
  } catch (error: any) {
    const remainingSales = await countUnsynced();
    const remainingProducts = await countUnsyncedProducts();
    const pushed = pushedSales + pushedProducts;
    return {
      pushed,
      remaining: remainingSales + remainingProducts,
      pushedSales,
      pushedProducts,
      remainingSales,
      remainingProducts,
      note: error?.message ?? 'No internet. Changes remain queued.',
    };
  }

  const remainingSales = await countUnsynced();
  const remainingProducts = await countUnsyncedProducts();
  const pushed = pushedSales + pushedProducts;
  const remaining = remainingSales + remainingProducts;
  return {
    pushed,
    remaining,
    pushedSales,
    pushedProducts,
    remainingSales,
    remainingProducts,
    note: remaining === 0
      ? `${pushedSales} sale(s) and ${pushedProducts} product(s) sent.`
      : `${pushed} record(s) sent; ${remainingSales} sale(s) and ${remainingProducts} product(s) still waiting.`,
  };
}
