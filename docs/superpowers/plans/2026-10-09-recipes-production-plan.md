# Recipes and Production Plan

> **For agentic workers:** Use `superpowers:executing-plans` after the auth/sync foundation and Costs/material stock plans are complete.

**Goal:** Let owners define recipes, record actual production batches, transfer ingredient value into finished-goods stock atomically, and preserve cost history for later sales.

**Architecture:** Recipes describe material quantity per finished product unit. Batch confirmation snapshots actual quantities and current weighted-average input costs, deducts ingredients, increases product stock, and recalculates the finished product's weighted-average unit cost in one SQLite transaction. A matching Supabase RPC makes the same operation atomic online.

**Tech Stack:** Expo SDK 52, React Native, expo-sqlite, Supabase JS 2, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-10-09-expenses-materials-production-design.md`

## Global Constraints

- Complete the auth/sync foundation and Costs/material stock plans first.
- Recipe edits affect future batches only; confirmed batch lines and sale-item costs are immutable snapshots.
- Never allow a batch to leave ingredient stock negative or partially update finished-product stock.
- Material consumption transfers value into finished goods; it is not an expense until finished goods sell.
- Product output uses the existing integer stock unit; recipe ingredient quantity uses the material base units.
- Owner-only access, secure offline behavior, and no changes to `web/` remain mandatory.

---

## File Structure

- `db/schema.sql`, `db/database.ts`: recipe and production SQLite schema/migrations.
- `db/production.ts`: recipe CRUD, batch calculation, local transaction, and history queries.
- `supabase/migrations/20261009200000_recipes_production.sql`, `supabase/schema.sql`: recipe/batch tables, RLS, and atomic batch RPC.
- `sync/push.ts`, `sync/pull.ts`: recipe sync ordering, batch outbox/replay, and conflict status.
- `app/costs/recipes.tsx`: owner recipe list/editor.
- `app/costs/production.tsx`: batch form and production history.
- `components/RecipeForm.tsx`, `ProductionBatchForm.tsx`: recipe and batch input components.

## Task 1: Add recipe and batch records

**Files:** Modify `db/schema.sql`, `db/database.ts`; create `db/production.ts`.

**Interfaces:**
- `type RecipeDraft = { clientUuid: string; productId: number; name: string; lines: { materialId: number; quantityPerUnit: number }[] }`
- `type ProductionBatchDraft = { clientUuid: string; recipeId: number; outputQuantity: number; occurredAt: string; actualLines: { materialId: number; quantity: number }[] }`
- `type ProductionBatchResult = { batchId: number; outputQuantity: number; batchCostCents: number; unitCostCents: number }`
- `saveRecipe(draft: RecipeDraft): Promise<number>`
- `completeProductionBatch(draft: ProductionBatchDraft): Promise<ProductionBatchResult>`
- `listRecipes(): Promise<Recipe[]>`
- `listProductionBatches(from: string, to: string): Promise<ProductionBatch[]>`

- [ ] Add `recipes`, `recipe_items`, `production_batches`, and `production_batch_items` with stable client UUIDs, product/material FKs, quantity checks, unit-cost snapshots, total-cost snapshots, and sync state.
- [ ] Add indexes for product, date, material, and client UUID; add versioned upgrades without altering existing product or sale rows.
- [ ] Implement `saveRecipe` to require an existing sellable product, at least one ingredient line, unique material IDs, positive ingredient quantities, and kind `ingredient` for every line.
- [ ] On recipe edit, replace only the active recipe definition; never mutate confirmed batch lines.

## Task 2: Implement local batch costing and atomic stock transfer

**Files:** Modify `db/production.ts`, `db/database.ts`.

- [ ] Load the active recipe, output product, current ingredient quantities, and inventory values before opening the write transaction; return a clear error if any row is missing.
- [ ] Compute default ingredient requirements as `quantityPerUnit * outputQuantity`; allow the owner-entered actual amount for each line, require each to be positive, and reject omitted/extra material lines.
- [ ] Inside one SQLite transaction, return the existing batch for a repeated client UUID; otherwise recheck every ingredient quantity, calculate each extended cost in integer centavos, and reject insufficient stock.
- [ ] Insert the batch and immutable batch material snapshots; update material quantities/values and append `production_use` material movements.
- [ ] Increase finished-product stock and compute its new weighted-average unit cost from existing finished stock value plus the batch cost; update `products.cost` in the same transaction.
- [ ] Save `batchCostCents`, `unitCostCents`, output quantity, and occurred-at timestamp; reject zero output and cost/quantity overflow before commit.
- [ ] Return the saved batch values; failed validation leaves ingredients, movements, batch rows, product stock, and product cost unchanged.

## Task 3: Add recipe and batch UI

**Files:** Create/modify `app/costs/recipes.tsx`, `app/costs/production.tsx`, `components/RecipeForm.tsx`, `components/ProductionBatchForm.tsx`, and `app/costs/index.tsx`.

- [ ] List recipes with product, ingredient count, and active state; add/edit a recipe using existing stock products and ingredient materials.
- [ ] Show material base units in the editor; convert kg to grams and liters to milliliters before saving quantities.
- [ ] Add production form with recipe, output quantity, derived ingredient requirements, current stock, and editable actual consumption values.
- [ ] Before confirmation, show batch material cost and estimated unit cost; after save, show produced quantity and new finished stock.
- [ ] Render production history newest first with recipe/product, output count, batch cost, and pending-sync state.
- [ ] Gate all screens and actions using the authenticated owner role; preserve screen operation from local SQLite when offline.

## Task 4: Add atomic Supabase production RPC and sync

**Files:** Create `supabase/migrations/20261009200000_recipes_production.sql`; update `supabase/schema.sql`, `sync/push.ts`, and `sync/pull.ts`.

- [ ] Add owner-only recipe and production tables with client UUID unique constraints, positive quantity checks, product/material references, and immutable batch line snapshots.
- [ ] Implement `complete_native_production_batch(p_batch jsonb)` to return an existing batch on retry; otherwise lock recipe/product/material rows, validate server stock, record consumption movements, add finished stock, update product cost, and commit all writes atomically.
- [ ] Use caller role from `profiles`; revoke direct table mutation from clients and grant only select plus approved RPC execution.
- [ ] Push recipes before batches and preserve the same batch client UUID on each retry.
- [ ] On a server stock conflict, retain the batch in the outbox with a reconciliation message; do not change local batch history or silently rewrite quantities.
- [ ] Pull owner recipes and batches by stable UUID without overwriting local pending changes.

## Completion Checks

- Recipe validation rejects no-product, no-ingredient, duplicate-material, and nonpositive-quantity definitions.
- Batch confirmation consumes each recorded ingredient quantity, adds finished units, and updates weighted-average product cost exactly once.
- Insufficient material, concurrent server stock change, or an invalid output leaves no partial server batch.
- Recipe edits do not rewrite prior batches, stock movements, or sale-item COGS snapshots.
- Production works locally offline; a queued batch syncs once after authentication and is not duplicated on retry.

