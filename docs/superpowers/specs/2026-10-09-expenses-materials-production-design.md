# Costs, Materials, and Production Module

**Date:** 2026-10-09  
**Status:** Design approved in chat; awaiting written spec review  
**Target:** Native Expo Android app in `Documents/HORMACHUELOS/inventory-pos-app`

## Purpose

Give the store owner a reliable view of operating expenses, cash spent on stock, materials consumed in production, shop supplies used, stock losses, and estimated net profit. Entry must work offline and synchronize safely across devices when Supabase is configured.

The browser POS under `web/` is outside this change.

## Approved decisions

- Track both recipe-based production materials and shop supplies.
- Staff record production batches; confirming a batch consumes ingredients and adds finished quantity to product stock.
- Use weighted-average cost for materials.
- Keep expenses and movements usable offline in SQLite, then sync idempotently to Supabase.
- Add the owner-only Costs entry under the existing More tab.
- Report cash outflow separately from expenses recognized in profit.
- V1 excludes payroll, tax filing, supplier credit balances, and formal double-entry accounting.

## Workflow

### 1. Record a direct operating expense

The owner records date, category, amount in centavos, payment method, and optional vendor or note. Examples include rent, utilities, and transport. Expenses are immutable financial entries; corrections create a reversal and replacement entry.

### 2. Receive purchased materials or shop supplies

The owner chooses a material, quantity, unit, total cost, date, and payment method. Receipt increases on-hand stock and updates its weighted-average unit cost. The paid amount appears in cash outflow, while the purchase remains inventory rather than an immediate profit-and-loss expense.

V1 assumes purchases are paid when received; supplier credit tracking is out of scope.

### 3. Define recipes

A recipe links a sellable product to ingredient quantities per output unit. Material quantities use supported base units such as pieces, grams, and milliliters, with kg/liter input converted to base units. Recipe edits apply to future batches only.

### 4. Record a production batch

The owner selects a recipe and output quantity. The app derives ingredient quantities from the recipe and batch size, allows actual quantities consumed to be reviewed, and checks available stock. Confirming the batch atomically records ingredient consumption and cost snapshots, increases finished-product stock, and updates the product's current unit cost using weighted-average finished-goods cost. A batch with insufficient ingredients or invalid output is not partially saved.

Production transfers cost from ingredient inventory to finished-goods inventory; it does not recognize the cost as an expense yet. The existing sale flow snapshots product cost on each sale, so COGS is recognized when finished goods sell.

### 5. Record shop-supply use or waste

The owner records quantity and date for consumed supplies or lost/damaged material or finished goods. Shop-supply use is recognized as an operating expense. Waste is recorded as a separate loss. Both reduce stock and preserve the cost at the time of movement.

### 6. Review Costs and reports

The owner filters by date range and category and reviews:

- Paid cash outflow, including material receipts and direct expenses.
- Recognized expenses: direct expenses plus shop-supply use.
- COGS from saved sale-item cost snapshots.
- Waste/write-offs as a separate loss.
- Estimated net profit: net sales minus COGS, recognized expenses, and waste.

Inventory purchases are excluded from recognized expenses. Material consumed as a shop supply or written off is recognized at that movement; material used in production transfers into finished-goods inventory and is recognized as COGS only when the finished product sells. This prevents double counting.

## Application structure

- **Costs home:** period summary and links to expenses, materials, recipes, production, and waste.
- **Expenses:** category list, add form, searchable/date-filtered history.
- **Materials:** ingredient/supply catalog, on-hand quantity, unit, average cost, receive-stock action, and movement history.
- **Recipes:** product selector and ingredient lines with quantities per finished unit.
- **Production:** batch entry and immutable batch history.
- **Waste:** material or finished product, quantity, reason, and date.
- **Dashboard:** show estimated net profit and its components without replacing existing sales metrics.

Costs and inventory actions are owner-only, matching the existing role model. Staff retain POS-only access.

## Data and architecture

Use a modular feature over the existing SQLite database rather than a separate service:

- `expenses` and `expense_categories` for direct operating expenses.
- `materials` for ingredient and supply stock, unit, and weighted-average cost.
- `material_movements` as the immutable stock ledger for receipts, production use, supply use, adjustments, and waste. Each row stores quantity before/after and total movement cost in centavos.
- `recipes` and `recipe_items` for product-to-material definitions.
- `production_batches` and `production_batch_items` for output and immutable consumed-quantity/cost snapshots.
- Stable client-generated UUIDs and sync state for all replicated records.

Amounts are integer centavos, matching current SQLite conventions. Quantity is stored as an integer in the material's base unit to avoid fractional rounding drift. The material record maintains total inventory value in centavos; displayed average cost is derived from that value and quantity. Movement and batch lines snapshot their extended cost in centavos, avoiding rounding a fractional centavo unit price before multiplying. Each receipt, consumption, waste, or batch is one SQLite transaction. Product stock and cost updates happen in the same transaction as its production batch.

### Offline sync

SQLite is the local write path. New immutable records enter an outbox and are pushed with stable IDs so retrying a request cannot duplicate a movement or expense. Supabase uses matching tables, owner-only row-level security, and transactional RPCs for multi-row operations such as material receipt and production batch completion. Failed sync retains pending local records. A server-side stock conflict is surfaced for owner reconciliation; it is never silently overwritten.

Before adding these payloads, align the native sync adapter with the current Supabase schema. The checked-in Expo database and sync code use older integer IDs/field names than the Supabase schema, so sync compatibility is a prerequisite phase, not an assumption.

## Delivery phases

1. **Data/sync foundation:** document and reconcile native vs. Supabase identifiers and fields, add versioned SQLite and Supabase migrations, and establish idempotent owner-only outbox/RPC patterns.
2. **Expenses and material stock:** direct expenses, paid receipts, weighted-average material stock, supply use, and waste movements.
3. **Recipes and production:** recipe management, batch recording, atomic stock transfer, and sale-time product-cost snapshots.
4. **Reports:** period/category filters and net-profit calculation from sales, expenses, supply use, and waste.

Each phase must preserve existing offline checkout and avoid changing the browser POS. Schema changes require migration paths for already-installed Android builds.

## Risks and safeguards

- **Existing native/cloud schema drift:** reconcile before turning on new sync; test against a disposable Supabase project or local Supabase instance before production migration.
- **Concurrent offline production:** server RPC validates stock and idempotency. Conflicts remain queued with a clear reconciliation path rather than producing negative stock.
- **Cost history changes:** movements, batches, and sale items retain unit-cost snapshots. Recipe or cost edits affect future transactions only.
- **Double counting purchases:** reports separate cash outflow from recognized expenses; inventory purchase totals are not added directly to net-profit expenses.
- **Incomplete source data:** estimated net profit depends on recorded purchases, recipes, expenses, and waste. The screen should label the result as an estimate.

## Acceptance criteria

- Owners can add and review expenses offline; they synchronize once online without duplicate entries.
- Material receipt updates stock and weighted-average cost atomically and appears in cash outflow.
- Supply use reduces stock and is counted as an expense once.
- Waste reduces stock and appears separately as a loss.
- A production batch cannot partially apply; it deducts ingredients, adds finished stock, and snapshots cost together.
- Sale COGS uses the product cost saved on each sale item and is not recalculated from today's material prices.
- Reports distinguish cash spent, COGS, direct expenses, supply use, waste, and estimated net profit.
- Staff cannot access Costs, recipes, or financial summaries.
- Existing POS sale/stock behavior remains intact; browser POS is unchanged.
