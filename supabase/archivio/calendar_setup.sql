-- Fantaventi — calendario di stagione
-- Eseguire nell'editor SQL di Supabase dopo schema.sql.
--
-- 1. generate_season_calendar crea i turni della stagione (38 se non si indica p_rounds).
-- 2. gameweek_overrides conserva deadline e stato impostati a mano.
-- 3. calendar_sync_runs + record_fixture_sync / apply_calendar_sync sono
--    il contratto dell'endpoint supabase/functions/sync-fixtures.
--
-- La deadline di una giornata è un minuto prima del primo calcio d'inizio.
-- Una giornata non più "scheduled", o con deadline manuale, non viene ricalcolata.

create extension if not exists pgcrypto;

do $enum$
begin
  create type public.calendar_save_mode as enum ('manual', 'automatic');
exception
  when duplicate_object then null;
end
$enum$;

-- ---------------------------------------------------------------------------
-- Deadline
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Override manuali di deadline e stato
-- ---------------------------------------------------------------------------

create table if not exists public.gameweek_overrides (
  gameweek_id  uuid primary key references public.gameweeks (id) on delete cascade,
  deadline_at  timestamptz,
  status       public.gameweek_status,
  note         text,
  updated_at   timestamptz not null default now(),
  check (deadline_at is not null or status is not null)
);

create or replace view public.gameweeks_with_overrides
with (security_invoker = true) as
select
  g.id,
  g.season_id,
  g.number,
  g.deadline_at as base_deadline_at,
  g.status as base_status,
  o.deadline_at as override_deadline_at,
  o.status as override_status,
  coalesce(o.deadline_at, g.deadline_at) as effective_deadline_at,
  coalesce(o.status, g.status) as effective_status,
  o.note as override_note,
  o.updated_at as override_updated_at
from public.gameweeks g
left join public.gameweek_overrides o on o.gameweek_id = g.id;

create or replace function public.set_gameweek_override(
  p_gameweek_id uuid,
  p_deadline_at timestamptz default null,
  p_status public.gameweek_status default null,
  p_note text default null,
  p_force boolean default false
)
returns public.gameweeks_with_overrides
language plpgsql
set search_path = public
as $$
declare
  v_status public.gameweek_status;
  v_row public.gameweeks_with_overrides;
begin
  if p_gameweek_id is null then
    raise exception 'Identificativo giornata mancante.'
      using errcode = '22004';
  end if;

  if p_deadline_at is null and p_status is null then
    raise exception 'Specificare una deadline, uno stato, o entrambi.'
      using errcode = '22023';
  end if;

  select g.status
    into v_status
  from public.gameweeks g
  where g.id = p_gameweek_id
  for update;

  if not found then
    raise exception 'Giornata non trovata: %.', p_gameweek_id
      using errcode = 'P0002';
  end if;

  if v_status = 'final' and not coalesce(p_force, false) then
    raise exception
      'La giornata è final. Per modificarla serve set_gameweek_override(..., p_force => true).'
      using errcode = '23514';
  end if;

  insert into public.gameweek_overrides (gameweek_id, deadline_at, status, note)
  values (p_gameweek_id, p_deadline_at, p_status, p_note)
  on conflict (gameweek_id) do update
  set
    deadline_at = coalesce(excluded.deadline_at, public.gameweek_overrides.deadline_at),
    status = coalesce(excluded.status, public.gameweek_overrides.status),
    note = coalesce(excluded.note, public.gameweek_overrides.note),
    updated_at = now();

  update public.gameweeks g
  set
    deadline_at = coalesce(p_deadline_at, g.deadline_at),
    status = coalesce(p_status, g.status)
  where g.id = p_gameweek_id;

  select *
    into v_row
  from public.gameweeks_with_overrides
  where id = p_gameweek_id;

  return v_row;
end;
$$;

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
