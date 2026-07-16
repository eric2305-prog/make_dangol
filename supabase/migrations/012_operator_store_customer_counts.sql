-- Add customer counts to the operator store list RPC.
-- Safe to run repeatedly. Does not delete or rewrite existing customer/visit data.

create or replace function public.operator_list_stores(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operator_sessions%rowtype;
  v_stores jsonb;
begin
  select *
  into v_session
  from public.operator_sessions
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now();

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.operator_sessions
  set last_seen_at = now()
  where id = v_session.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'store_uuid', s.id,
    'store_id', s.store_id,
    'store_name', s.name,
    'owner_name', o.name,
    'owner_email', o.email,
    'phone', s.phone,
    'address', s.address,
    'industry', s.industry,
    'status', coalesce(s.status, 'active'),
    'created_at', s.created_at,
    'pin_configured', (c.store_id is not null),
    'pin_updated_at', c.pin_updated_at,
    'customer_count', coalesce(customer_counts.customer_count, 0)
  ) order by s.created_at desc), '[]'::jsonb)
  into v_stores
  from public.stores s
  left join public.owners o on o.id = s.owner_id
  left join public.owner_credentials c on c.store_id = s.id
  left join lateral (
    select count(*)::int as customer_count
    from public.customers cu
    where cu.store_id = s.id
  ) customer_counts on true;

  return jsonb_build_object(
    'ok', true,
    'operator_email', v_session.operator_email,
    'stores', v_stores
  );
end;
$$;

revoke all on function public.operator_list_stores(text)
  from public, anon, authenticated;

grant execute on function public.operator_list_stores(text)
  to service_role;
