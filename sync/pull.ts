// Pull canonical UUID products into local integer-ID rows through an explicit
// mapping. Local sale foreign keys are never overwritten with cloud IDs.
import { setSyncValue } from '../db/database';
import { upsertPulledProduct, type RemoteProduct } from '../db/productSync';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';

export async function pullProducts(): Promise<{ updated: number; note: string }> {
  if (!isSupabaseConfigured()) return { updated: 0, note: 'Supabase is not configured.' };
  try {
    const online = getSupabase();
    const { data: auth, error: authError } = await online.auth.getSession();
    if (authError) throw authError;
    if (!auth.session) return { updated: 0, note: 'Sign in before pulling products.' };

    const { data, error } = await online
      .from('products')
      .select('id, client_id, name, sku, price_cents, cost_cents, stock, category, reorder_level')
      .order('name');
    if (error) throw error;
    let updated = 0;
    for (const product of (data ?? []) as RemoteProduct[]) {
      await upsertPulledProduct(product);
      updated += 1;
    }
    await setSyncValue('last_pull', new Date().toISOString());
    return { updated, note: updated ? `${updated} product(s) refreshed from Supabase.` : 'No online products yet.' };
  } catch (error: any) {
    return { updated: 0, note: error?.message ?? 'No internet. Keeping local products.' };
  }
}
