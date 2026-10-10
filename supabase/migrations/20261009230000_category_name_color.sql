-- Category names and colors; edits update all matching products atomically.
begin;

alter table public.products add column if not exists category_color text not null default '#28594b'
  check (category_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.products alter column category set default 'N/A';
update public.products set category = 'N/A' where lower(btrim(category)) in ('', 'uncategorized', 'n/a', 'n/aa');

drop function if exists public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text, text);
create or replace function public.save_pos_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_price_cents integer,
  p_cost_cents integer,
  p_stock integer,
  p_reorder_level integer,
  p_stock_reason text default null,
  p_category text default 'N/A',
  p_category_color text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_delta integer;
  v_category text;
  v_category_color text;
begin
  if not public.is_owner() then raise exception 'Owner access required.' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Product name is required.'; end if;
  if nullif(btrim(p_category), '') is null then raise exception 'Product category is required.'; end if;
  if p_category_color is not null and p_category_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid category color.'; end if;
  perform pg_advisory_xact_lock(hashtext('pos-category-edit'));
  v_category := case when lower(btrim(p_category)) in ('uncategorized', 'n/a', 'n/aa') then 'N/A' else btrim(p_category) end;
  if lower(v_category) = 'all' then raise exception 'All is reserved for the POS filter.'; end if;
  select category_color into v_category_color from public.products
    where lower(btrim(category)) = lower(v_category) order by updated_at desc limit 1;
  v_category_color := coalesce(v_category_color, lower(p_category_color), '#28594b');
  if p_price_cents < 0 or p_cost_cents < 0 or p_stock < 0 or p_reorder_level < 0 then
    raise exception 'Price, cost, stock, and reorder level must be zero or greater.';
  end if;

  if p_product_id is null then
    insert into public.products (name, sku, category, category_color, price_cents, cost_cents, stock, reorder_level)
    values (btrim(p_name), nullif(btrim(p_sku), ''), v_category, v_category_color, p_price_cents, p_cost_cents, p_stock, p_reorder_level)
    returning * into v_product;

    insert into public.stock_movements (
      product_id, product_name, movement_type, quantity_delta, quantity_before,
      quantity_after, reason, source_key, actor_id
    ) values (
      v_product.id, v_product.name, 'opening_balance', p_stock, 0,
      p_stock, 'Starting stock for new product', 'product-opening:' || v_product.id::text, auth.uid()
    );
    return v_product;
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;
  v_delta := p_stock - v_product.stock;
  if v_delta <> 0 and nullif(btrim(p_stock_reason), '') is null then
    raise exception 'Enter a reason for the stock adjustment.';
  end if;

  update public.products
  set name = btrim(p_name),
      sku = nullif(btrim(p_sku), ''),
      category = v_category,
      category_color = v_category_color,
      price_cents = p_price_cents,
      cost_cents = p_cost_cents,
      stock = p_stock,
      reorder_level = p_reorder_level,
      updated_at = now()
  where id = p_product_id
  returning * into v_product;

  if v_delta <> 0 then
    insert into public.stock_movements (
      product_id, product_name, movement_type, quantity_delta, quantity_before,
      quantity_after, reason, source_key, actor_id
    ) values (
      v_product.id, v_product.name, 'adjustment', v_delta, p_stock - v_delta,
      p_stock, btrim(p_stock_reason), 'product-edit:' || gen_random_uuid()::text, auth.uid()
    );
  end if;
  return v_product;
end;
$$;
revoke all on function public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text, text, text) to authenticated;

create or replace function public.edit_pos_category(p_old_category text, p_new_category text, p_color text)
returns setof public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text;
begin
  if not public.is_owner() then raise exception 'Owner access required.' using errcode = '42501'; end if;
  if nullif(btrim(p_old_category), '') is null or nullif(btrim(p_new_category), '') is null or length(btrim(p_new_category)) > 80 then
    raise exception 'Enter a category name of up to 80 characters.';
  end if;
  if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid category color.'; end if;
  v_old := case when lower(btrim(p_old_category)) in ('uncategorized', 'n/a', 'n/aa') then 'N/A' else btrim(p_old_category) end;
  v_new := case when lower(btrim(p_new_category)) in ('uncategorized', 'n/a', 'n/aa') then 'N/A' else btrim(p_new_category) end;
  if lower(v_new) = 'all' then raise exception 'All is reserved for the POS filter.'; end if;
  perform pg_advisory_xact_lock(hashtext('pos-category-edit'));
  if not exists (select 1 from public.products where lower(btrim(category)) = lower(v_old)) then
    raise exception 'Category no longer exists.';
  end if;
  if lower(v_old) <> lower(v_new) and exists (select 1 from public.products where lower(btrim(category)) = lower(v_new)) then
    raise exception 'A category with that name already exists.';
  end if;
  return query update public.products set category = v_new, category_color = lower(p_color), updated_at = now()
    where lower(btrim(category)) = lower(v_old) returning *;
end;
$$;
revoke all on function public.edit_pos_category(text, text, text) from public, anon;
grant execute on function public.edit_pos_category(text, text, text) to authenticated;

commit;
