-- Impostazioni del laboratorio e storico delle sincronizzazioni.
-- Eseguilo nell'editor SQL di Supabase. L'app scrive i log con la service role.

create table if not exists public.system_settings (
  id integer primary key check (id = 1),
  votes_source_url text not null default 'https://www.fantacalcio.it/serie-a/voti',
  votes_provider text not null default 'fantacalcio',
  availability_provider text not null default 'api-sports',
  api_sports_league_id integer not null default 135,
  api_sports_season integer not null default 2026,
  sync_window_post_match_min integer not null default 125,
  sync_window_post_match_max integer not null default 150,
  sync_window_evening_start text not null default '23:15',
  sync_window_evening_end text not null default '23:45',
  sync_window_morning_start text not null default '09:15',
  sync_window_morning_end text not null default '09:45',
  auto_sync_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.system_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_type text not null check (job_type in ('votes', 'availability')),
  trigger_source text not null check (trigger_source in ('cron', 'manual')),
  status text not null check (status in ('success', 'skipped', 'error')),
  records_written integer not null default 0,
  message text not null default ''
);

alter table public.system_settings enable row level security;
alter table public.sync_logs enable row level security;

revoke all on table public.system_settings from public, anon, authenticated;
revoke all on table public.sync_logs from public, anon, authenticated;

grant select, insert, update, delete on table public.system_settings to service_role;
grant select, insert, update, delete on table public.sync_logs to service_role;
grant select, insert, update, delete on table public.system_settings to authenticated;
grant select on table public.sync_logs to authenticated;

drop policy if exists system_settings_admin on public.system_settings;
create policy system_settings_admin on public.system_settings
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists sync_logs_admin_read on public.sync_logs;
create policy sync_logs_admin_read on public.sync_logs
  for select to authenticated
  using (public.is_super_admin());
