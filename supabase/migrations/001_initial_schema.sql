create extension if not exists pgcrypto;

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text not null,
  privacy_agreed boolean not null default false,
  marketing_agreed boolean not null default false,
  visit_count integer not null default 0,
  last_visit_at timestamptz,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_store_phone_unique unique (store_id, phone),
  constraint customers_privacy_required check (privacy_agreed = true),
  constraint customers_status_check check (status in ('new', 'active', 'dormant'))
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source text not null default 'qr_checkin',
  created_by text not null default 'customer',
  visited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint visits_source_check check (source in ('qr_checkin', 'owner_manual')),
  constraint visits_created_by_check check (created_by in ('customer', 'owner', 'system'))
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  message_type text not null,
  channel text not null default 'kakao',
  body text not null,
  status text not null default 'pending',
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_type_check check (message_type in ('welcome', 'return_visit', 'manual')),
  constraint messages_channel_check check (channel in ('kakao', 'sms')),
  constraint messages_status_check check (status in ('draft', 'pending', 'approved', 'sent', 'failed', 'cancelled'))
);

create table if not exists public.send_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  channel text not null default 'kakao',
  status text not null,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint send_logs_channel_check check (channel in ('kakao', 'sms')),
  constraint send_logs_status_check check (status in ('success', 'failed'))
);

create index if not exists stores_owner_id_idx on public.stores(owner_id);
create index if not exists customers_store_id_idx on public.customers(store_id);
create index if not exists visits_store_id_visited_at_idx on public.visits(store_id, visited_at desc);
create index if not exists visits_customer_id_idx on public.visits(customer_id);
create index if not exists messages_store_id_status_idx on public.messages(store_id, status);
create index if not exists send_logs_store_id_created_at_idx on public.send_logs(store_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists owners_set_updated_at on public.owners;
create trigger owners_set_updated_at
before update on public.owners
for each row execute function public.set_updated_at();

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists messages_set_updated_at on public.messages;
create trigger messages_set_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

alter table public.owners enable row level security;
alter table public.stores enable row level security;
alter table public.customers enable row level security;
alter table public.visits enable row level security;
alter table public.messages enable row level security;
alter table public.send_logs enable row level security;

drop policy if exists "Owners can read own owner profile" on public.owners;
create policy "Owners can read own owner profile"
on public.owners
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Owners can update own owner profile" on public.owners;
create policy "Owners can update own owner profile"
on public.owners
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Owners can read own stores" on public.stores;
create policy "Owners can read own stores"
on public.stores
for select
to authenticated
using (
  exists (
    select 1
    from public.owners
    where owners.id = stores.owner_id
      and owners.user_id = auth.uid()
  )
);

drop policy if exists "Owners can manage own stores" on public.stores;
create policy "Owners can manage own stores"
on public.stores
for all
to authenticated
using (
  exists (
    select 1
    from public.owners
    where owners.id = stores.owner_id
      and owners.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owners
    where owners.id = stores.owner_id
      and owners.user_id = auth.uid()
  )
);

drop policy if exists "Owners can read own customers" on public.customers;
create policy "Owners can read own customers"
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    join public.owners on owners.id = stores.owner_id
    where stores.id = customers.store_id
      and owners.user_id = auth.uid()
  )
);

drop policy if exists "Owners can read own visits" on public.visits;
create policy "Owners can read own visits"
on public.visits
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    join public.owners on owners.id = stores.owner_id
    where stores.id = visits.store_id
      and owners.user_id = auth.uid()
  )
);

drop policy if exists "Owners can read own messages" on public.messages;
create policy "Owners can read own messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    join public.owners on owners.id = stores.owner_id
    where stores.id = messages.store_id
      and owners.user_id = auth.uid()
  )
);

drop policy if exists "Owners can read own send logs" on public.send_logs;
create policy "Owners can read own send logs"
on public.send_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    join public.owners on owners.id = stores.owner_id
    where stores.id = send_logs.store_id
      and owners.user_id = auth.uid()
  )
);
