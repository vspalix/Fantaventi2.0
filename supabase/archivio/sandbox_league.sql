-- Fantaventi — lega sandbox isolata dal gioco reale.
-- Eseguire nell'editor SQL di Supabase. Non tocca le righe già presenti:
-- is_sandbox nasce false. Le policy RLS restano quelle di rls_public.sql:
-- authenticated non scrive sulle leghe, il service role continua a bypassare la RLS.

alter table public.private_leagues
  add column if not exists is_sandbox boolean not null default false;

alter table public.fantasy_teams
  add column if not exists is_sandbox boolean not null default false;

alter table public.seasons
  add column if not exists is_sandbox boolean not null default false;

alter table public.fantasy_teams drop constraint if exists fantasy_teams_user_id_season_id_key;
drop index if exists public.fantasy_teams_user_id_season_id_key;
drop index if exists public.fantasy_teams_real_owner_uidx;

create index if not exists fantasy_teams_user_season_idx
  on public.fantasy_teams (user_id, season_id);

create index if not exists private_leagues_sandbox_idx
  on public.private_leagues (is_sandbox);

create index if not exists fantasy_teams_sandbox_idx
  on public.fantasy_teams (is_sandbox);
