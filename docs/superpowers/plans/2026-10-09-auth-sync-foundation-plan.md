# Native Authentication and Sync Foundation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task with review checkpoints.

**Goal:** Replace the Expo demo role picker with Supabase email/password authentication and make native product and sale sync compatible with the canonical Supabase schema.

**Architecture:** SQLite remains the local POS source of truth. Supabase Auth establishes identity and `profiles.role` establishes owner/staff permissions. Local rows keep integer IDs while stable client UUIDs and remote UUID mappings connect them to Supabase. Sales and product writes use idempotent server operations; failed sync remains queued.

**Tech Stack:** Expo SDK 52, React Native 0.76, Expo Router 4, expo-sqlite, expo-secure-store, Supabase JS 2, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-10-09-expenses-materials-production-design.md`

## Global Constraints

- Keep money in integer centavos.
- Preserve offline checkout; first sign-in requires network, previously authenticated users can keep using local data offline.
- Never store passwords; persist the session and cached role using Expo SecureStore.
- Read roles from Supabase `profiles.role`; owner-only access remains enforced by Supabase RLS online.
- Do not modify the separate `web/` POS behavior.
- Do not enable service-role keys in the client.

---

## File Structure

- `lib/supabase.ts`: one Supabase client configured with secure persisted auth.
- `auth/session.ts`: sign-in, session restoration, role caching, sign-out, and auth-state subscription.
- `auth/roles.ts`: pure owner/staff capability checks.
- `app/_layout.tsx`, `app/index.tsx`, and `app/(tabs)/_layout.tsx`: session gate and authenticated tab navigation.
- `app/(tabs)/*.tsx`: existing POS, Stock, Sales, and More screens moved under the authenticated tab group; update relative imports only.
- `app/login.tsx`: email/password sign-in screen.
- `app/settings.tsx` (under tabs): sign-out and current account display.
- `db/schema.sql`, `db/database.ts`, and new `db/productSync.ts`: versioned local IDs and local-to-remote product mapping.
- `sync/push.ts`, `sync/pull.ts`, and `sync/queue.ts`: canonical schema payloads, retry-safe product/sale sync, pending counts.
- `supabase/migrations/20261009180000_native_sync_foundation.sql`: backward-compatible product client ID and native sync RPC additions.
- `supabase/schema.sql`: canonical schema kept in sync with the new migration.
- `README.md` and `.env.example`: auth configuration, owner/staff provisioning, and first-login/offline behavior.

## Task 1: Configure Supabase Auth persistence

**Files:** Modify `package.json`, `lib/supabase.ts`; modify `app.json` only if SecureStore's Expo config plugin requires it.

**Interfaces:** `getSupabase(): SupabaseClient` remains the shared client. Configure `auth.storage`, `persistSession: true`, `autoRefreshToken: true`, and `detectSessionInUrl: false` with Expo SecureStore's async storage adapter.

- [ ] Add `expo-secure-store` at the Expo SDK 52 compatible version using `npx expo install expo-secure-store`.
- [ ] Configure the Supabase client to persist and refresh the session through SecureStore; keep URL and anon key sourced from the existing `EXPO_PUBLIC_*` variables.
- [ ] Confirm there is no service-role key or password persisted in app storage or source.

## Task 2: Add profile-backed session and route access

**Files:** Create `auth/session.ts`; modify `auth/roles.ts`, `app/login.tsx`, `app/_layout.tsx`, `app/index.tsx`, and move current screens into `app/(tabs)/` with import updates.

**Interfaces:**
- `type AppProfile = { userId: string; email: string; role: 'owner' | 'staff' }`
- `signIn(email: string, password: string): Promise<AppProfile>`
- `restoreSession(): Promise<AppProfile | null>`
- `signOut(): Promise<void>`
- `subscribeToAuthChanges(listener: (profile: AppProfile | null) => void): () => void`

- [ ] Implement `signIn` with Supabase Auth; fetch the caller's `profiles` row and reject missing/invalid roles with a readable error.
- [ ] Implement session restoration: use the persisted Supabase session online; after a network failure, permit local entry only when a cached profile from a previous successful sign-in exists.
- [ ] Cache only the user ID, email, and role in SecureStore; clear them and the Supabase session on sign-out.
- [ ] Replace the PIN/demo-role UI with email/password fields and a single sign-in action.
- [ ] Gate routes so unauthenticated users land on Login, staff can reach POS only, and owners can reach Stock, Sales, and Costs.
- [ ] Preserve the existing four bottom tabs for authenticated users; keep Login outside the tab bar.

## Task 3: Give local products stable cloud identity

**Files:** Modify `db/schema.sql`, `db/database.ts`, `sync/pull.ts`; create `db/productSync.ts`.

**Interfaces:**
- `getRemoteProductId(localProductId: number): Promise<string | null>`
- `upsertPulledProduct(remote: RemoteProduct): Promise<void>`
- `getUnsyncedProducts(limit?: number): Promise<LocalProduct[]>`
- `markProductSynced(localProductId: number, remoteId: string): Promise<void>`

- [ ] Add local `client_uuid` and nullable `remote_id` to products with unique indexes; keep the integer primary key so existing local sale foreign keys remain valid.
- [ ] Add a versioned migration that backfills stable client UUIDs for existing local products without changing product IDs or stock.
- [ ] Pull Supabase products by remote UUID and upsert locally by `remote_id`, never by assigning a UUID into the integer local primary key.
- [ ] Preserve local on-hand stock while local sales are pending; once that queue drains, apply the server balance. If server stock is lower than an offline sale requires, keep that sale pending and surface a conflict instead of creating negative stock.
- [ ] Apply remote name, barcode/SKU, price, cost, and category metadata by `remote_id` without replacing local pending product edits.

## Task 4: Align product and sale sync with the canonical cloud schema

**Files:** Modify `sync/push.ts`, `sync/pull.ts`, `sync/queue.ts`, `lib/supabase.ts`, and add the migration/function definitions in `supabase/migrations/20261009180000_native_sync_foundation.sql` and `supabase/schema.sql`.

**Interfaces:**
- `syncNow(): Promise<SyncResult>` reports pushed and remaining sales/products.
- `pushLocalProduct(product: LocalProduct): Promise<string>` returns its remote UUID.
- Existing sale `client_uuid` maps to canonical `sales.client_id`; local sale items map to canonical `sale_items` fields and remote product UUIDs.

- [ ] Add a nullable unique `products.client_id` to the canonical cloud table and an owner-only idempotent RPC that creates or updates a native-created product by client ID while returning its UUID.
- [ ] Push unsynced owner-created products first; save the returned UUID to the local `remote_id` mapping.
- [ ] Change native sale push to call `complete_pos_sale` with canonical `client_id`, `total_cents`, `profit_cents`, payment, timestamp, and lines containing remote product UUIDs and saved cost/price snapshots.
- [ ] Keep local sales queued until the server RPC confirms success; retries use the same sale client ID and cannot decrement stock or insert line items twice.
- [ ] Handle missing remote product mappings and insufficient server stock as visible queued sync errors; never mark those sales synced.
- [ ] Restrict schema and function grants to authenticated users and preserve the existing browser RPC signatures/behavior.

## Task 5: Document owner provisioning and offline limits

**Files:** Modify `.env.example` and `README.md`.

- [ ] Document the public Supabase URL/anon key configuration and that credentials must never include a service-role key.
- [ ] Document that account creation and `profiles` role assignment happen in Supabase Admin before first app sign-in.
- [ ] Document that first sign-in requires internet; previously signed-in users can use local data offline, but queued records require an authenticated session to sync.
- [ ] Document applying the new migration before enabling the native cloud sync.

## Completion Checks

- Owner and staff sign-ins resolve role from the caller's `profiles` record; the demo PIN cannot grant owner access.
- App restart restores a valid session; a previously signed-in account can enter local mode after network loss; sign-out clears offline access.
- Local integer product IDs map to remote UUIDs without changing saved sales.
- A sale reaches the canonical Supabase schema once; replaying the same queued sale does not duplicate a sale, item, or stock decrement.
- Missing auth, profile, product mapping, or available stock produces a recoverable sync message and keeps the row pending.
- Existing local-only POS checkout and the independent browser POS remain unchanged.
