# POS Product Category Selection Design

**Date:** 2026-10-09  
**Status:** Implemented; apply the Supabase migration before online category edits.

## Goal

Let cashiers browse products by selecting a single-level category. Remove product search from the POS. Preserve the existing product-card and cart behavior.

## Approved scope

- One-level categories such as Beverages and Snacks; no subcategories.
- An All filter and one filter for each category represented in the product catalog.
- Selecting a category filters the existing product cards; selecting a card continues to add it to the order.
- Add a Category field to the existing add/edit product form. Allow entering a new category name as well as reusing a current name.
- Existing products without category data display as Uncategorized. Do not guess categories from product names.
- Category values persist in offline local storage and Supabase.
- Remove the POS search input and its filtering behavior.

## Product model and persistence

Add a non-null text `category` field to products, defaulting to `Uncategorized`. The field belongs on the product record because each product has one category and the catalog already owns product-level fields. Derive the selectable POS filters from distinct non-empty category values in the product list; a separate category table and category-management screen are out of scope.

The web product loader must include `category`, falling back to `Uncategorized` for older cached records. Product create/edit must save the trimmed category. Offline saves must retain it. Supabase create/edit must write it through `save_pos_product`.

Add an additive Supabase migration that adds the products column and replaces the `save_pos_product` RPC with a category-aware signature while preserving owner authorization, existing validation, stock adjustment history, and grants. Update `supabase/schema.sql` to match the migrated schema for fresh installations. Existing product rows receive the default category and remain editable; the application must not infer categories from names.

## POS behavior

- Render All first, then distinct category names in stable alphabetical order.
- Select All by default. Keep the selected category while the POS rerenders; return to All if that category no longer exists after product edits/deletes.
- Filtering only changes the product grid. It must not clear or modify the current cart.
- Category controls are keyboard-operable buttons with an accessible selected state.
- Preserve existing out-of-stock handling and add-to-cart stock limits.
- When no products exist, show the existing empty-catalog message instead of category controls without options.

## User interface

Place a horizontally scrollable row of category buttons above the product cards. On narrow screens, keep controls on one row and allow horizontal scrolling without causing page-level overflow. Keep the product grid's current responsive columns and card dimensions. Remove the POS search markup, query state, input handler, and search-specific empty result.

Add a labeled Category text input backed by a datalist of categories already present in the catalog. This permits selecting an existing category or entering a new one without introducing a separate management workflow. On an empty catalog, the field remains usable and defaults to Uncategorized.

## Data flow

1. Product list loading reads category from Supabase or the offline cache and normalizes missing values to Uncategorized.
2. POS rendering derives category filters from loaded products and applies the selected filter before generating product cards.
3. Product create/edit reads the category field and saves it locally or through the category-aware RPC.
4. A successful save refreshes inventory and POS data so a newly introduced category appears immediately.

## Error handling and rollout

The migration is additive and retains existing rows. A Supabase instance must have the new migration applied before the new product editor can save categories online. Until migration is applied, the current RPC will reject the new signature; surface the existing save error and retain the entered form values. Offline category updates remain in the device cache and follow existing sync behavior.

## Acceptance criteria

1. POS has no product-search field or search filtering behavior.
2. All and the available category filters display above product cards; selecting one shows only its products.
3. Category changes leave cart contents and quantities unchanged.
4. Owners can set an existing or new category when adding or editing a product.
5. Category assignments survive reload in offline mode and round-trip through Supabase after migration.
6. Existing products missing category data remain available under Uncategorized.
7. Product stock limits, cart actions, checkout, and inventory history continue working.

## Verification plan

- Review the UI at desktop and mobile widths for category row overflow and product-grid fit.
- Verify filtering for All, a populated category, and a product added with a newly typed category.
- Verify an existing product can be assigned a category and remains categorized after reload.
- Verify category edits do not affect the active cart.
- Verify the SQL migration against the existing schema and verify the updated `schema.sql` can initialize a fresh database.
- Check JavaScript syntax and inspect changed files. Do not alter unrelated POS workflows.

## Out of scope

- Nested categories, subcategory screens, or category hierarchy.
- Product search, SKU/barcode search, and text filtering.
- A separate category CRUD screen or category table.
- Automatic classification of existing products.