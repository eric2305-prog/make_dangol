-- Review before applying. Do not run this migration until approved.

create table if not exists public.notification_tasks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  type text not null
    check (type in (
      'daily_task_summary',
      'ai_message_review_required',
      'inactive_customer_warning'
    )),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  target_url text not null,
  channel text not null default 'none'
    check (channel in ('none', 'kakao')),
  scheduled_for date not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);

create unique index if not exists ux_notification_tasks_dedup
  on public.notification_tasks (store_id, type, scheduled_for);

create index if not exists ix_notification_tasks_store_date
  on public.notification_tasks (store_id, scheduled_for);

create index if not exists ix_notification_tasks_store_unread
  on public.notification_tasks (store_id, read_at);

alter table public.notification_tasks enable row level security;

drop policy if exists "Owners can read own notification tasks" on public.notification_tasks;
create policy "Owners can read own notification tasks"
on public.notification_tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    join public.owners on owners.id = stores.owner_id
    where stores.id = notification_tasks.store_id
      and owners.user_id = auth.uid()
  )
);

-- No public insert policy is added.
-- Daily task creation should be performed by a trusted server or Edge Function
-- using the service_role key.
--
-- No direct table update policy is added.
-- Owners mark tasks read through mark_notification_read(), which only updates read_at.

create or replace function public.mark_notification_read(p_id uuid)
returns public.notification_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_task public.notification_tasks;
begin
  update public.notification_tasks
  set read_at = now()
  where id = p_id
    and read_at is null
    and exists (
      select 1
      from public.stores
      join public.owners on owners.id = stores.owner_id
      where stores.id = notification_tasks.store_id
        and owners.user_id = auth.uid()
    )
  returning * into updated_task;

  return updated_task;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
