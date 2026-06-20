-- Separate the customer registration consent states used by the MVP.
-- Apply this migration before deploying the matching customer.html change.

alter table public.customers
  add column if not exists kakao_agreed boolean not null default false;

comment on column public.customers.privacy_agreed is
  'Required consent to store the customer name and phone number.';

comment on column public.customers.kakao_agreed is
  'Optional consent to receive messages through the store Kakao channel.';

comment on column public.customers.marketing_agreed is
  'Optional consent to receive revisit and store marketing information.';

comment on column public.customers.consent is
  'Legacy send eligibility flag. True only when Kakao and marketing consent are both true.';

create or replace function public.qr_customer_register(
  p_store_id text,
  p_phone text,
  p_name text,
  p_privacy_agreed boolean,
  p_kakao_agreed boolean default false,
  p_marketing_agreed boolean default false
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
  where store_id = btrim(coalesce(p_store_id, ''))
    and coalesce(status, 'active') = 'active';

  if not found then
    raise exception 'Store not found.';
  end if;

  v_phone := public.normalize_customer_phone(p_phone);
  v_name := btrim(coalesce(p_name, ''));

  if length(v_phone) not in (10, 11)
    or v_name = ''
    or coalesce(p_privacy_agreed, false) = false then
    raise exception 'Invalid registration request.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_store.id::text || ':' || v_phone, 0)
  );

  select id
  into v_customer_id
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
    kakao_agreed,
    marketing_agreed,
    consent,
    visit_count,
    last_visit_at,
    status,
    created_at,
    updated_at
  ) values (
    v_store.id,
    v_name,
    v_phone,
    true,
    coalesce(p_kakao_agreed, false),
    coalesce(p_marketing_agreed, false),
    coalesce(p_kakao_agreed, false) and coalesce(p_marketing_agreed, false),
    1,
    v_now,
    'new',
    v_now,
    v_now
  ) returning id into v_customer_id;

  insert into public.visits (
    customer_id,
    store_id,
    visit_date,
    visit_source
  ) values (
    v_customer_id,
    v_store.id,
    v_now,
    'qr_register'
  );

  return jsonb_build_object('mode', 'registered', 'store_name', v_store.name);
end;
$$;

revoke all on function public.qr_customer_register(text, text, text, boolean)
  from public, anon, authenticated;

revoke all on function public.qr_customer_register(text, text, text, boolean, boolean, boolean)
  from public;

grant execute on function public.qr_customer_register(text, text, text, boolean, boolean, boolean)
  to anon, authenticated;
