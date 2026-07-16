-- Block test fallback messages from being queued for Kakao/SMS sending.
-- This does not delete or rewrite existing rows. It prevents new pending/approved/sent rows
-- from using known non-customer fallback text.

create or replace function public.is_test_fallback_message(p_body text)
returns boolean
language sql
immutable
as $$
  select coalesce(btrim(p_body), '') ~* '^revaro default message(\s|$)'
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_no_test_fallback_body'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_no_test_fallback_body
      check (
        status not in ('pending', 'approved', 'sent')
        or not public.is_test_fallback_message(body)
      )
      not valid;
  end if;
end $$;

comment on constraint messages_no_test_fallback_body on public.messages
  is 'Prevents known test fallback messages from entering sendable message statuses.';
