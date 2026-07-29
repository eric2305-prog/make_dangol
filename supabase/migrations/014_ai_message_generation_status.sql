-- Adds explicit AI generation and sending states for customer-facing messages.
-- Review before applying to Production.

alter table public.messages
  add column if not exists ai_status text not null default 'not_started',
  add column if not exists send_status text not null default 'draft',
  add column if not exists ai_model text,
  add column if not exists error_message text;

alter table public.messages
  alter column body drop not null;

alter table public.messages
  drop constraint if exists messages_status_check;

update public.messages
set status = 'canceled'
where status = 'cancelled';

alter table public.messages
  add constraint messages_status_check
  check (status in ('draft', 'pending', 'approved', 'sent', 'failed', 'canceled'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_ai_status_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_ai_status_check
      check (ai_status in ('not_started', 'generating', 'generated', 'failed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_send_status_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_send_status_check
      check (send_status in ('draft', 'pending', 'sent', 'failed', 'canceled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_generated_pending_body_required'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_generated_pending_body_required
      check (
        not (ai_status = 'generated' and send_status = 'pending')
        or coalesce(btrim(body), '') <> ''
      );
  end if;
end $$;

create or replace function public.is_test_fallback_message(p_body text)
returns boolean
language sql
immutable
as $$
  select coalesce(btrim(p_body), '') ~*
    '(revaro\s+default\s+message|test\s+message|fallback\s+message|dummy\s+message|sample\s+message|lorem\s+ipsum)'
$$;

alter table public.messages
  drop constraint if exists messages_no_test_fallback_body;

alter table public.messages
  add constraint messages_no_test_fallback_body
  check (
    send_status not in ('pending', 'sent')
    or not public.is_test_fallback_message(body)
  )
  not valid;

create unique index if not exists messages_one_pending_return_visit_per_customer
  on public.messages(store_id, customer_id, message_type)
  where message_type = 'return_visit'
    and send_status = 'pending';

comment on column public.messages.ai_status
  is 'AI generation status: not_started, generating, generated, failed.';

comment on column public.messages.send_status
  is 'Outbound queue status: draft, pending, sent, failed, canceled.';
