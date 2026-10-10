Y# Stock Overview and Movement History

Date: 2026-10-09

## Goal

Give store owners a clear view of inventory health and recent stock activity, while making stock changes auditable and keeping offline sales/restocks safe to synchronize.

## Current context

The POS app stores current stock on products and changes that balance during sales, voids, and product edits. It has no complete stock movement ledger. Stock management is owner-only. Sales and sale items are already persisted, and the application supports offline operation and synchronization.

## User experience

The Stock module has three views: Overview, Products, and History. Overview is the default view and is designed for a phone screen first.

Overview contains a compact 2-by-2 summary:
- Active product count.
- Low-stock and out-of-stock counts, using each product's reorder level.
- Inventory value at cost, computed from current quantity multiplied by unit cost.
- Units sold and received over a selectable period, defaulting to the last 7 days with Today and Last 30 days options.

Provide Restock and Adjust stock actions. Restock records incoming quantity. Adjustment records a signed quantity change and requires a reason. Products remains the searchable inventory list and retains existing edit behavior. History lists sales, voids, restocks, and manual adjustments with time, product/quantity impact, actor, and reason or sale reference where applicable. Empty and offline states must be clear.

All stock management controls remain owner-only, matching current permissions.

## Data model and behavior

Keep products.stock as the current on-hand balance. Add an append-only stock movement ledger with a stable unique ID, product reference, movement type, signed quantity delta, before and after balances, reason or source sale reference, actor, occurrence timestamp, and sync metadata as needed by the existing offline queue.

Movement types include opening balance, sale, void reversal, restock, and manual adjustment. Sales and voids must be represented exactly once and linked to their existing sale records. Restocks and adjustments write a movement and update the product balance as one logical operation. Editing a product's opening stock after initial setup must create an adjustment movement rather than silently rewriting history.

When movement tracking is introduced, create an opening-balance movement for each existing product. This establishes the reporting start date; do not imply that earlier historical movement data exists.

Offline mutations are queued and synchronized idempotently using stable movement IDs. Synchronization must not apply a movement twice. Preserve the app's existing offline sales behavior. Where a sale or void already has a canonical persisted record, derive/link its movement rather than creating a second source of truth.

## Reporting rules

- Current inventory value is current on-hand quantity multiplied by cost.
- Out of stock means on-hand quantity is zero. Low stock means on-hand quantity is above zero and at or below the configured reorder level, so the categories do not overlap.
- Period movement totals use movement occurrence timestamps and distinguish sold units from restocked units; adjustments and void reversals remain separately visible in History. The period selector defaults to the last 7 days and offers Today and Last 30 days.
- Overview values reflect the locally available state while offline and communicate pending sync status.
- Do not backfill sales history into the ledger as though it were a complete historic movement record. Existing sales remain available in sales views; the ledger's trustworthy history begins at rollout.

## Reliability and error handling

A movement and its balance change must be atomic on the server. Failed sync must retain the local queued mutation and expose a retryable state. Conflicting or invalid adjustments must not silently overwrite a newer server balance; surface a recoverable sync conflict. Prevent duplicate sale/void movements with idempotency keys tied to their source records.

## Security

Enforce the existing owner-only stock permissions in the UI and database policies/RPCs. Validate positive restock quantities, nonzero adjustment quantities, and nonblank adjustment reasons on both client and server. Restrict movement updates/deletes; the ledger is append-only for normal application paths.

## Scope boundaries

Included: Stock Overview, Products and History navigation; KPI and period summaries; restock and reasoned adjustment flows; movement ledger; opening-balance initialization; sale/void linkage; offline queue synchronization; owner-only enforcement.

Excluded: supplier management, purchase orders, forecasting, barcode hardware workflows, multi-location inventory, and historical reconstruction beyond the reliable ledger start date.

## Acceptance criteria

1. Stock opens to an Overview that displays product count, low/out-of-stock counts, cost valuation, and period units sold/received.
2. Users can navigate Overview, Products, and History on mobile and desktop.
3. A restock changes current stock and creates one corresponding movement.
4. An adjustment requires a reason, changes stock, and creates one movement with before/after quantities.
5. Sales decrement stock and appear once in History; voids restore stock and appear once as reversals.
6. Existing products receive opening-balance entries at rollout without inventing earlier movement history.
7. Offline movements remain visible locally, survive reload, and sync once when connectivity returns.
8. Non-owner users cannot use stock mutation actions or bypass them through server APIs.
9. The current Products management flow remains available under its tab, and reporting distinguishes not-yet-synced data.

## Validation targets

- API/server mutation latency: p50 <= 200 ms, p95 <= 500 ms, p99 <= 1000 ms under normal local or hosted service conditions.
- Mobile frontend: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 on mobile 4G.
- Availability objective: 99.5% monthly for hosted stock reads and mutations; offline POS stock operations remain usable during service outages.

These are initial product targets, to be measured against the existing deployment and adjusted if its hosting capabilities differ.

## Open implementation constraints

The target app directory currently has no .git directory, so the required design-spec commit cannot be created there unless repository metadata is restored or the app is placed in a Git checkout. The spec can still be reviewed as a file. The implementation plan must identify how migrations and offline sync integrate with the existing schema and queue before product code changes begin.

