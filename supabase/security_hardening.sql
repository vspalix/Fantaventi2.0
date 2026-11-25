-- Fantaventi — chiusura dei buchi lasciati dagli script eseguiti dopo rls_public.sql.
-- Incollalo nell'editor SQL di Supabase. È idempotente.
--
-- Il browser continua a fare solo auth. Le API usano la service role, che ha bypassrls:
-- queste revoke non cambiano il comportamento dell'app. Chiudono la chiave anon
-- e il JWT di un utente, se qualcuno li usa direttamente contro Postgres.

-- RLS su ogni tabella public, anche quelle create dopo rls_public.sql.
do $$
declare
  row record;
begin
  for row in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', row.name);
  end loop;
end $$;

-- Le prossime tabelle create da postgres non si aprono da sole ad anon e authenticated.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, public;

-- Tabelle interne: nessun accesso client. La service role continua a scriverle.
do $$
declare
  name text;
  locked text[] := array[
    'vote_imports',
    'player_gameweek_stats',
    'checkpoints',
    'checkpoint_moves',
    'calendar_sync_runs',
    'external_fixtures',
    'engagement_notices',
    'live_rank_snapshots',
    'ops_latency',
    'notification_templates',
    'club_badges',
    'platform_home',
    'push_subscriptions'
  ];
begin
  foreach name in array locked loop
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('revoke all on table public.%I from public, anon, authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end $$;

-- La vista delle giornate fa join su questa tabella. La select resta, la scrittura no.
-- Senza policy il client non vede righe: le override le legge solo la service role.
do $$
begin
  if to_regclass('public.gameweek_overrides') is not null then
    execute 'revoke all on table public.gameweek_overrides from public, anon, authenticated';
    execute 'grant select on table public.gameweek_overrides to anon, authenticated';
    execute 'grant select, insert, update, delete on table public.gameweek_overrides to service_role';
  end if;
end $$;

-- Impostazioni e storico sync: lettura solo se la policy super admin passa. Scrittura solo service role.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    execute 'revoke all on table public.system_settings from public, anon, authenticated';
    execute 'grant select on table public.system_settings to authenticated';
    execute 'grant select, insert, update, delete on table public.system_settings to service_role';
  end if;
  if to_regclass('public.sync_logs') is not null then
    execute 'revoke all on table public.sync_logs from public, anon, authenticated';
    execute 'grant select on table public.sync_logs to authenticated';
    execute 'grant select, insert, update, delete on table public.sync_logs to service_role';
  end if;
  if to_regclass('public.app_settings') is not null then
    execute 'revoke all on table public.app_settings from public, anon, authenticated';
    execute 'grant select on table public.app_settings to authenticated';
    execute 'grant select, insert, update, delete on table public.app_settings to service_role';
  end if;
  if to_regclass('public.admin_audit_logs') is not null then
    execute 'revoke all on table public.admin_audit_logs from public, anon, authenticated';
    execute 'grant select on table public.admin_audit_logs to authenticated';
    execute 'grant select, insert, update, delete on table public.admin_audit_logs to service_role';
  end if;
end $$;

-- Dati di lega: il client può leggere solo dove esiste già una policy.
-- Insert, update e delete restano alla service role, così un JWT non scrive
-- formazioni, rose o membri di un'altra lega saltando le API.
do $$
declare
  name text;
  readable text[] := array[
    'profiles',
    'fantasy_teams',
    'lineups',
    'lineup_slots',
    'lineup_player_scores',
    'roster_stints',
    'roster_checkpoint_uses',
    'team_gameweek_scores',
    'private_leagues',
    'private_league_members',
    'league_delegates',
    'league_regulations',
    'league_feed',
    'league_badges',
    'player_availability',
    'app_announcements',
    'platform_news',
    'platform_maintenance'
  ];
begin
  foreach name in array readable loop
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('revoke all on table public.%I from public, anon, authenticated', name);
    execute format('grant select on table public.%I to authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end $$;

-- Eccezioni già previste dalle policy: il proprietario aggiorna la propria squadra,
-- l'utente segna come letto un proprio avviso.
do $$
begin
  if to_regclass('public.fantasy_teams') is not null then
    execute 'grant update on table public.fantasy_teams to authenticated';
  end if;
  if to_regclass('public.user_notices') is not null then
    execute 'revoke all on table public.user_notices from public, anon, authenticated';
    execute 'grant select, update on table public.user_notices to authenticated';
    execute 'grant select, insert, update, delete on table public.user_notices to service_role';
  end if;
end $$;

-- Catalogo pubblico: sola lettura. Nessuna scrittura dal client.
do $$
declare
  name text;
  catalog text[] := array[
    'competitions',
    'competition_translations',
    'seasons',
    'rulesets',
    'clubs',
    'club_translations',
    'season_clubs',
    'players',
    'player_registrations',
    'gameweeks',
    'real_matches',
    'bonus_type_translations'
  ];
begin
  foreach name in array catalog loop
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('revoke all on table public.%I from public, anon, authenticated', name);
    execute format('grant select on table public.%I to anon, authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end $$;

-- Le funzioni di scrittura e calcolo non sono chiamabili dal browser.
-- Restano eseguibili da is_super_admin, can_read_team e can_read_league, usate dalle policy.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    if fn.name in ('is_super_admin', 'can_read_team', 'can_read_league') then
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end $$;
