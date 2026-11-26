-- Fantaventi — allinea un database già creato alle tabelle e alle colonne del codice.
-- Esegui questo file nell'editor SQL di Supabase ogni volta che il progetto aggiunge un campo.
-- Si può rieseguire: non cancella calciatori, rose, voti o punteggi.
--
-- Le funzioni di calendario restano in calendar_setup.sql e multi_competition.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

do $enum$
begin
  create type public.player_role as enum ('GK', 'DEF', 'MID', 'FWD');
exception
  when duplicate_object then null;
end
$enum$;

do $enum$
begin
  create type public.season_status as enum ('draft', 'open', 'running', 'closed');
exception
  when duplicate_object then null;
end
$enum$;

do $enum$
begin
  create type public.gameweek_status as enum ('scheduled', 'open', 'locked', 'scored', 'final');
exception
  when duplicate_object then null;
end
$enum$;

do $enum$
begin
  create type public.lineup_status as enum ('draft', 'locked');
exception
  when duplicate_object then null;
end
$enum$;

do $enum$
begin
  create type public.match_status as enum ('scheduled', 'locked', 'live', 'finished');
exception
  when duplicate_object then null;
end
$enum$;

do $enum$
begin
  alter type public.match_status add value if not exists 'locked';
exception
  when duplicate_object then null;
end
$enum$;

do $enum$
begin
  create type public.calendar_save_mode as enum ('manual', 'automatic');
exception
  when duplicate_object then null;
end
$enum$;

-- ---------------------------------------------------------------------------
-- Tabelle assenti
-- ---------------------------------------------------------------------------

create table if not exists public.real_matches (
  id             uuid primary key,
  gameweek_id    uuid not null references public.gameweeks (id),
  home_club_id   uuid not null references public.clubs (id),
  away_club_id   uuid not null references public.clubs (id),
  kickoff_at     timestamptz not null,
  kickoff_locked boolean not null default false,
  status         public.match_status not null default 'scheduled',
  home_goals     integer,
  away_goals     integer,
  unique (gameweek_id, home_club_id, away_club_id),
  check (home_club_id <> away_club_id),
  check (
    (home_goals is null and away_goals is null)
    or (home_goals >= 0 and away_goals >= 0)
  )
);

create index if not exists real_matches_gameweek_idx
  on public.real_matches (gameweek_id);

alter table public.real_matches add column if not exists home_goals integer;
alter table public.real_matches add column if not exists away_goals integer;

create table if not exists public.gameweek_overrides (
  gameweek_id  uuid primary key references public.gameweeks (id) on delete cascade,
  deadline_at  timestamptz,
  status       public.gameweek_status,
  note         text,
  updated_at   timestamptz not null default now(),
  check (deadline_at is not null or status is not null)
);

create table if not exists public.calendar_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references public.seasons (id),
  provider     text not null default 'api_football',
  save_mode    public.calendar_save_mode not null,
  status       text not null default 'stored' check (status in ('stored', 'applied')),
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  applied_at   timestamptz
);

create table if not exists public.external_fixtures (
  id               uuid primary key default gen_random_uuid(),
  season_id        uuid not null references public.seasons (id),
  gameweek_number  integer not null check (gameweek_number >= 1),
  external_ref     text not null,
  home_club_code   text,
  away_club_code   text,
  kickoff_at       timestamptz not null,
  save_mode        public.calendar_save_mode not null,
  sync_run_id      uuid not null references public.calendar_sync_runs (id),
  unique (season_id, external_ref)
);

create index if not exists external_fixtures_season_gameweek_idx
  on public.external_fixtures (season_id, gameweek_number);

-- ---------------------------------------------------------------------------
-- Colonne aggiunte dopo la prima creazione
-- ---------------------------------------------------------------------------

alter table public.players
  add column if not exists competition_id uuid;

alter table public.player_registrations
  add column if not exists role_locked boolean not null default false;

alter table public.gameweeks
  add column if not exists scored_at timestamptz;

alter table public.real_matches
  add column if not exists kickoff_locked boolean not null default false;

alter table public.player_gameweek_stats
  add column if not exists postponed boolean not null default false;

alter table public.lineup_slots
  add column if not exists is_starter boolean not null default true;

alter table public.lineup_slots
  add column if not exists slot_order integer not null default 0;

alter table public.lineups
  add column if not exists saved_at timestamptz;

alter table public.team_gameweek_scores
  add column if not exists provisional_total numeric(6,2);

alter table public.team_gameweek_scores
  add column if not exists rated_players_count integer not null default 0;

alter table public.team_gameweek_scores
  add column if not exists on_pitch_count integer not null default 0;

alter table public.team_gameweek_scores
  add column if not exists is_live boolean not null default false;

alter table public.private_leagues
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.private_leagues
  add column if not exists start_matchday integer default 1;

alter table public.private_leagues
  add column if not exists end_matchday integer default 38;

update public.private_leagues
set start_matchday = 1
where start_matchday is null;

update public.private_leagues
set end_matchday = 38
where end_matchday is null;

alter table public.private_leagues
  alter column start_matchday set default 1;

alter table public.private_leagues
  alter column start_matchday set not null;

alter table public.private_leagues
  alter column end_matchday set default 38;

alter table public.private_leagues
  alter column end_matchday set not null;

-- ---------------------------------------------------------------------------
-- Codice calciatore unico dentro la competizione
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'players_competition_id_fkey'
  ) then
    alter table public.players
      add constraint players_competition_id_fkey
      foreign key (competition_id) references public.competitions (id);
  end if;
end $$;

update public.players as player
set competition_id = picked.competition_id
from (
  select distinct on (registration.player_id)
    registration.player_id,
    season.competition_id
  from public.player_registrations as registration
  join public.seasons as season on season.id = registration.season_id
  order by registration.player_id, registration.effective_from_gameweek
) as picked
where player.id = picked.player_id
  and player.competition_id is null;

update public.players as player
set competition_id = competition.id
from public.competitions as competition
where player.competition_id is null
  and competition.code = 'serie_a';

do $$
begin
  if exists (select 1 from public.players where competition_id is null) then
    raise exception 'Restano calciatori senza competizione. Assegna players.competition_id e riesegui schema_sync.sql.';
  end if;
end $$;

alter table public.players
  alter column competition_id set not null;

alter table public.players drop constraint if exists players_external_ref_key;
drop index if exists public.players_external_ref_key;
alter table public.players drop constraint if exists players_competition_external_ref_key;
alter table public.players
  add constraint players_competition_external_ref_key
  unique (competition_id, external_ref);

-- ---------------------------------------------------------------------------
-- Vincoli di range senza il tetto di 38 giornate
-- ---------------------------------------------------------------------------

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_constraint as constraint_row
    join pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'private_leagues'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%38%'
  loop
    execute format('alter table public.private_leagues drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.private_leagues drop constraint if exists private_leagues_matchday_range;
alter table public.private_leagues
  add constraint private_leagues_matchday_range
  check (start_matchday >= 1 and end_matchday >= start_matchday);

do $$
declare
  constraint_name text;
begin
  if to_regclass('public.external_fixtures') is null then
    return;
  end if;
  for constraint_name in
    select constraint_row.conname
    from pg_constraint as constraint_row
    join pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'external_fixtures'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%38%'
  loop
    execute format('alter table public.external_fixtures drop constraint %I', constraint_name);
  end loop;
  if not exists (
    select 1 from pg_constraint where conname = 'external_fixtures_gameweek_number_check'
  ) then
    alter table public.external_fixtures
      add constraint external_fixtures_gameweek_number_check
      check (gameweek_number >= 1);
  end if;
end $$;

alter table public.player_gameweek_stats
  drop constraint if exists player_gameweek_stats_vote_import_id_fkey;

alter table public.player_gameweek_stats
  add constraint player_gameweek_stats_vote_import_id_fkey
  foreign key (vote_import_id)
  references public.vote_imports (id)
  on delete cascade;

create unique index if not exists vote_imports_gameweek_payload_uidx
  on public.vote_imports (gameweek_id, payload_hash)
  where source <> 'mock';

alter table public.real_matches drop constraint if exists real_matches_goals_check;
alter table public.real_matches
  add constraint real_matches_goals_check check (
    (home_goals is null and away_goals is null)
    or (home_goals >= 0 and away_goals >= 0)
  );

create or replace function public.gameweeks_final_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'final' and (
    new.deadline_at is distinct from old.deadline_at
    or new.number is distinct from old.number
    or new.season_id is distinct from old.season_id
  ) then
    raise exception 'La giornata % è final: restano fermi orario, numero e stagione.', old.number
      using errcode = '55000';
  end if;

  if old.status = 'final'
     and new.status is distinct from old.status
     and new.status not in ('locked', 'scored') then
    raise exception 'La giornata % è final: il calcolo si riapre solo su locked.', old.number
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create or replace function public.gameweek_deadline_from_kickoff(
  p_first_kickoff timestamptz
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select p_first_kickoff - interval '1 minute';
$$;
