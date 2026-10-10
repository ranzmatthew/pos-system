// The outbox in plain words:
// Every sale saved offline has synced = 0.
// That row IS the queue. No extra table to lose.
import { countUnsynced, countUnsyncedProducts, getUnsyncedSales } from '../db/database';

export async function countPending(): Promise<number> {
  return (await countUnsynced()) + (await countUnsyncedProducts());
}

export async function describePending(): Promise<string> {
  const pending = await getUnsyncedSales();
  const pendingProducts = await countUnsyncedProducts();
  if (pending.length === 0 && pendingProducts === 0) return 'Everything is synced.';
  const oldest = pending[0]?.createdAt;
  return `${pending.length} sale(s) and ${pendingProducts} product(s) waiting${oldest ? `. Oldest sale: ${oldest}` : ''}`;
}
