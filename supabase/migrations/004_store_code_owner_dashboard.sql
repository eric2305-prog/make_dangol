-- Review before applying. This migration enables short store codes such as raon01
-- while keeping the existing UUID-based store id structure.

alter table public.stores
  add column if not exists store_code text,
  add column if not exists booking_url text,
  add column if not exists industry text,
  add column if not exists status text not null default 'active';

create unique index if not exists stores_store_code_unique
  on public.stores(store_code)
  where store_code is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stores_store_code_format'
      and conrelid = 'public.stores'::regclass
  ) then
    alter table public.stores
      add constraint stores_store_code_format
      check (store_code is null or store_code ~ '^[a-z0-9]+$');
  end if;
end;
$$;

create table if not exists public.settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  revisit_cycle_days integer not null default 30,
  default_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create or replace function public.resolve_store_by_code(p_store_id text)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := btrim(coalesce(p_store_id, ''));
  v_store public.stores%rowtype;
begin
  if v_key = '' then
    raise exception '매장 정보가 없습니다.';
  end if;

  if v_key ~ '^[a-z0-9]+$' then
    select *
    into v_store
    from public.stores
    where store_code = v_key
      and is_active = true;

    if found then
      return v_store;
    end if;
  end if;

  if v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select *
    into v_store
    from public.stores
    where id = v_key::uuid
      and is_active = true;

    if found then
      return v_store;
    end if;
  end if;

  raise exception '매장 정보를 찾을 수 없습니다.';
end;
$$;

create or replace function public.qr_customer_lookup(
  p_store_id text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_phone text;
  v_customer public.customers%rowtype;
  v_visit_count integer;
  v_last_visit_at timestamptz;
  v_last_visit_days integer;
begin
  v_store := public.resolve_store_by_code(p_store_id);

  if p_phone is null then
    return jsonb_build_object(
      'mode', 'store',
      'store_id', coalesce(v_store.store_code, v_store.id::text),
      'store_uuid', v_store.id,
      'store_name', v_store.name
    );
  end if;

  v_phone := public.normalize_customer_phone(p_phone);
  if length(v_phone) not in (10, 11) then
    raise exception '휴대폰 번호를 정확히 입력해 주세요.';
  end if;

  select *
  into v_customer
  from public.customers
  where store_id = v_store.id
    and phone = v_phone;

  if not found then
    return jsonb_build_object(
      'mode', 'new',
      'store_id', coalesce(v_store.store_code, v_store.id::text),
      'store_uuid', v_store.id,
      'store_name', v_store.name,
      'phone', v_phone
    );
  end if;

  select count(*)::integer, max(visited_at)
  into v_visit_count, v_last_visit_at
  from public.visits
  where store_id = v_store.id
    and customer_id = v_customer.id;

  if v_last_visit_at is null then
    v_last_visit_days := null;
  else
    v_last_visit_days :=
      (now() at time zone 'Asia/Seoul')::date
      - (v_last_visit_at at time zone 'Asia/Seoul')::date;
  end if;

  return jsonb_build_object(
    'mode', 'existing',
    'store_id', coalesce(v_store.store_code, v_store.id::text),
    'store_uuid', v_store.id,
    'store_name', v_store.name,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'phone', v_customer.phone,
      'marketing_agreed', v_customer.marketing_agreed,
      'last_visit_days', v_last_visit_days,
      'visit_count', v_visit_count,
      'next_visit_count',
        case when v_last_visit_at is null then null else v_visit_count + 1 end
    )
  );
end;
$$;

create or replace function public.qr_customer_register(
  p_store_id text,
  p_phone text,
  p_name text,
  p_consent boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_phone text;
  v_name text;
  v_customer_id uuid;
  v_now timestamptz := now();
begin
  v_store := public.resolve_store_by_code(p_store_id);

  v_phone := public.normalize_customer_phone(p_phone);
  if length(v_phone) not in (10, 11) then
    raise exception '휴대폰 번호를 정확히 입력해 주세요.';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception '이름을 입력해 주세요.';
  end if;

  insert into public.customers (
    store_id,
    name,
    phone,
    privacy_agreed,
    marketing_agreed,
    visit_count,
    last_visit_at,
    status,
    created_at,
    updated_at
  )
  values (
    v_store.id,
    v_name,
    v_phone,
    true,
    coalesce(p_consent, false),
    1,
    v_now,
    'new',
    v_now,
    v_now
  )
  on conflict (store_id, phone) do nothing
  returning id into v_customer_id;

  if v_customer_id is null then
    return public.qr_customer_lookup(p_store_id, v_phone);
  end if;

  insert into public.visits (
    store_id,
    customer_id,
    source,
    created_by,
    visited_at,
    created_at
  )
  values (
    v_store.id,
    v_customer_id,
    'qr_checkin',
    'customer',
    v_now,
    v_now
  );

  return jsonb_build_object(
    'mode', 'registered',
    'store_id', coalesce(v_store.store_code, v_store.id::text),
    'store_uuid', v_store.id,
    'store_name', v_store.name,
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_name,
      'phone', v_phone,
      'marketing_agreed', coalesce(p_consent, false),
      'visit_count', 1
    )
  );
end;
$$;

create or replace function public.qr_customer_checkin(
  p_store_id text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_phone text;
  v_customer public.customers%rowtype;
  v_now timestamptz := now();
  v_visit_count integer;
  v_last_visit_at timestamptz;
begin
  v_store := public.resolve_store_by_code(p_store_id);

  v_phone := public.normalize_customer_phone(p_phone);
  if length(v_phone) not in (10, 11) then
    raise exception '휴대폰 번호를 정확히 입력해 주세요.';
  end if;

  select *
  into v_customer
  from public.customers
  where store_id = v_store.id
    and phone = v_phone;

  if not found then
    raise exception '등록된 고객 정보를 찾을 수 없습니다.';
  end if;

  insert into public.visits (
    store_id,
    customer_id,
    source,
    created_by,
    visited_at,
    created_at
  )
  values (
    v_store.id,
    v_customer.id,
    'qr_checkin',
    'customer',
    v_now,
    v_now
  );

  select count(*)::integer, max(visited_at)
  into v_visit_count, v_last_visit_at
  from public.visits
  where store_id = v_store.id
    and customer_id = v_customer.id;

  update public.customers
  set
    visit_count = v_visit_count,
    last_visit_at = v_last_visit_at,
    status = case when v_visit_count >= 2 then 'active' else 'new' end,
    updated_at = v_now
  where id = v_customer.id;

  return jsonb_build_object(
    'mode', 'checked_in',
    'store_id', coalesce(v_store.store_code, v_store.id::text),
    'store_uuid', v_store.id,
    'store_name', v_store.name,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'phone', v_customer.phone,
      'visit_count', v_visit_count,
      'last_visit_at', v_last_visit_at
    )
  );
end;
$$;

create or replace function public.qr_owner_dashboard_snapshot(p_store_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_cycle integer := 30;
  v_metrics jsonb;
  v_customers jsonb;
begin
  v_store := public.resolve_store_by_code(p_store_id);

  select coalesce(max(revisit_cycle_days), 30)
  into v_cycle
  from public.settings
  where store_id = v_store.id;

  with calc as (
    select
      c.*,
      case
        when c.last_visit_at is null then null
        else (now() at time zone 'Asia/Seoul')::date
          - (c.last_visit_at at time zone 'Asia/Seoul')::date
      end as days_since
    from public.customers c
    where c.store_id = v_store.id
  )
  select jsonb_build_object(
    'total_customers', count(*),
    'overdue_customers', count(*) filter (where days_since is not null and days_since >= v_cycle),
    'recommended_customers', count(*) filter (where days_since is not null and days_since >= greatest(v_cycle - 7, 0)),
    'new_customers_this_month', count(*) filter (
      where created_at >= ((date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul')
    ),
    'pending_messages', (
      select count(*)
      from public.messages m
      where m.store_id = v_store.id
        and m.status in ('pending', 'approved')
    )
  )
  into v_metrics
  from calc;

  with calc as (
    select
      c.*,
      case
        when c.last_visit_at is null then null
        else (now() at time zone 'Asia/Seoul')::date
          - (c.last_visit_at at time zone 'Asia/Seoul')::date
      end as days_since
    from public.customers c
    where c.store_id = v_store.id
  ),
  rows as (
    select
      jsonb_build_object(
        'id', id,
        'name', name,
        'phone_masked',
          case
            when length(phone) = 11 then substr(phone, 1, 3) || '-****-' || substr(phone, 8, 4)
            when length(phone) = 10 then substr(phone, 1, 3) || '-***-' || substr(phone, 7, 4)
            else '****'
          end,
        'visit_count', visit_count,
        'last_visit_at', last_visit_at,
        'last_visit_days', days_since,
        'expected_revisit_label',
          case
            when days_since is null then '-'
            when days_since > v_cycle then '지남'
            when days_since = v_cycle then '오늘'
            when v_cycle - days_since <= 7 then (v_cycle - days_since)::text || '일 뒤'
            else '여유 있음'
          end,
        'status_kind',
          case
            when days_since is not null and days_since >= v_cycle then 'due'
            when days_since is not null and days_since >= greatest(v_cycle - 7, 0) then 'soon'
            else 'ok'
          end,
        'status_label',
          case
            when days_since is not null and days_since >= v_cycle then '지금 안내'
            when days_since is not null and days_since >= greatest(v_cycle - 7, 0) then '미리 안내'
            else '여유 있음'
          end
      ) as item,
      case
        when days_since is null then 3
        when days_since >= v_cycle then 0
        when days_since >= greatest(v_cycle - 7, 0) then 1
        else 2
      end as sort_group,
      days_since
    from calc
    order by sort_group, days_since desc nulls last, created_at desc
    limit 50
  )
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into v_customers
  from rows;

  return jsonb_build_object(
    'store', jsonb_build_object(
      'id', v_store.id,
      'store_code', v_store.store_code,
      'name', v_store.name,
      'phone', v_store.phone,
      'address', v_store.address,
      'booking_url', v_store.booking_url,
      'industry', v_store.industry
    ),
    'metrics', v_metrics,
    'customers', v_customers
  );
end;
$$;

revoke all on function public.resolve_store_by_code(text) from public;
revoke all on function public.qr_customer_lookup(text, text) from public;
revoke all on function public.qr_customer_register(text, text, text, boolean) from public;
revoke all on function public.qr_customer_checkin(text, text) from public;
revoke all on function public.qr_owner_dashboard_snapshot(text) from public;

grant execute on function public.qr_customer_lookup(text, text) to anon, authenticated;
grant execute on function public.qr_customer_register(text, text, text, boolean) to anon, authenticated;
grant execute on function public.qr_customer_checkin(text, text) to anon, authenticated;
grant execute on function public.qr_owner_dashboard_snapshot(text) to anon, authenticated;
