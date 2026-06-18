-- Review before applying. This migration enables the public QR customer flow.
-- It must be applied after 001_initial_schema.sql.

create or replace function public.normalize_customer_phone(p_phone text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
$$;

create or replace function public.customer_flow_lookup(
  p_store_id uuid,
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
  select *
  into v_store
  from public.stores
  where id = p_store_id
    and is_active = true;

  if not found then
    raise exception '매장 정보를 찾을 수 없습니다.';
  end if;

  if p_phone is null then
    return jsonb_build_object(
      'mode', 'store',
      'store_id', v_store.id,
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
  where store_id = p_store_id
    and phone = v_phone;

  if not found then
    return jsonb_build_object(
      'mode', 'new',
      'store_id', v_store.id,
      'store_name', v_store.name,
      'phone', v_phone
    );
  end if;

  select count(*)::integer, max(visited_at)
  into v_visit_count, v_last_visit_at
  from public.visits
  where store_id = p_store_id
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
    'store_id', v_store.id,
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

create or replace function public.customer_flow_register(
  p_store_id uuid,
  p_phone text,
  p_name text,
  p_marketing_agreed boolean default true
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
  select *
  into v_store
  from public.stores
  where id = p_store_id
    and is_active = true;

  if not found then
    raise exception '매장 정보를 찾을 수 없습니다.';
  end if;

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
    p_store_id,
    v_name,
    v_phone,
    true,
    coalesce(p_marketing_agreed, false),
    1,
    v_now,
    'new',
    v_now,
    v_now
  )
  on conflict (store_id, phone) do nothing
  returning id into v_customer_id;

  if v_customer_id is null then
    return public.customer_flow_lookup(p_store_id, v_phone);
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
    p_store_id,
    v_customer_id,
    'qr_checkin',
    'customer',
    v_now,
    v_now
  );

  return jsonb_build_object(
    'mode', 'registered',
    'store_id', v_store.id,
    'store_name', v_store.name,
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_name,
      'phone', v_phone,
      'marketing_agreed', coalesce(p_marketing_agreed, false),
      'visit_count', 1
    )
  );
end;
$$;

create or replace function public.customer_flow_checkin(
  p_store_id uuid,
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
  select *
  into v_store
  from public.stores
  where id = p_store_id
    and is_active = true;

  if not found then
    raise exception '매장 정보를 찾을 수 없습니다.';
  end if;

  v_phone := public.normalize_customer_phone(p_phone);
  if length(v_phone) not in (10, 11) then
    raise exception '휴대폰 번호를 정확히 입력해 주세요.';
  end if;

  select *
  into v_customer
  from public.customers
  where store_id = p_store_id
    and phone = v_phone;

  if not found then
    raise exception '등록된 단골 정보를 찾을 수 없습니다.';
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
    p_store_id,
    v_customer.id,
    'qr_checkin',
    'customer',
    v_now,
    v_now
  );

  select count(*)::integer, max(visited_at)
  into v_visit_count, v_last_visit_at
  from public.visits
  where store_id = p_store_id
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
    'store_id', v_store.id,
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

revoke all on function public.normalize_customer_phone(text) from public;
revoke all on function public.customer_flow_lookup(uuid, text) from public;
revoke all on function public.customer_flow_register(uuid, text, text, boolean) from public;
revoke all on function public.customer_flow_checkin(uuid, text) from public;

grant execute on function public.customer_flow_lookup(uuid, text) to anon, authenticated;
grant execute on function public.customer_flow_register(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.customer_flow_checkin(uuid, text) to anon, authenticated;
