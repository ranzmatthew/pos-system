-- Add one-level product categories for POS browsing.
begin;

alter table public.products
  add column if not exists category text not null default 'Uncategorized';

grant update (category) on public.products to authenticated;
drop function if exists public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text);
create or replace function public.save_pos_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_price_cents integer,
  p_cost_cents integer,
  p_stock integer,
  p_reorder_level integer,
  p_stock_reason text default null,
  p_category text default 'Uncategorized'
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_delta integer;
begin
  if not public.is_owner() then raise exception 'Owner access required.' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Product name is required.'; end if;
  if nullif(btrim(p_category), '') is null then raise exception 'Product category is required.'; end if;
  if p_price_cents < 0 or p_cost_cents < 0 or p_stock < 0 or p_reorder_level < 0 then
    raise exception 'Price, cost, stock, and reorder level must be zero or greater.';
  end if;

  if p_product_id is null then
    insert into public.products (name, sku, category, price_cents, cost_cents, stock, reorder_level)
    values (btrim(p_name), nullif(btrim(p_sku), ''), btrim(p_category), p_price_cents, p_cost_cents, p_stock, p_reorder_level)
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
      category = btrim(p_category),
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
revoke all on function public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text, text) from public, anon;
grant execute on function public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text, text) to authenticated;

commit;