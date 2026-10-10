# Costs and Material Stock Plan

> **For agentic workers:** Use `superpowers:executing-plans` after the auth/sync foundation plan is complete.

**Goal:** Let owners record direct expenses, buy and track ingredients/supplies, log supply use and losses, and view a movement history while offline.

**Architecture:** SQLite repositories own local writes. Each expense or stock movement gets a stable UUID and sync state. Material receipts, consumption, and waste update quantity and value in one transaction; Supabase RPCs mirror those transactions atomically.

**Tech Stack:** Expo SDK 52, React Native, expo-sqlite, Supabase JS 2, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-10-09-expenses-materials-production-design.md`

## Global Constraints

- Complete `2026-10-09-auth-sync-foundation-plan.md` first.
- Keep money in integer centavos and material quantity as integer base units.
- Compute weighted-average material cost from total inventory value / on-hand quantity; snapshot extended cost in each movement.
- Inventory purchases count as cash outflow, not as recognized expense at receipt.
- Shop-supply consumption and waste reduce stock and are recognized exactly once.
- Owner-only actions and queries use the authenticated profile role and owner-only RLS.
- Keep the browser POS under `web/` unchanged.

---

## File Structure

- `db/schema.sql` and `db/database.ts`: SQLite tables and versioned upgrade path.
- `db/costs.ts`: expense and material domain types plus transactional repositories.
- `sync/push.ts`, `sync/pull.ts`, and `sync/queue.ts`: idempotent expense/material sync integrated with the foundation outbox.
- `supabase/migrations/20261009190000_costs_material_stock.sql` and `supabase/schema.sql`: cloud tables, checks, indexes, RLS, and RPCs.
- `app/costs/_layout.tsx` and `app/costs/index.tsx`: authenticated owner-only Costs entry and overview.
- `app/costs/expenses.tsx`, `materials.tsx`, and `waste.tsx`: focused owner workflows.
- `components/CostForm.tsx`, `MaterialForm.tsx`, and shared `components/ui.tsx`: reusable Native forms and visual primitives.

## Task 1: Add local expense and material schema

**Files:** Modify `db/schema.sql`, `db/database.ts`; create `db/costs.ts`.

**Interfaces:**
- `type ExpenseKind = 'direct' | 'supply_use' | 'waste'`
- `type ExpenseDraft = { clientUuid: string; category: string; amountCents: number; paymentMethod: 'cash' | 'online' | 'other'; occurredAt: string; vendor?: string; note?: string }` for direct expenses only.
- `type MaterialDraft = { clientUuid: string; name: string; kind: 'ingredient' | 'supply'; baseUnit: 'piece' | 'gram' | 'milliliter'; reorderLevel: number }`
- `type MaterialMovement = { clientUuid: string; materialId: number; kind: 'receipt' | 'production_use' | 'supply_use' | 'waste' | 'adjustment'; quantityDelta: number; quantityBefore: number; quantityAfter: number; costCents: number; occurredAt: string; paymentMethod?: ExpenseDraft['paymentMethod']; reason?: string }`

- [ ] Add a `PRAGMA user_version` migration runner; run upgrades inside a transaction and preserve existing products and sales.
- [ ] Add `expense_categories`, `expenses`, `materials`, and `material_movements` with local IDs, stable client UUIDs, sync state, checks for positive amounts/quantities, and indexes by date and material. `expenses.entry_type` is `direct`, `supply_use`, or `waste`; system-generated expense rows have a unique source movement UUID and nullable payment method.
- [ ] Store each material's `on_hand_base_units` and `inventory_value_cents`; derive average cost without storing a prematurely rounded fractional cent amount.
- [ ] Implement `createExpense(draft): Promise<Expense>` with trimmed category/vendor/note, positive amount, valid payment method, and UUID idempotency.
- [ ] Implement `listExpenses(from: string, to: string): Promise<Expense[]>` ordered newest first.
- [ ] Implement `listMaterials(kind?: MaterialDraft['kind']): Promise<Material[]>` and `listMaterialMovements(materialId?: number): Promise<MaterialMovement[]>`.

## Task 2: Implement transactional material operations

**Files:** Modify `db/costs.ts`, `db/database.ts`.

**Interfaces:**
- `receiveMaterial(input: { clientUuid: string; materialId: number; quantity: number; totalCostCents: number; occurredAt: string; paymentMethod: ExpenseDraft['paymentMethod'] }): Promise<MaterialMovement>`
- `consumeSupply(input: { clientUuid: string; materialId: number; quantity: number; occurredAt: string }): Promise<MaterialMovement>`
- `recordMaterialWaste(input: { clientUuid: string; materialId: number; quantity: number; reason: string; occurredAt: string }): Promise<MaterialMovement>`

- [ ] Implement receipt as one transaction: reject nonpositive quantity/cost, write the receipt movement with total purchase cost/payment method, add quantity and value, and persist paid outflow data. Do not create a recognized expense row for the purchase.
- [ ] Compute receipt-weighted average from prior total value and quantity plus the new receipt value and quantity; repeated client UUID returns the existing movement without applying stock twice.
- [ ] Implement supply consumption and waste as one transaction each; reject quantities over on-hand stock and snapshot the proportional total cost in centavos before decreasing inventory value.
- [ ] Create a system expense row with `entry_type='supply_use'` or `'waste'` and a unique source movement UUID in the same transaction as its stock movement; a repeated movement UUID returns both existing records without duplicating either.
- [ ] Support stock adjustments only with nonzero quantity and a required reason; record the value delta consistently.

## Task 3: Add owner Costs and Materials screens

**Files:** Create `app/costs/_layout.tsx`, `index.tsx`, `expenses.tsx`, `materials.tsx`, `waste.tsx`; modify `app/settings.tsx` and `auth/roles.ts`; create `components/CostForm.tsx` and `MaterialForm.tsx`.

- [ ] Add an owner-only Costs link to More; protect both navigation and screen rendering with `canManageCosts(role)`.
- [ ] Build Costs overview cards for selected-period direct expenses, material cash purchases, shop-supply use, and waste; do not label inventory purchases as expenses.
- [ ] Build an expense form for category, positive PHP amount, date, payment method, optional vendor/note; convert PHP to centavos at submit.
- [ ] Build material create/edit and receipt flows with ingredient/supply kind, base unit, quantity, and total purchase cost.
- [ ] Build supply-use and waste forms that display current quantity, validate on-hand stock, and require a reason for waste/adjustment.
- [ ] Render distinct loading, empty, offline, and pending-sync states; use existing colors, card styles, and touch targets from `components/ui.tsx`.

## Task 4: Add Supabase migration and idempotent RPCs

**Files:** Create `supabase/migrations/20261009190000_costs_material_stock.sql`; update `supabase/schema.sql`.

- [ ] Add `expense_categories`, `expenses`, `materials`, `material_movements`, and payment/movement client IDs with constraints and date/material indexes.
- [ ] Enable RLS; allow only the authenticated owner profile to read and mutate financial/material tables.
- [ ] Add an idempotent `record_native_expense` RPC keyed by expense client UUID.
- [ ] Add `receive_native_material` RPC keyed by movement client UUID; lock the material row, compute before/after quantity and inventory value atomically, and return the committed movement.
- [ ] Add `consume_native_material` RPC for supply use/waste/adjustment; validate owner role, expected stock, nonnegative result, required reason, and idempotency before committing movement and financial record together.
- [ ] Keep migration additive and safe to apply after the existing stock/product-category migrations.

## Task 5: Queue and synchronize expenses/material movements

**Files:** Modify `sync/push.ts`, `sync/pull.ts`, `sync/queue.ts`; modify `db/costs.ts` only for sync state helpers.

- [ ] Extend the shared outbox summary to count pending expenses and material movements separately.
- [ ] Push in dependency order: material/category definitions, then direct expenses and receipt/usage/waste movements with their source-linked expense rows; use the same UUID on every retry.
- [ ] Mark a local row synced only after its corresponding RPC succeeds; leave network failures and expected-stock conflicts pending with a reason visible in Costs.
- [ ] Pull remote owner records into SQLite by client UUID and preserve local pending rows on conflict.
- [ ] Ensure an RPC replay returns the existing movement/expense and does not double-apply quantity, inventory value, or report totals.

## Completion Checks

- Direct expense history survives restart/offline use and syncs without duplicates.
- A material receipt adds stock, updates weighted-average inventory value, and appears under paid cash outflow.
- Supply use reduces stock and creates exactly one `supply_use` expense entry.
- Waste reduces stock and creates exactly one `waste` entry with its cost snapshot; the report must not separately sum the same movement cost.
- Negative stock, invalid amounts, and reasonless adjustments/waste are rejected before any row is committed.
- Pending rows remain visible after network failure; replay clears only confirmed rows.
- Staff cannot open Costs or call online expense/material mutation RPCs.

