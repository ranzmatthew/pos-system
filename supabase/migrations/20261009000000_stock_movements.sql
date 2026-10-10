-- Stock movement ledger and atomic stock operations for the browser POS.
begin;

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  movement_type text not null check (movement_type in ('opening_balance', 'sale', 'void_reversal', 'restock', 'adjustment')),
  quantity_delta integer not null,
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason text,
  sale_id uuid references public.sales(id) on delete set null,
  sale_item_id uuid references public.sale_items(id) on delete set null,
  source_key text not null unique,
  actor_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint stock_movement_balance_check check (quantity_after = quantity_before + quantity_delta),
  constraint stock_movement_delta_check check (
    (movement_type = 'opening_balance' and quantity_before = 0 and quantity_delta >= 0)
    or (movement_type = 'sale' and quantity_delta < 0)
    or (movement_type = 'void_reversal' and quantity_delta > 0)
    or (movement_type = 'restock' and quantity_delta > 0)
    or (movement_type = 'adjustment' and quantity_delta <> 0 and nullif(btrim(reason), '') is not null)
  )
);

create index if not exists stock_movements_occurred_idx on public.stock_movements (occurred_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, occurred_at desc);
create index if not exists stock_movements_type_idx on public.stock_movements (movement_type, occurred_at desc);

alter table public.sale_items drop constraint if exists sale_items_product_id_fkey;
alter table public.sale_items
  add constraint sale_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

insert into public.stock_movements (
  product_id, product_name, movement_type, quantity_delta,
  quantity_before, quantity_after, reason, source_key, occurred_at
)
select p.id, p.name, 'opening_balance', p.stock, 0, p.stock,
       'Opening balance at stock tracking rollout',
       'opening:' || p.id::text, now()
from public.products p
where not exists (
  select 1 from public.stock_movements m where m.source_key = 'opening:' || p.id::text
);

alter table public.stock_movements enable row level security;
drop policy if exists "owner reads stock movements" on public.stock_movements;
create policy "owner reads stock movements" on public.stock_movements
  for select to authenticated using (public.is_owner());
revoke all on public.stock_movements from anon, authenticated;
grant select on public.stock_movements to authenticated;

drop policy if exists "staff updates stock on sale" on public.products;
drop policy if exists "owner writes products" on public.products;
create policy "owner updates product details" on public.products
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes products" on public.products
  for delete to authenticated using (public.is_owner());
revoke insert, update, delete on public.products from anon, authenticated;
grant select on public.products to authenticated;
grant update (name, sku, price_cents, cost_cents, reorder_level) on public.products to authenticated;
grant delete on public.products to authenticated;

drop policy if exists "any login creates sales" on public.sales;
drop policy if exists "owner voids sales" on public.sales;
revoke insert, update, delete on public.sales from anon, authenticated;
grant select on public.sales to authenticated;

drop policy if exists "any login creates items" on public.sale_items;
revoke insert, update, delete on public.sale_items from anon, authenticated;
grant select on public.sale_items to authenticated;

create or replace function public.save_pos_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_price_cents integer,
  p_cost_cents integer,
  p_stock integer,
  p_reorder_level integer,
  p_stock_reason text default null
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
  if p_price_cents < 0 or p_cost_cents < 0 or p_stock < 0 or p_reorder_level < 0 then
    raise exception 'Price, cost, stock, and reorder level must be zero or greater.';
  end if;

  if p_product_id is null then
    insert into public.products (name, sku, price_cents, cost_cents, stock, reorder_level)
    values (btrim(p_name), nullif(btrim(p_sku), ''), p_price_cents, p_cost_cents, p_stock, p_reorder_level)
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

create or replace function public.apply_stock_movement(
  p_product_id uuid,
  p_movement_id uuid,
  p_movement_type text,
  p_quantity_delta integer,
  p_reason text,
  p_expected_stock integer
)
returns table (movement_id uuid, stock integer, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_existing public.stock_movements%rowtype;
  v_after integer;
  v_source_key text := 'manual:' || p_movement_id::text;
begin
  if not public.is_owner() then raise exception 'Owner access required.' using errcode = '42501'; end if;
  if p_movement_id is null or p_expected_stock is null then raise exception 'Movement ID and expected stock are required.'; end if;
  if p_movement_type is null or p_movement_type not in ('restock', 'adjustment') then raise exception 'Invalid stock movement type.'; end if;
  if p_quantity_delta is null or (p_movement_type = 'restock' and p_quantity_delta <= 0)
     or (p_movement_type = 'adjustment' and p_quantity_delta = 0) then
    raise exception 'Enter a valid quantity.';
  end if;
  if p_movement_type = 'adjustment' and nullif(btrim(p_reason), '') is null then
    raise exception 'Enter a reason for the adjustment.';
  end if;

  select * into v_existing from public.stock_movements m where m.source_key = v_source_key;
  if found then return query select v_existing.id, v_existing.quantity_after, true; return; end if;

  select * into v_product from public.products p where p.id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;
  if v_product.stock <> p_expected_stock then
    raise exception 'Stock changed elsewhere. Refresh the product and retry.' using errcode = '40001';
  end if;
  v_after := v_product.stock + p_quantity_delta;
  if v_after < 0 then raise exception 'Adjustment cannot make stock negative.'; end if;

  update public.products set stock = v_after, updated_at = now() where id = p_product_id;
  insert into public.stock_movements (
    product_id, product_name, movement_type, quantity_delta, quantity_before,
    quantity_after, reason, source_key, actor_id
  ) values (
    v_product.id, v_product.name, p_movement_type, p_quantity_delta,
    v_product.stock, v_after, nullif(btrim(p_reason), ''), v_source_key, auth.uid()
  ) returning id into movement_id;

  stock := v_after;
  replayed := false;
  return next;
end;
$$;

create or replace function public.complete_pos_sale(p_sale jsonb)
returns table (sale_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id text := nullif(p_sale->>'client_id', '');
  v_sale_id uuid;
  v_existing public.sales%rowtype;
  v_line jsonb;
  v_line_index bigint;
  v_product_id uuid;
  v_product public.products%rowtype;
  v_item_id uuid;
  v_qty integer;
  v_before integer;
  v_name text;
  v_price integer;
  v_cost integer;
begin
  if auth.uid() is null then raise exception 'Sign in to complete a sale.' using errcode = '42501'; end if;
  if v_client_id is null then raise exception 'Sale ID is required.'; end if;
  if coalesce(jsonb_typeof(p_sale->'lines'), '') <> 'array' or jsonb_array_length(p_sale->'lines') = 0 then
    raise exception 'Sale must contain at least one item.';
  end if;

  select * into v_existing from public.sales s where s.client_id = v_client_id for update;
  if found then return query select v_existing.id, true; return; end if;

  insert into public.sales (
    client_id, subtotal_cents, discount_type, discount_cents, total_cents,
    profit_cents, payment, status, shift_id, cashier_id, created_at
  ) values (
    v_client_id,
    coalesce((p_sale->>'subtotal_cents')::integer, 0),
    coalesce(nullif(p_sale->>'discount_type', ''), 'none'),
    coalesce((p_sale->>'discount_cents')::integer, 0),
    coalesce((p_sale->>'total_cents')::integer, 0),
    coalesce((p_sale->>'profit_cents')::integer, 0),
    coalesce(nullif(p_sale->>'payment', ''), 'cash'),
    'active',
    case when nullif(p_sale->>'shift_id', '') ~* '^[0-9a-f-]{36}$' then (p_sale->>'shift_id')::uuid else null end,
    auth.uid(),
    coalesce(nullif(p_sale->>'created_at', '')::timestamptz, now())
  )
  on conflict (client_id) do nothing
  returning id into v_sale_id;

  if v_sale_id is null then
    select s.id into v_sale_id from public.sales s where s.client_id = v_client_id;
    return query select v_sale_id, true;
    return;
  end if;

  for v_line, v_line_index in
    select entry.value, entry.ordinality
    from jsonb_array_elements(p_sale->'lines') with ordinality as entry(value, ordinality)
    order by entry.ordinality
  loop
    v_name := coalesce(nullif(v_line->>'name', ''), 'Product');
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_price := coalesce((v_line->>'price_cents')::integer, 0);
    v_cost := coalesce((v_line->>'cost_cents')::integer, 0);
    if v_qty <= 0 or v_price < 0 or v_cost < 0 then raise exception 'Invalid sale item.'; end if;

    v_product_id := null;
    if nullif(v_line->>'product_id', '') is not null then v_product_id := (v_line->>'product_id')::uuid; end if;
    if v_product_id is not null then
      select * into v_product from public.products p where p.id = v_product_id for update;
      if not found then raise exception 'Product not found: %', v_name; end if;
      if v_product.stock < v_qty then raise exception 'Not enough stock for % (% left).', v_product.name, v_product.stock; end if;
      v_before := v_product.stock;
      update public.products set stock = stock - v_qty, updated_at = now() where id = v_product_id;
      v_name := v_product.name;
    end if;

    insert into public.sale_items (sale_id, product_id, name, qty, price_cents, cost_cents)
    values (v_sale_id, v_product_id, v_name, v_qty, v_price, v_cost)
    returning id into v_item_id;

    if v_product_id is not null then
      insert into public.stock_movements (
        product_id, product_name, movement_type, quantity_delta, quantity_before,
        quantity_after, sale_id, sale_item_id, source_key, actor_id, occurred_at
      ) values (
        v_product_id, v_name, 'sale', -v_qty, v_before, v_before - v_qty,
        v_sale_id, v_item_id, 'sale:' || v_client_id || ':line:' || v_line_index,
        auth.uid(), coalesce(nullif(p_sale->>'created_at', '')::timestamptz, now())
      );
    end if;
  end loop;

  return query select v_sale_id, false;
end;
$$;

create or replace function public.void_pos_sale(p_sale_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_product public.products%rowtype;
  v_before integer;
begin
  if not public.is_owner() then raise exception 'Owner access required.' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Give a reason for voiding this sale.'; end if;

  select * into v_sale from public.sales s where s.id = p_sale_id for update;
  if not found then raise exception 'Sale not found.'; end if;
  if v_sale.status = 'voided' then return false; end if;

  for v_item in
    select si.* from public.sale_items si
    where si.sale_id = p_sale_id and si.product_id is not null
    order by si.product_id, si.id
  loop
    select * into v_product from public.products p where p.id = v_item.product_id for update;
    if not found then continue; end if;
    v_before := v_product.stock;
    update public.products set stock = stock + v_item.qty, updated_at = now() where id = v_product.id;
    insert into public.stock_movements (
      product_id, product_name, movement_type, quantity_delta, quantity_before,
      quantity_after, reason, sale_id, sale_item_id, source_key, actor_id
    ) values (
      v_product.id, v_item.name, 'void_reversal', v_item.qty, v_before,
      v_before + v_item.qty, btrim(p_reason), v_sale.id, v_item.id,
      'void:' || v_sale.client_id || ':item:' || v_item.id::text, auth.uid()
    ) on conflict (source_key) do nothing;
  end loop;

  update public.sales
  set status = 'voided', void_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid()
  where id = p_sale_id and status = 'active';
  return true;
end;
$$;

revoke all on function public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text) from public, anon;
revoke all on function public.apply_stock_movement(uuid, uuid, text, integer, text, integer) from public, anon;
revoke all on function public.complete_pos_sale(jsonb) from public, anon;
revoke all on function public.void_pos_sale(uuid, text) from public, anon;
grant execute on function public.save_pos_product(uuid, text, text, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.apply_stock_movement(uuid, uuid, text, integer, text, integer) to authenticated;
grant execute on function public.complete_pos_sale(jsonb) to authenticated;
grant execute on function public.void_pos_sale(uuid, text) to authenticated;

commit;
