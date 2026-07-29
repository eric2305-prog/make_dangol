-- Prepares pending AI messages for Make/NHN Cloud delivery.
-- Safe to run in Supabase SQL Editor. This does not delete or reset existing data.

alter table public.messages
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists sent_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failed_reason text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

alter table public.send_logs
  add column if not exists provider text,
  add column if not exists status_code integer,
  add column if not exists response_payload jsonb,
  add column if not exists attempted_at timestamptz not null default now();

create index if not exists messages_send_queue_idx
  on public.messages(created_at)
  where message_type = 'return_visit'
    and ai_status = 'generated'
    and send_status = 'pending';

create index if not exists send_logs_message_id_created_at_idx
  on public.send_logs(message_id, created_at desc);

comment on column public.messages.provider
  is 'Latest outbound provider prepared for this message, for example nhn_cloud.';

comment on column public.messages.provider_message_id
  is 'Latest outbound provider message identifier returned after sending.';

comment on column public.messages.failed_reason
  is 'Latest outbound failure reason. Detailed per-attempt payloads are stored in send_logs.';

comment on column public.messages.retry_count
  is 'Number of failed outbound attempts recorded for this message.';

comment on column public.messages.last_attempt_at
  is 'Timestamp of the latest outbound attempt recorded by Make/NHN integration.';

comment on column public.send_logs.provider
  is 'Outbound provider used for this send attempt, for example nhn_cloud.';

comment on column public.send_logs.status_code
  is 'Provider HTTP or result status code, when available.';

comment on column public.send_logs.response_payload
  is 'Provider response payload for audit/debugging. Do not store secrets.';

comment on column public.send_logs.attempted_at
  is 'Timestamp when the outbound attempt was made or recorded.';
