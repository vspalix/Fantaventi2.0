-- Fantaventi — competizioni multiple.
-- Esegui nell'editor SQL di Supabase, dopo schema.sql, league_hub.sql e calendar_setup.sql.
-- Non cancella calciatori, rose o partite.
--
-- 1. players.external_ref è unico insieme a competition_id.
-- 2. Il range di lega e le giornate esterne non sono più bloccati a 38.
-- 3. generate_season_calendar accetta il numero di turni (default 38).
-- 4. apply_calendar_sync accetta qualsiasi numero di giornata >= 1.

alter table public.players
  add column if not exists competition_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_competition_id_fkey'
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
    raise exception 'Restano calciatori senza competizione. Assegna players.competition_id e riesegui.';
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
    select 1
    from pg_constraint
    where conname = 'external_fixtures_gameweek_number_check'
  ) then
    alter table public.external_fixtures
      add constraint external_fixtures_gameweek_number_check
      check (gameweek_number >= 1);
  end if;
end $$;

-- Le funzioni aggiornate sono quelle di calendar_setup.sql, rieseguite qui sotto.
-- ---------------------------------------------------------------------------
-- Generazione dei turni. p_rounds ha default 38 così la chiamata a due argomenti resta valida.
-- p_start_date è il primo calcio d'inizio della giornata 1.
-- Le giornate successive cadono a intervalli di 7 giorni.
-- ---------------------------------------------------------------------------

drop function if exists public.generate_season_calendar(uuid, timestamptz);
drop function if exists public.generate_season_calendar(uuid, timestamptz, integer);

create or replace function public.generate_season_calendar(
  p_season_id uuid,
  p_start_date timestamptz,
  p_rounds integer default 38
)
returns setof public.gameweeks
language plpgsql
set search_path = public, extensions
as $$
begin
  if p_season_id is null then
    raise exception 'Identificativo stagione mancante.'
      using errcode = '22004';
  end if;

  if p_start_date is null then
    raise exception 'Data di inizio calendario mancante.'
      using errcode = '22023';
  end if;

  if p_rounds is null or p_rounds < 1 then
    raise exception 'Il numero di turni deve essere almeno 1.'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.seasons s where s.id = p_season_id) then
    raise exception 'Stagione non trovata: %.', p_season_id
      using errcode = 'P0002';
  end if;

  insert into public.gameweeks (id, season_id, number, deadline_at, status)
  select
    gen_random_uuid(),
    p_season_id,
    gs.gameweek_number,
    public.gameweek_deadline_from_kickoff(
      p_start_date + (gs.gameweek_number - 1) * interval '7 days'
    ),
    'scheduled'::public.gameweek_status
  from generate_series(1, p_rounds) as gs(gameweek_number)
  on conflict (season_id, number) do update
  set deadline_at = excluded.deadline_at
  where gameweeks.status = 'scheduled'::public.gameweek_status
    and not exists (
      select 1
      from public.gameweek_overrides o
      where o.gameweek_id = gameweeks.id
        and o.deadline_at is not null
    );

  return query
  select g.*
  from public.gameweeks g
  where g.season_id = p_season_id
  order by g.number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sincronizzazione date (provider esterno simulato)
-- save_mode = automatic  -> scrive partite e ricalcola le deadline subito
-- save_mode = manual     -> conserva il payload; le deadline cambiano solo
--                            con apply_calendar_sync
--
-- Payload:
-- {
--   "simulated": true,
--   "rounds": [
--     {
--       "number": 1,
--       "first_kickoff": "2026-08-22T16:00:00Z",
--       "fixtures": [
--         {
--           "external_ref": "sim-gw1",
--           "home_club_code": "inter",
--           "away_club_code": "como",
--           "kickoff_at": "2026-08-22T16:00:00Z"
--         }
--       ]
--     }
--   ]
-- }
-- first_kickoff è facoltativo se fixtures contiene kickoff_at.
-- ---------------------------------------------------------------------------

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

create or replace function public.apply_calendar_sync(
  p_run_id uuid
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_season_id uuid;
  v_save_mode public.calendar_save_mode;
  v_status text;
  v_payload jsonb;
  v_provider text;
  v_invalid text;
  v_missing text;
  v_updated int;
begin
  if p_run_id is null then
    raise exception 'Identificativo sincronizzazione mancante.'
      using errcode = '22004';
  end if;

  select r.season_id, r.save_mode, r.status, r.payload, r.provider
    into v_season_id, v_save_mode, v_status, v_payload, v_provider
  from public.calendar_sync_runs r
  where r.id = p_run_id
  for update;

  if not found then
    raise exception 'Sincronizzazione non trovata: %.', p_run_id
      using errcode = 'P0002';
  end if;

  if v_status = 'applied' then
    raise exception 'Sincronizzazione già applicata: %.', p_run_id
      using errcode = '23514';
  end if;

  if jsonb_typeof(v_payload -> 'rounds') <> 'array' then
    raise exception 'Payload senza l''array rounds.'
      using errcode = '22023';
  end if;

  with rounds as (
    select
      (round_item ->> 'number')::int as gameweek_number,
      coalesce(
        (round_item ->> 'first_kickoff')::timestamptz,
        (
          select min((fixture_item ->> 'kickoff_at')::timestamptz)
          from jsonb_array_elements(coalesce(round_item -> 'fixtures', '[]'::jsonb)) as fixture_item
        )
      ) as first_kickoff
    from jsonb_array_elements(v_payload -> 'rounds') as round_item
  )
  select string_agg(
    coalesce(rounds.gameweek_number::text, '?'),
    ', '
    order by rounds.gameweek_number
  )
    into v_invalid
  from rounds
  where rounds.gameweek_number is null
     or rounds.gameweek_number < 1
     or rounds.first_kickoff is null;

  if v_invalid is not null then
    raise exception
      'Giornate non utilizzabili (numero assente o calcio d''inizio assente): %.',
      v_invalid
      using errcode = '22023';
  end if;

  with rounds as (
    select distinct (round_item ->> 'number')::int as gameweek_number
    from jsonb_array_elements(v_payload -> 'rounds') as round_item
  )
  select string_agg(rounds.gameweek_number::text, ', ' order by rounds.gameweek_number)
    into v_missing
  from rounds
  left join public.gameweeks g
    on g.season_id = v_season_id
   and g.number = rounds.gameweek_number
  where g.id is null;

  if v_missing is not null then
    raise exception
      'Giornate assenti per la stagione. Eseguire generate_season_calendar prima della sincronizzazione. Mancano: %.',
      v_missing
      using errcode = 'P0002';
  end if;

  insert into public.external_fixtures (
    season_id,
    gameweek_number,
    external_ref,
    home_club_code,
    away_club_code,
    kickoff_at,
    save_mode,
    sync_run_id
  )
  select
    v_season_id,
    (round_item ->> 'number')::int,
    fixture_item ->> 'external_ref',
    fixture_item ->> 'home_club_code',
    fixture_item ->> 'away_club_code',
    (fixture_item ->> 'kickoff_at')::timestamptz,
    v_save_mode,
    p_run_id
  from jsonb_array_elements(v_payload -> 'rounds') as round_item
  cross join lateral jsonb_array_elements(
    coalesce(round_item -> 'fixtures', '[]'::jsonb)
  ) as fixture_item
  where coalesce(fixture_item ->> 'external_ref', '') <> ''
    and (fixture_item ->> 'kickoff_at') is not null
  on conflict (season_id, external_ref) do update
  set
    gameweek_number = excluded.gameweek_number,
    home_club_code = excluded.home_club_code,
    away_club_code = excluded.away_club_code,
    kickoff_at = excluded.kickoff_at,
    save_mode = excluded.save_mode,
    sync_run_id = excluded.sync_run_id;

  with rounds as (
    select
      (round_item ->> 'number')::int as gameweek_number,
      coalesce(
        (round_item ->> 'first_kickoff')::timestamptz,
        (
          select min((fixture_item ->> 'kickoff_at')::timestamptz)
          from jsonb_array_elements(coalesce(round_item -> 'fixtures', '[]'::jsonb)) as fixture_item
        )
      ) as first_kickoff
    from jsonb_array_elements(v_payload -> 'rounds') as round_item
  ),
  updated as (
    update public.gameweeks g
    set deadline_at = public.gameweek_deadline_from_kickoff(rounds.first_kickoff)
    from rounds
    where g.season_id = v_season_id
      and g.number = rounds.gameweek_number
      and g.status = 'scheduled'::public.gameweek_status
      and not exists (
        select 1
        from public.gameweek_overrides o
        where o.gameweek_id = g.id
          and o.deadline_at is not null
      )
    returning g.id
  )
  select count(*) into v_updated from updated;

  update public.calendar_sync_runs
  set
    status = 'applied',
    applied_at = now()
  where id = p_run_id;

  return jsonb_build_object(
    'id', p_run_id,
    'provider', v_provider,
    'save_mode', v_save_mode,
    'status', 'applied',
    'updated_gameweeks', v_updated
  );
end;
$$;

create or replace function public.record_fixture_sync(
  p_season_id uuid,
  p_save_mode public.calendar_save_mode,
  p_payload jsonb,
  p_provider text default 'api_football'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
begin
  if p_season_id is null then
    raise exception 'Identificativo stagione mancante.'
      using errcode = '22004';
  end if;

  if p_save_mode is null then
    raise exception 'save_mode mancante: usare manual oppure automatic.'
      using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload -> 'rounds') <> 'array' then
    raise exception 'Payload senza l''array rounds.'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.seasons s where s.id = p_season_id) then
    raise exception 'Stagione non trovata: %.', p_season_id
      using errcode = 'P0002';
  end if;

  insert into public.calendar_sync_runs (season_id, provider, save_mode, payload)
  values (
    p_season_id,
    coalesce(nullif(btrim(p_provider), ''), 'api_football'),
    p_save_mode,
    p_payload
  )
  returning id into v_run_id;

  if p_save_mode = 'automatic' then
    return public.apply_calendar_sync(v_run_id);
  end if;

  return jsonb_build_object(
    'id', v_run_id,
    'provider', coalesce(nullif(btrim(p_provider), ''), 'api_football'),
    'save_mode', p_save_mode,
    'status', 'stored',
    'updated_gameweeks', 0
  );
end;
$$;

revoke all on function public.gameweek_deadline_from_kickoff(timestamptz) from public;
revoke all on function public.set_gameweek_override(uuid, timestamptz, public.gameweek_status, text, boolean) from public;
revoke all on function public.generate_season_calendar(uuid, timestamptz, integer) from public;
revoke all on function public.apply_calendar_sync(uuid) from public;
revoke all on function public.record_fixture_sync(uuid, public.calendar_save_mode, jsonb, text) from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gameweek_deadline_from_kickoff(timestamptz) to service_role;
    grant execute on function public.set_gameweek_override(uuid, timestamptz, public.gameweek_status, text, boolean) to service_role;
    grant execute on function public.generate_season_calendar(uuid, timestamptz, integer) to service_role;
    grant execute on function public.apply_calendar_sync(uuid) to service_role;
    grant execute on function public.record_fixture_sync(uuid, public.calendar_save_mode, jsonb, text) to service_role;
  end if;
end
$grants$;
