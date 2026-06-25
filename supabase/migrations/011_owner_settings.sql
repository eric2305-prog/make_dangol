-- Owner settings for MVP store operations.
-- Safe to run in Supabase SQL Editor. This does not delete or overwrite data.

create table if not exists public.settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  revisit_cycle_days integer not null default 30,
  default_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings
  add column if not exists reservation_url text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'settings_revisit_cycle_days_range'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_revisit_cycle_days_range
      check (revisit_cycle_days between 7 and 180);
  end if;
end;
$$;
