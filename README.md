# Inventory POS App - Step 1 done

Offline Android app: Stock + POS + 58mm receipt + Sales dashboard.

## Step 1 includes

- App tabs: POS, Stock, Sales, Printer
- SQLite tables: products, sales, sale_items
- Safe checkout: sale + stock drop in one transaction
- Money in centavos (no rounding bugs)
- Receipt text builder for 58mm
- Profit saved at sale time (cost changes later won't rewrite history)

## Run it

1. `cd inventory-pos-app`
2. `npm install`
3. `npx expo start --dev-client` (printer needs Dev Client, not plain Expo Go)
4. Open on Android, add a product in Stock, sell it in POS

## Native app sign-in and sync

- Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`. The Android app persists its Supabase session and cached owner/staff profile with Expo SecureStore. Do not use a service-role key in the client.
- Create each internal account in Supabase Dashboard > Authentication, then add a matching `profiles` row with the same auth user ID and an `owner` or `staff` role. Use the Dashboard's privileged admin tools for initial profile provisioning; public sign-up is disabled in the app.
- First sign-in needs internet. A user who has signed in successfully before can continue using local POS data offline; synchronization needs an active Supabase session.
- Apply `supabase/migrations/20261009180000_native_sync_foundation.sql` after the existing POS and stock migrations. This adds a stable client product ID and owner-only native product sync RPC.
- Product rows keep integer IDs on the phone and map to Supabase UUIDs through `client_uuid` and `remote_id`. Sales are sent through `complete_pos_sale`; failed sends stay queued.

## Next steps

- Step 2: discounts, voids, reprint
- Step 3: real Bluetooth connect for your exact printer model
- Step 4: 7-day graph + best sellers + CSV export / backup
## Browser POS Stock Overview

The static browser POS (web/) includes a Stock overview, Products and History tabs. Stock edits and sales use the stock movement ledger and owner-only Supabase RPCs when online; offline changes remain in this browser's local storage until synced.

Before enabling this against a Supabase project, review and apply supabase/migrations/20261009000000_stock_movements.sql to that project's database (for example, from the repository root with supabase db push). This migration has not been applied to any remote database. Existing installations must apply it before using online checkout or stock changes. The migration also changes permissions so product stock, sales and sale items are written only through the RPCs.

Category name/color editing and online product saves require `supabase/migrations/20261009230000_category_name_color.sql`, after the earlier category migration. It adds the category color field, replaces the product-save RPC, and adds an owner-only RPC that renames and recolors all products in a category together. It also changes the uncategorized default to `N/Aa`. This migration has been tested locally and has not been applied to a remote database. Offline edits persist in this browser; existing offline product edits are not uploaded automatically when reconnecting.

Opening balances are recorded at migration time for existing products. Stock history before that point is not reconstructed; the first movement is the opening balance snapshot.
