-- Simplify operator PIN audit reasons for the MVP.

alter table public.operator_pin_audit
  drop constraint if exists operator_pin_audit_reason_check;

update public.operator_pin_audit
set reason = 'reissue'
where reason in ('forgot_pin', 'security_reset');

alter table public.operator_pin_audit
  add constraint operator_pin_audit_reason_check
  check (reason in ('initial_issue', 'reissue'));

create or replace function public.operator_issue_owner_pin(
  p_token_hash text,
  p_store_code text,
  p_pin text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session public.operator_sessions%rowtype;
  v_store public.stores%rowtype;
  v_had_pin boolean;
  v_action text;
begin
  select *
  into v_session
  from public.operator_sessions
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  if coalesce(p_pin, '') !~ '^[0-9]{6}$'
    or p_reason not in ('initial_issue', 'reissue') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  select *
  into v_store
  from public.stores
  where store_id = btrim(coalesce(p_store_code, ''))
    and coalesce(status, 'active') = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'STORE_NOT_FOUND');
  end if;

  select exists(
    select 1 from public.owner_credentials where store_id = v_store.id
  ) into v_had_pin;

  perform public.owner_set_pin(v_store.store_id, p_pin);
  v_action := case when v_had_pin then 'reissued' else 'issued' end;

  insert into public.operator_pin_audit(
    operator_email, store_id, store_code, action, reason
  ) values (
    v_session.operator_email, v_store.id, v_store.store_id, v_action, p_reason
  );

  update public.operator_sessions set last_seen_at = now() where id = v_session.id;

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'store_id', v_store.store_id,
    'store_name', v_store.name
  );
end;
$$;

revoke all on function public.operator_issue_owner_pin(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.operator_issue_owner_pin(text, text, text, text)
  to service_role;
