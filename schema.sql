-- Fantaventi — schema PostgreSQL (PRD, sezione 8)
-- Database nuovo: eseguire questo file prima di supabase_seed.sql.
-- Database già creato: eseguire schema_sync.sql. CREATE TABLE IF NOT EXISTS
-- non aggiunge le colonne nate dopo la prima creazione della tabella.
-- PostgreSQL non ha CREATE TYPE IF NOT EXISTS: gli enum si creano solo se mancano.

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
  create type public.gameweek_status as enum (
    'scheduled',
    'open',
    'locked',
    'scored',
    'final'
  );
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

-- ---------------------------------------------------------------------------
-- Identità
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  first_name    text,
  last_name     text,
  phone         text,
  display_name  text not null,
  locale        text not null default 'it',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Competizione, stagione, regolamento
-- ---------------------------------------------------------------------------

create table if not exists public.competitions (
  id            uuid primary key,
  code          text not null unique,
  country_code  char(2) not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.competition_translations (
  competition_id uuid not null references public.competitions (id),
  locale         text not null,
  name           text not null,
  primary key (competition_id, locale)
);

create table if not exists public.rulesets (
  id         uuid primary key,
  code       text not null,
  version    integer not null,
  definition jsonb not null,
  unique (code, version)
);

create table if not exists public.seasons (
  id              uuid primary key,
  competition_id  uuid not null references public.competitions (id),
  ruleset_id      uuid not null references public.rulesets (id),
  code            text not null,
  status          public.season_status not null default 'draft',
  starts_on       date,
  ends_on         date,
  unique (competition_id, code)
);

-- ---------------------------------------------------------------------------
-- Club, calciatori, listone
-- ---------------------------------------------------------------------------

create table if not exists public.clubs (
  id              uuid primary key,
  competition_id  uuid not null references public.competitions (id),
  code            text not null,
  unique (competition_id, code)
);

create table if not exists public.club_translations (
  club_id    uuid not null references public.clubs (id),
  locale     text not null,
  name       text not null,
  short_name text not null,
  primary key (club_id, locale)
);

create table if not exists public.season_clubs (
  season_id uuid not null references public.seasons (id),
  club_id   uuid not null references public.clubs (id),
  primary key (season_id, club_id)
);

create table if not exists public.players (
  id             uuid primary key,
  competition_id uuid not null references public.competitions (id),
  external_ref   text,
  full_name      text not null,
  unique (competition_id, external_ref)
);

create table if not exists public.player_registrations (
  id                       uuid primary key,
  season_id                uuid not null references public.seasons (id),
  player_id                uuid not null references public.players (id),
  club_id                  uuid not null references public.clubs (id),
  role                     public.player_role not null,
  role_locked              boolean not null default false,
  effective_from_gameweek  integer not null,
  effective_to_gameweek    integer,
  unique (season_id, player_id, effective_from_gameweek)
);

-- ---------------------------------------------------------------------------
-- Calendario, check-point, voti
-- ---------------------------------------------------------------------------

create table if not exists public.gameweeks (
  id          uuid primary key,
  season_id   uuid not null references public.seasons (id),
  number      integer not null check (number >= 1),
  deadline_at timestamptz not null,
  status      public.gameweek_status not null default 'scheduled',
  scored_at   timestamptz,
  unique (season_id, number)
);

do $enum$
begin
  create type public.match_status as enum ('scheduled', 'locked', 'live', 'finished');
exception
  when duplicate_object then null;
end
$enum$;

create table if not exists public.real_matches (
  id            uuid primary key,
  gameweek_id   uuid not null references public.gameweeks (id),
  home_club_id  uuid not null references public.clubs (id),
  away_club_id  uuid not null references public.clubs (id),
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

create table if not exists public.checkpoints (
  id           uuid primary key,
  season_id    uuid not null references public.seasons (id),
  sequence     smallint not null check (sequence between 1 and 3),
  gameweek_id  uuid not null unique references public.gameweeks (id),
  opens_at     timestamptz not null,
  closes_at    timestamptz not null,
  unique (season_id, sequence),
  check (opens_at < closes_at)
);

create table if not exists public.vote_imports (
  id           uuid primary key,
  gameweek_id  uuid not null references public.gameweeks (id),
  source       text not null,
  source_note  text not null default 'Napoli',
  payload_hash text not null,
  imported_at  timestamptz not null default now()
);

create table if not exists public.player_gameweek_stats (
  id                uuid primary key,
  gameweek_id       uuid not null references public.gameweeks (id),
  player_id         uuid not null references public.players (id),
  vote_import_id    uuid not null references public.vote_imports (id) on delete cascade,
  voto              numeric(3,1),
  goals             integer not null default 0,
  assists           integer not null default 0,
  yellow_cards      integer not null default 0,
  red_cards         integer not null default 0,
  penalties_scored  integer not null default 0,
  penalties_missed  integer not null default 0,
  penalties_saved   integer not null default 0,
  own_goals         integer not null default 0,
  goals_conceded    integer not null default 0,
  postponed         boolean not null default false,
  unique (gameweek_id, player_id),
  check (voto is null or voto between 0 and 10)
);

-- ---------------------------------------------------------------------------
-- Squadre, rose, formazioni, punteggi
-- ---------------------------------------------------------------------------

create table if not exists public.fantasy_teams (
  id         uuid primary key,
  user_id    uuid not null references public.profiles (id),
  season_id  uuid not null references public.seasons (id),
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, season_id)
);

create table if not exists public.roster_stints (
  id                       uuid primary key,
  fantasy_team_id          uuid not null references public.fantasy_teams (id),
  player_id                uuid not null references public.players (id),
  active_from_gameweek     integer not null,
  active_until_gameweek    integer,
  check (
    active_until_gameweek is null
    or active_until_gameweek >= active_from_gameweek
  )
);

create table if not exists public.checkpoint_moves (
  id               uuid primary key,
  checkpoint_id    uuid not null references public.checkpoints (id),
  fantasy_team_id  uuid not null references public.fantasy_teams (id),
  player_out_id    uuid not null references public.players (id),
  player_in_id     uuid not null references public.players (id),
  created_at       timestamptz not null default now(),
  check (player_out_id <> player_in_id)
);

create table if not exists public.lineups (
  id               uuid primary key,
  fantasy_team_id  uuid not null references public.fantasy_teams (id),
  gameweek_id      uuid not null references public.gameweeks (id),
  status           public.lineup_status not null default 'draft',
  locked_at        timestamptz,
  saved_at         timestamptz,
  unique (fantasy_team_id, gameweek_id)
);

create table if not exists public.lineup_slots (
  lineup_id        uuid not null references public.lineups (id) on delete cascade,
  player_id        uuid not null references public.players (id),
  is_captain       boolean not null default false,
  is_vice_captain  boolean not null default false,
  is_starter       boolean not null default true,
  slot_order       integer not null default 0,
  primary key (lineup_id, player_id),
  check (not (is_captain and is_vice_captain)),
  check (is_starter or (not is_captain and not is_vice_captain))
);

create table if not exists public.team_gameweek_scores (
  fantasy_team_id     uuid not null references public.fantasy_teams (id),
  gameweek_id         uuid not null references public.gameweeks (id),
  ruleset_id          uuid not null references public.rulesets (id),
  players_points      numeric(6,2) not null,
  captain_modifier    numeric(4,2) not null,
  captain_player_id   uuid references public.players (id),
  fair_play           numeric(4,2) not null,
  defense_modifier    numeric(4,2) not null,
  defense_average     numeric(4,2),
  reserve_points      numeric(4,2) not null,
  total               numeric(6,2) not null,
  provisional_total   numeric(6,2),
  rated_players_count integer not null default 0,
  on_pitch_count      integer not null default 0,
  is_live             boolean not null default false,
  calculated_at       timestamptz not null default now(),
  primary key (fantasy_team_id, gameweek_id)
);

create table if not exists public.lineup_player_scores (
  fantasy_team_id      uuid not null,
  gameweek_id          uuid not null,
  player_id            uuid not null references public.players (id),
  voto                 numeric(3,1),
  bonus_points         numeric(5,2) not null,
  malus_points         numeric(5,2) not null,
  malus_factor         numeric(2,1) not null,
  player_points        numeric(5,2),
  is_effective_captain boolean not null,
  primary key (fantasy_team_id, gameweek_id, player_id),
  foreign key (fantasy_team_id, gameweek_id)
    references public.team_gameweek_scores (fantasy_team_id, gameweek_id)
    on delete cascade
);

-- ---------------------------------------------------------------------------
-- Gruppi privati e traduzioni dei bonus
-- ---------------------------------------------------------------------------

create table if not exists public.private_leagues (
  id              uuid primary key,
  season_id       uuid not null references public.seasons (id),
  owner_user_id   uuid not null references public.profiles (id),
  name            text not null,
  join_code       text not null unique,
  start_matchday  integer not null default 1,
  end_matchday    integer not null default 38,
  check (start_matchday >= 1),
  check (end_matchday >= start_matchday),
  settings        jsonb not null default '{}'::jsonb
);

create table if not exists public.private_league_members (
  private_league_id uuid not null references public.private_leagues (id),
  fantasy_team_id   uuid not null references public.fantasy_teams (id),
  primary key (private_league_id, fantasy_team_id)
);

create table if not exists public.bonus_type_translations (
  code    text not null,
  locale  text not null,
  label   text not null,
  primary key (code, locale)
);
