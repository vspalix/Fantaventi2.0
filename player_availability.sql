-- Indisponibili della giornata e impostazione della fonte.
-- Eseguilo nell'editor SQL di Supabase. L'app scrive con la service role.

create table if not exists public.player_availability (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  matchday integer not null check (matchday >= 1),
  status text not null check (status in ('available', 'starter', 'bench', 'doubt', 'injured', 'suspended')),
  play_probability integer check (play_probability is null or play_probability between 0 and 100),
  reason text,
  source_provider text not null,
  updated_at timestamptz not null default now(),
  unique (player_id, matchday)
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_availability enable row level security;
alter table public.app_settings enable row level security;

revoke all on table public.player_availability from public;
revoke all on table public.app_settings from public;
grant select, insert, update, delete on table public.player_availability to service_role;
grant select, insert, update, delete on table public.app_settings to service_role;

drop policy if exists player_availability_read on public.player_availability;
create policy player_availability_read on public.player_availability
  for select to authenticated
  using (true);

drop policy if exists player_availability_admin on public.player_availability;
create policy player_availability_admin on public.player_availability
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
