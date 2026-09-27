-- Web Push reminders for the installed web app.
--
-- push_subscriptions: one row per browser that allowed notifications, with
-- the endpoint and keys the push service handed out and the device's
-- timezone (delivery times in settings are wall-clock).
-- push_log: one row per (user, local date, time, list) that was sent, so the
-- 5-minute cron never sends the same occurrence twice.

create table if not exists public.push_subscriptions (
  endpoint   text        primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  p256dh     text        not null,
  auth       text        not null,
  tz         text        not null default 'Europe/Sarajevo',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: own rows"
  on public.push_subscriptions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.push_log (
  user_id    uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  time       text not null,
  list       text not null,          -- 'g' guidance, 'a' arabic
  sent_at    timestamptz not null default now(),
  primary key (user_id, local_date, time, list)
);
-- Written only by the Edge Function with the service role; nobody else needs it.
alter table public.push_log enable row level security;

-- The sender runs every 5 minutes. pg_cron and pg_net must be enabled first
-- (Database → Extensions in the dashboard, or the two lines below).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace <CRON_SECRET> with the value set as the function's CRON_SECRET
-- secret before running this block. Re-running replaces the schedule.
select cron.unschedule('tezkija-reminders')
  where exists (select 1 from cron.job where jobname = 'tezkija-reminders');
select cron.schedule(
  'tezkija-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://hypiuelwvjhzvxvrpzoi.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Keep the log small: nothing older than a week matters.
select cron.unschedule('tezkija-push-log-prune')
  where exists (select 1 from cron.job where jobname = 'tezkija-push-log-prune');
select cron.schedule(
  'tezkija-push-log-prune',
  '17 3 * * *',
  $$ delete from public.push_log where sent_at < now() - interval '7 days' $$
);
