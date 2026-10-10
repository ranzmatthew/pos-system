# Cost and Profit Reporting Plan

> **For agentic workers:** Use `superpowers:executing-plans` after the auth/sync foundation, Costs/material stock, and recipes/production plans are complete.

**Goal:** Show owners date-filtered cash outflow, COGS, operating expenses, supply use, waste, and estimated net profit without conflating inventory purchases with expenses.

**Architecture:** A focused SQLite reporting repository aggregates immutable sales, expense, movement, and production snapshots. Costs and the owner dashboard use the same typed summary result; all values remain integer centavos until presentation.

**Tech Stack:** Expo SDK 52, React Native, expo-sqlite, Supabase JS 2.

**Spec:** `docs/superpowers/specs/2026-10-09-expenses-materials-production-design.md`

## Global Constraints

- Complete the auth/sync foundation, Costs/material stock, and recipes/production plans first.
- Net profit = net sales - COGS - direct operating expenses - shop-supply usage - waste.
- Do not subtract COGS from a gross-profit value a second time.
- Material purchases count in paid cash outflow, not as profit-and-loss expenses at receipt.
- Use local calendar boundaries for date filters and integer-centavo values for calculations.
- Display net profit as an estimate; never expose financial summaries to staff.

---

## File Structure

- `db/reports.ts`: date-range types, SQL aggregates, and cost-summary calculations.
- `app/costs/index.tsx`: Costs overview cards and date-range selector.
- `app/(tabs)/dashboard.tsx`: owner net-profit component card and link to Costs after the auth/sync route-group move.
- `components/CostSummary.tsx`, `DateRangePicker.tsx`: reusable report cards and period controls.
- `supabase/schema.sql`: ensure cloud expense and stock ledgers expose matching report inputs; no new cloud write behavior in this plan.
- `README.md`: define the report formulas and limitations.

## Task 1: Implement a typed report repository

**Files:** Create `db/reports.ts`; modify `db/costs.ts` only if expense entry kinds or period inputs need a shared type.

**Interfaces:**
- `type DateRange = { fromInclusive: string; toExclusive: string }`
- `type CostSummary = { netSalesCents: number; cogsCents: number; grossProfitCents: number; directExpensesCents: number; supplyUseCents: number; wasteCents: number; netProfitCents: number; materialPurchasesCents: number; cashOutflowCents: number }`
- `getCostSummary(range: DateRange): Promise<CostSummary>`
- `getExpenseBreakdown(range: DateRange): Promise<{ category: string; amountCents: number }[]>`

- [ ] Build date range values from local calendar dates and pass half-open ISO boundaries (`fromInclusive`, `toExclusive`) to SQLite queries.
- [ ] Aggregate net sales and COGS from the native sales and saved sale-item cost snapshots; include only active records if the table supports sale status.
- [ ] Aggregate direct, `supply_use`, and `waste` expense entries by event type; each generated entry is unique to its source movement, so never add the same movement cost a second time.
- [ ] Aggregate paid material receipts as cash outflow only; do not include the same receipt in expenses.
- [ ] Compute `grossProfitCents = netSalesCents - cogsCents` and `netProfitCents = grossProfitCents - directExpensesCents - supplyUseCents - wasteCents` using centavo integers.
- [ ] Compute `cashOutflowCents = directExpensesCents + materialPurchasesCents`; do not add supply-use expense again because those supplies were paid for at receipt.
- [ ] Return zero-valued summary fields for empty periods and category rows ordered by descending amount.

## Task 2: Add period-filtered Costs summary

**Files:** Modify `app/costs/index.tsx`; create `components/CostSummary.tsx` and `components/DateRangePicker.tsx`.

- [ ] Add preset periods Today, Last 7 days, and Last 30 days with Last 7 days as the initial selection.
- [ ] On period change, query `getCostSummary` and `getExpenseBreakdown`; avoid querying inside render and show loading/error states.
- [ ] Display Paid outflow, Net sales, COGS, Direct expenses, Supplies used, Waste, and Estimated net profit as separate values.
- [ ] Add a category expense list and labels/tooltips clarifying that purchases are cash outflow while consumption is recognized as expense.
- [ ] Handle offline, empty period, and stale pending-sync data with explicit labels; keep local totals available offline.

## Task 3: Add net-profit context to owner dashboard

**Files:** Modify `app/(tabs)/dashboard.tsx`, `components/CostSummary.tsx`, and `auth/roles.ts` only if a shared owner capability is missing.

- [ ] Load the same reporting period as the dashboard sales summary and fetch typed cost totals from `db/reports.ts`.
- [ ] Keep existing sales and gross-profit values intact; add a separately labeled estimated net-profit card and a Costs link.
- [ ] Render net profit as positive, zero, or negative using existing theme colors and never hide a loss behind a zero floor.
- [ ] Gate the card and Costs link for owner only; staff sees no cost/profit summary.
- [ ] Refresh summaries when the screen regains focus after a sale, expense, receipt, batch, supply-use, or waste record.

## Task 4: Document formulas and known limitations

**Files:** Modify `README.md` and the spec only if a user-approved formula changes.

- [ ] Document the net-profit and cash-outflow formulas with a sample calculation in PHP.
- [ ] Use this example consistently in the dashboard help text: P1,000 net sales - P600 COGS - P100 direct expenses - P20 supply use - P10 waste = P270 estimated net profit; if material receipts total P300, cash outflow is P400.
- [ ] State that material purchase cash outflow and expense recognition occur at different times.
- [ ] State the report depends on complete receipts, recipes, expenses, and waste records and is not a tax or accounting statement.

## Completion Checks

- A zero-activity period returns zero totals, not null or `NaN`.
- A receipt increases paid outflow and stock but not recognized expenses or net-profit deductions.
- Supply use decreases stock and lowers net profit once; its purchase outflow is not counted again.
- Production moves value into finished goods but does not change profit until the product sells.
- A sale subtracts saved COGS once; later changes to product/material costs do not alter historical reports.
- Waste lowers stock and net profit once and stays separate from regular expenses.
- Changing report period refreshes all summary and category values using local-day boundaries.
- Staff cannot access the report route or summary data.

