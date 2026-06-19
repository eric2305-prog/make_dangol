-- Fix QR registration idempotency.
-- Same store_id + normalized phone must never create another customer.
-- No DELETE, TRUNCATE, DROP, or ALTER TABLE DROP is used.

create or replace function public.normalize_customer_phone(p_phone text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
$$;

do $$
begin
  if exists (
    select 1
    from public.customers
    group by store_id, public.normalize_customer_phone(phone)
    having count(*) > 1
  ) then
    raise exception '정규화 기준 중복 고객이 이미 있습니다. store_id + 숫자만 남긴 phone 기준으로 중복 데이터를 먼저 확인해 주세요.';
  end if;
end $$;

update public.customers
set phone = public.normalize_customer_phone(phone)
where phone <> public.normalize_customer_phone(phone);

create unique index if not exists customers_store_phone_unique
  on public.customers(store_id, phone);

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
  select *
  into v_store
  from public.stores
  where store_id = btrim(coalesce(p_store_id, ''))
    and coalesce(status, 'active') = 'active';

  if not found then
    raise exception '매장 정보를 찾을 수 없습니다.';
  end if;

  if p_phone is null then
    return jsonb_build_object(
      'mode', 'store',
      'store_id', v_store.store_id,
      'store_name', v_store.name,
      'store_uuid', v_store.id
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
      'store_id', v_store.store_id,
      'store_name', v_store.name,
      'store_uuid', v_store.id,
      'phone', v_phone
    );
  end if;

  select count(*)::integer, max(visit_date)
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
    'store_id', v_store.store_id,
    'store_name', v_store.name,
    'store_uuid', v_store.id,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'phone', v_customer.phone,
      'consent', coalesce(v_customer.consent, v_customer.marketing_agreed),
      'marketing_agreed', coalesce(v_customer.consent, v_customer.marketing_agreed),
      'visit_count', v_visit_count,
      'last_visit_days', v_last_visit_days,
      'next_visit_count',
        case when v_last_visit_at is null then null else v_visit_count + 1 end
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
  select *
  into v_store
  from public.stores
  where store_id = btrim(coalesce(p_store_id, ''))
    and coalesce(status, 'active') = 'active';

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
  where store_id = v_store.id
    and phone = v_phone;

  if not found then
    raise exception '등록된 고객 정보를 찾을 수 없습니다.';
  end if;

  insert into public.visits (
    customer_id,
    store_id,
    visit_date,
    visit_source
  )
  values (
    v_customer.id,
    v_store.id,
    v_now,
    'qr_checkin'
  );

  select count(*)::integer, max(visit_date)
  into v_visit_count, v_last_visit_at
  from public.visits
  where store_id = v_store.id
    and customer_id = v_customer.id;

  update public.customers
  set
    visit_count = v_visit_count,
    last_visit_at = v_last_visit_at
  where id = v_customer.id;

  return jsonb_build_object(
    'mode', 'checked_in',
    'store_id', v_store.store_id,
    'store_name', v_store.name,
    'store_uuid', v_store.id,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'phone', v_phone,
      'consent', coalesce(v_customer.consent, v_customer.marketing_agreed),
      'marketing_agreed', coalesce(v_customer.consent, v_customer.marketing_agreed),
      'visit_count', v_visit_count,
      'last_visit_at', v_last_visit_at
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
  v_customer public.customers%rowtype;
  v_customer_id uuid;
  v_now timestamptz := now();
begin
  select *
  into v_store
  from public.stores
  where store_id = btrim(coalesce(p_store_id, ''))
    and coalesce(status, 'active') = 'active';

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

  select *
  into v_customer
  from public.customers
  where store_id = v_store.id
    and phone = v_phone;

  if found then
    return public.qr_customer_checkin(p_store_id, v_phone);
  end if;

  insert into public.customers (
    store_id,
    name,
    phone,
    privacy_agreed,
    marketing_agreed,
    consent,
    visit_count,
    last_visit_at,
    status,
    updated_at,
    created_at
  )
  values (
    v_store.id,
    v_name,
    v_phone,
    true,
    coalesce(p_consent, false),
    coalesce(p_consent, false),
    1,
    v_now,
    'new',
    v_now,
    v_now
  )
  returning id into v_customer_id;

  insert into public.visits (
    customer_id,
    store_id,
    visit_date,
    visit_source
  )
  values (
    v_customer_id,
    v_store.id,
    v_now,
    'qr_register'
  );

  return jsonb_build_object(
    'mode', 'registered',
    'store_id', v_store.store_id,
    'store_name', v_store.name,
    'store_uuid', v_store.id,
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_name,
      'phone', v_phone,
      'consent', coalesce(p_consent, false),
      'marketing_agreed', coalesce(p_consent, false),
      'visit_count', 1
    )
  );
end;
$$;

grant execute on function public.qr_customer_lookup(text, text) to anon, authenticated;
grant execute on function public.qr_customer_checkin(text, text) to anon, authenticated;
grant execute on function public.qr_customer_register(text, text, text, boolean) to anon, authenticated;
