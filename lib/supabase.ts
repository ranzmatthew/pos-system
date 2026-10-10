// Online database connection (Supabase Postgres).
// Keys stay in .env, never in code. See .env.example.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anon) {
    throw new Error('Missing Supabase setup. Copy .env.example to .env and fill it in.');
  }
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        storage: {
          getItem: (key) => SecureStore.getItemAsync(key),
          setItem: (key, value) => SecureStore.setItemAsync(key, value),
          removeItem: (key) => SecureStore.deleteItemAsync(key),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

// Shape of the online tables. Mirrors the local SQLite tables.
export type RemoteSale = {
  client_uuid: string;
  total: number;
  profit: number;
  payment_type: string;
  cash_received: number;
  change_given: number;
  created_at: string;
};

export type RemoteSaleItem = {
  sale_uuid: string;
  product_id: number;
  qty: number;
  price: number;
  cost: number;
  line_total: number;
  line_profit: number;
};
