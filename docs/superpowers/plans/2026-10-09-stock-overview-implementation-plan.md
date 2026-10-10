# Stock Overview Implementation Plan

Date: 2026-10-09
Design: docs/superpowers/specs/2026-10-09-stock-overview-design.md

## Scope and implementation assumptions

Implement the approved Stock Overview in the static browser POS at /pos/, which is the interface used for the supplied page feedback. The project also contains an Expo client with a separate SQLite model and a different Supabase field contract. This plan leaves the Expo client unchanged; it must not be treated as using the new web data contract.

Keep the implementation within the current vanilla JavaScript, HTML, and CSS web app. Use the existing Supabase Postgres schema as the server source and preserve local demo/offline operation through the current localStorage data layer. Add migrations and client code, but do not apply migrations to a remote Supabase project as part of the code change.

The target app directory currently has no Git repository. Changes can be reviewed as files, but cannot be committed there until Git metadata is restored or the project is placed in a Git checkout.

## Relevant current structure

- web/index.html, web/app.js, web/styles.css: browser POS shell, views, rendering, and localStorage offline behavior.
- supabase/schema.sql: hosted schema for web products, sales, and sale items; products already include reorder_level; sales support active/voided status.
- db/schema.sql and db/database.ts: separate Expo SQLite model; intentionally outside this plan.
- Web sales currently update products and sale records through separate client calls when online. Offline sales are stored in pos_outbox and later pushed by syncNow().
- Web stock editing currently saves product values directly. Stock management UI already checks for owner access.
- There is no stock movement table or movement history.

## Data model and server operations

1. Add an idempotent SQL migration under supabase/migrations/ and keep supabase/schema.sql consistent with the deployed schema source.
2. Create stock_movements with:
   - UUID primary key and product reference that becomes nullable if a product is deleted.
   - Product name snapshot, movement type, quantity delta, before/after quantities, reason, source sale/item reference, actor, occurrence time, and stable unique source key.
   - Movement types opening_balance, sale, void_reversal, restock, and adjustment.
   - Checks for nonnegative balances, positive restock quantities, nonzero manual adjustments, and opening balances that can represent zero-stock products.
   - Indexes for time, product, and source lookups.
3. Add opening-balance rows for existing products with a stable unique source key so applying the migration more than once cannot duplicate them. Treat this migration timestamp as the start of trustworthy stock movement history.
4. Add a SECURITY DEFINER owner mutation function for restocks and adjustments. It validates role, quantity, reason, source-key idempotency, and expected current stock; balance update and ledger insert occur atomically. A stale expected balance returns a recoverable conflict and must not overwrite stock.
5. Add an idempotent sale RPC used by the web client both online and during outbox replay. In one transaction it creates or returns the sale by client_id, inserts sale items once, decrements stock, and writes one movement per product line using stable source keys.
6. Add an owner-only void RPC. In one transaction it marks an active sale voided, restores product quantities from its sale items, and inserts idempotent void-reversal movements. A repeated request cannot restore stock twice.
7. Tighten relevant RLS and grants: owners can read movement history and invoke stock mutation operations; authenticated staff can complete normal sales only through the sale RPC; direct client updates cannot bypass the stock ledger. Keep normal movement records append-only.

## Web data layer and offline behavior

1. Add a focused stock data layer in web/app.js (or a small web/stock.js module if script loading supports it) for fetching summary data, movement history, restocks, adjustments, and synchronization.
2. In Supabase mode, read current products and movements from the server. Calculate valuation from stock * cost_cents, low stock from 1..reorder_level, and out of stock from stock === 0. Use the period selector for Today, Last 7 days (default), and Last 30 days; count sale movement units as sold and restock movement units as received.
3. In local/demo mode, calculate summary from local products and persist movements in a versioned localStorage key. Record initial balances once, and do not fabricate pre-ledger sales history.
4. Give each offline restock/adjustment a stable client-generated movement UUID and persist it in a movement outbox before updating local stock. Replay movements in order with the same UUID; server idempotency prevents duplicates.
5. Keep pending movements visible in Overview and History with a pending-sync state. Failed sync retains the queued item. On stale-balance conflicts, preserve it and show a clear recoverable message/action rather than silently replacing local or server stock.
6. Convert online sale completion and voiding to the new atomic RPCs. Keep local outbox behavior intact and use deterministic movement source keys derived from sale client ID and line identity. Avoid duplicate item inserts and stock decrements during retries.
7. Change product edit behavior so changing stock after initial setup creates an adjustment movement with an explicit reason. Preserve name, price, cost, SKU, and reorder-level edits. Keep delete behavior, relying on the ledger product-name snapshot when product references are removed.

## Stock module interface

1. Add Overview, Products, and History tabs inside the current Stock view; Overview is the default when Stock opens.
2. Overview: mobile-first 2x2 KPI layout for product count, low/out-of-stock counts, stock value at cost, and selected-period sold/received units. Include period control, Restock and Adjust stock actions, a recent-movements section, and explicit offline/pending-sync states.
3. Products: retain current searchable product list and its owner-only edit/delete behavior.
4. History: newest-first list of sales, void reversals, restocks, and adjustments, showing occurrence time, product, signed quantity change, actor, and reason or sale reference.
5. Restock flow requires product and positive quantity; adjustment requires product, nonzero signed quantity, and a nonblank reason. Confirm the resulting balance before saving.
6. Keep the UI responsive from the supplied 394px viewport through desktop. Preserve keyboard access, visible focus, readable contrast, and touch-usable controls. Empty, load-error, offline, and pending states must be distinct.

## Suggested file sequence

1. supabase/migrations/<timestamp>_stock_movements.sql — ledger, indexes, backfill, RPCs, RLS, grants.
2. supabase/schema.sql — canonical schema parity.
3. web/app.js and optionally web/stock.js — view selection, summary/history rendering, validations, mutation calls, online sale/void RPC integration, offline movement queue.
4. web/index.html — Stock sub-navigation, Overview/Products/History containers, and restock/adjustment dialogs.
5. web/styles.css — mobile-first KPI, movement list, form/dialog, pending/error states, desktop layout.
6. Update README.md with migration order, web feature scope, offline replay behavior, and the point where movement history begins.

## Implementation order and checkpoints

### Phase 1: Reconcile schema and migration

- Confirm the live schema names match the web client fields before defining function arguments.
- Write migration with idempotent opening balances, indexes, RLS, atomic mutation RPCs, and stable idempotency rules.
- Review the full migration against existing sales/void columns and current owner helper.
- Checkpoint: migration can be applied on a database created from the current supabase/schema.sql without destructive table replacement.

### Phase 2: Add data operations and offline queue

- Implement local and Supabase read/write paths for movements.
- Route online sale, void, restock, and adjustment mutations through atomic operations.
- Store offline sales and stock movements durably, replay in order, and preserve failed/conflicting entries.
- Checkpoint: every successful quantity change has exactly one ledger entry; retry does not apply it twice.

### Phase 3: Add Stock views and forms

- Add Overview, Products, and History navigation while retaining existing inventory controls under Products.
- Render mobile KPIs, date range, actions, recent movements, search, and full history.
- Add accessible restock/adjust dialogs and states for empty, loading, offline, and sync errors.
- Checkpoint: all views work at the supplied mobile viewport and desktop widths; only owners can mutate stock.

### Phase 4: Documentation and validation

- Document the migration and ledger-history start date.
- Manually validate demo/local mode and Supabase-backed mode: initial balances, KPI calculations, period filters, restock, reasoned positive/negative adjustment, sale, void, pending offline replay, retry idempotency, stale-stock conflict, and owner/staff access.
- Run the project’s existing build/type/syntax checks only where available and relevant. Do not treat the separate Expo client as covered by these web checks.
- Do not apply the migration to a remote database without a separate explicit request.

## Acceptance checklist

- Stock opens to Overview; Products and History remain available.
- KPI counts/value/period totals follow the approved spec exactly, with low and out-of-stock categories disjoint.
- Restock and adjustment record one movement and update stock atomically online.
- Product stock edits become reasoned adjustments.
- Sales and voids change stock and add one corresponding movement; repeated sync or RPC calls do not duplicate either effect.
- Offline mutations remain visible and queued through reload; successful replay clears their pending state; failures remain retryable.
- Server policy prevents staff from directly changing stock or writing arbitrary movements.
- Historical reports do not imply movement information earlier than initial-balance rollout.
- Existing POS sales and current product search/edit/delete flows continue to work.