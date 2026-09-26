-- Per-user app state, one row per key. The value is the same JSON the app
-- keeps under that key locally (see src/lib/store.ts for the key list);
-- updated_at is the client's write time and decides which copy wins.
create table if not exists public.user_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

create policy "user_state: own rows"
  on public.user_state
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
