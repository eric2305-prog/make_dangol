-- Test-only seed for the second E2E store.
-- Safe rules: no DELETE, TRUNCATE, DROP, or ALTER TABLE DROP.
-- Run this in Supabase SQL Editor before running the cross-store E2E test.

do $$
declare
  v_has_owner_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'owner_id'
  )
  into v_has_owner_id;

  if v_has_owner_id then
    insert into public.owners (id, name, email)
    values (
      '00000000-0000-4000-8000-000000002001',
      '테스트 점주 2',
      'test02@example.com'
    )
    on conflict (id) do update
    set
      name = excluded.name,
      email = excluded.email,
      updated_at = now();

    insert into public.stores (
      id,
      owner_id,
      store_id,
      name,
      phone,
      address,
      booking_url,
      industry,
      status
    )
    values (
      '00000000-0000-4000-8000-000000002002',
      '00000000-0000-4000-8000-000000002001',
      'test02',
      '테스트 매장 2',
      '0211112222',
      '서울시 테스트구 2',
      'https://booking.naver.com/example2',
      'beauty',
      'active'
    )
    on conflict (store_id) do update
    set
      name = excluded.name,
      phone = excluded.phone,
      address = excluded.address,
      booking_url = excluded.booking_url,
      industry = excluded.industry,
      status = excluded.status,
      updated_at = now();
  else
    insert into public.stores (
      id,
      store_id,
      name,
      phone,
      address,
      booking_url,
      industry,
      status
    )
    values (
      '00000000-0000-4000-8000-000000002002',
      'test02',
      '테스트 매장 2',
      '0211112222',
      '서울시 테스트구 2',
      'https://booking.naver.com/example2',
      'beauty',
      'active'
    )
    on conflict (store_id) do update
    set
      name = excluded.name,
      phone = excluded.phone,
      address = excluded.address,
      booking_url = excluded.booking_url,
      industry = excluded.industry,
      status = excluded.status,
      updated_at = now();
  end if;
end $$;

insert into public.settings (
  store_id,
  revisit_cycle_days,
  default_message
)
values (
  '00000000-0000-4000-8000-000000002002',
  30,
  '다시 방문하실 시점이에요.'
)
on conflict (store_id) do update
set
  revisit_cycle_days = excluded.revisit_cycle_days,
  default_message = excluded.default_message;
