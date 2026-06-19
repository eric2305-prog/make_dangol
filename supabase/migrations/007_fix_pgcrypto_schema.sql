-- P0 PIN hash schema fix for Supabase projects that install pgcrypto
-- in the extensions schema. This migration does not modify customer data.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.owner_set_pin(
  p_store_code text,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_store public.stores%rowtype;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'PIN must contain exactly six digits.';
  end if;

  select *
  into v_store
  from public.stores
  where store_id = btrim(coalesce(p_store_code, ''))
    and coalesce(status, 'active') = 'active';

  if not found then
    raise exception 'Store not found.';
  end if;

  insert into public.owner_credentials (
    store_id,
    owner_id,
    pin_hash,
    is_active,
    pin_updated_at,
    updated_at
  )
  values (
    v_store.id,
    v_store.owner_id,
    extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
    true,
    now(),
    now()
  )
  on conflict (store_id) do update
  set
    owner_id = excluded.owner_id,
    pin_hash = excluded.pin_hash,
    is_active = true,
    pin_updated_at = now(),
    updated_at = now();

  update public.owner_sessions
  set revoked_at = now()
  where store_id = v_store.id
    and revoked_at is null;
end;
$$;

create or replace function public.owner_pin_login(
  p_store_code text,
  p_pin text,
  p_store_key_hash text,
  p_ip_hash text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_store public.stores%rowtype;
  v_credential public.owner_credentials%rowtype;
  v_recent_failures integer;
begin
  if length(coalesce(p_store_key_hash, '')) <> 64
    or length(coalesce(p_ip_hash, '')) <> 64
    or length(coalesce(p_token_hash, '')) <> 64 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  select count(*)::integer
  into v_recent_failures
  from public.owner_login_attempts
  where succeeded = false
    and attempted_at >= now() - interval '15 minutes'
    and (ip_hash = p_ip_hash or store_key_hash = p_store_key_hash);

  if v_recent_failures >= 5 then
    insert into public.owner_login_attempts (
      store_key_hash, ip_hash, succeeded
    ) values (
      p_store_key_hash, p_ip_hash, false
    );

    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  select *
  into v_store
  from public.stores
  where store_id = btrim(coalesce(p_store_code, ''))
    and coalesce(status, 'active') = 'active';

  if found then
    select *
    into v_credential
    from public.owner_credentials
    where store_id = v_store.id
      and owner_id = v_store.owner_id
      and is_active = true;
  end if;

  if v_store.id is null
    or v_credential.store_id is null
    or coalesce(p_pin, '') !~ '^[0-9]{6}$'
    or extensions.crypt(p_pin, v_credential.pin_hash) <> v_credential.pin_hash then
    insert into public.owner_login_attempts (
      store_id, store_key_hash, ip_hash, succeeded
    ) values (
      v_store.id, p_store_key_hash, p_ip_hash, false
    );

    return jsonb_build_object('ok', false, 'code', 'INVALID_CREDENTIALS');
  end if;

  if p_expires_at <= now()
    or p_expires_at > now() + interval '30 minutes' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EXPIRY');
  end if;

  update public.owner_sessions
  set revoked_at = now()
  where store_id = v_store.id
    and revoked_at is null;

  insert into public.owner_sessions (
    owner_id, store_id, token_hash, expires_at
  ) values (
    v_store.owner_id, v_store.id, p_token_hash, p_expires_at
  );

  insert into public.owner_login_attempts (
    store_id, store_key_hash, ip_hash, succeeded
  ) values (
    v_store.id, p_store_key_hash, p_ip_hash, true
  );

  return jsonb_build_object(
    'ok', true,
    'store_name', v_store.name,
    'expires_at', p_expires_at
  );
end;
$$;

revoke all on function public.owner_set_pin(text, text) from public, anon, authenticated;
revoke all on function public.owner_pin_login(text, text, text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.owner_set_pin(text, text) to service_role;
grant execute on function public.owner_pin_login(text, text, text, text, text, timestamptz) to service_role;
