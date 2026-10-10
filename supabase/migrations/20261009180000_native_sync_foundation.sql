begin;

-- Keep the local integer primary key on device; this stable client ID maps it
-- to the canonical UUID product row in Supabase.
alter table public.products add column if not exists client_id uuid;
create unique index if not exists products_client_id_uidx on public.products(client_id)
  where client_id is not null;

create or replace function public.save_native_product(
  p_client_id uuid,
  p_name text,
  p_sku text,
  p_price_cents integer,
  p_cost_cents integer,
  p_stock integer,
  p_category text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;
  if p_client_id is null or nullif(btrim(p_name), '') is null then
    raise exception 'Product ID and name are required.';
  end if;
  if p_price_cents < 0 or p_cost_cents < 0 or p_stock < 0 then
    raise exception 'Price, cost, and stock must be zero or greater.';
  end if;

  insert into public.products (client_id, name, sku, price_cents, cost_cents, stock, category)
  values (p_client_id, btrim(p_name), nullif(btrim(p_sku), ''), p_price_cents,
          p_cost_cents, p_stock, coalesce(nullif(btrim(p_category), ''), 'Uncategorized'))
  on conflict (client_id) where client_id is not null do update
    set name = excluded.name,
        sku = excluded.sku,
        price_cents = excluded.price_cents,
        cost_cents = excluded.cost_cents,
        category = excluded.category,
        updated_at = now()
  returning id into v_product_id;
  return v_product_id;
end;
$$;

revoke all on function public.save_native_product(uuid, text, text, integer, integer, integer, text)
  from public, anon;
grant execute on function public.save_native_product(uuid, text, text, integer, integer, integer, text)
  to authenticated;

commit;
