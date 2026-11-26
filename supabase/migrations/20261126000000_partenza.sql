-- FantaVenti: file di partenza del database (passo 4, 26/11/2026).
--
-- Ricavato in sola lettura dal database online del 26/11/2026 con pg_dump 17
-- (Postgres 17.11 su Supabase). Contiene:
--   1. struttura dello schema public: tabelle, viste, tipi, funzioni, trigger, indici, vincoli;
--   2. permessi: regole RLS, GRANT per anon, authenticated e service_role;
--   3. bucket "brand-assets" e la sua regola di lettura;
--   4. dati iniziali indispensabili: regolamento, competizione, stagione, 20 club,
--      impostazioni e testi delle notifiche. Nessun utente, squadra, lega, voto o segreto.
--
-- SERVE SOLO PER UN DATABASE SUPABASE NUOVO E VUOTO. Se trova già le tabelle si ferma
-- senza cambiare niente: non va mai eseguito sul database del sito.
-- Tutto il file è un'unica transazione: o va a buon fine per intero, o non resta niente.
--
-- Non contiene (si ricaricano dal pannello admin): calendario e giornate, listone
-- (calciatori e ruoli), partite reali, indisponibili, voti. Le modifiche future vanno
-- in nuovi file di questa cartella, numerati per data: vedi supabase/README.md.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL OR to_regclass('public.seasons') IS NOT NULL THEN
    RAISE EXCEPTION 'Database già creato: questo file vale solo per un database nuovo. Nessuna modifica fatta.';
  END IF;
END
$guard$;

-- Estensioni usate dalle funzioni (su Supabase ci sono già: qui per sicurezza).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ===========================================================================
-- 1-2. Struttura e permessi dello schema public
-- ===========================================================================
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

--
-- Name: calendar_save_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.calendar_save_mode AS ENUM (
    'manual',
    'automatic'
);

--
-- Name: gameweek_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gameweek_status AS ENUM (
    'scheduled',
    'open',
    'locked',
    'scored',
    'final'
);

--
-- Name: lineup_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lineup_status AS ENUM (
    'draft',
    'locked'
);

--
-- Name: match_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.match_status AS ENUM (
    'scheduled',
    'locked',
    'live',
    'finished'
);

--
-- Name: player_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.player_role AS ENUM (
    'GK',
    'DEF',
    'MID',
    'FWD'
);

--
-- Name: season_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.season_status AS ENUM (
    'draft',
    'open',
    'running',
    'closed'
);

--
-- Name: apply_calendar_sync(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_calendar_sync(p_run_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: team_gameweek_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_gameweek_scores (
    fantasy_team_id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    ruleset_id uuid NOT NULL,
    players_points numeric(6,2) NOT NULL,
    captain_modifier numeric(4,2) NOT NULL,
    captain_player_id uuid,
    fair_play numeric(4,2) NOT NULL,
    defense_modifier numeric(4,2) NOT NULL,
    defense_average numeric(4,2),
    reserve_points numeric(4,2) NOT NULL,
    total numeric(6,2) NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    provisional_total numeric(6,2),
    rated_players_count integer DEFAULT 0 NOT NULL,
    on_pitch_count integer DEFAULT 0 NOT NULL,
    is_live boolean DEFAULT false NOT NULL
);

--
-- Name: calculate_gameweek_scores(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_gameweek_scores(p_gameweek_id uuid) RETURNS SETOF public.team_gameweek_scores
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_season_id uuid;
  v_number int;
  v_status public.gameweek_status;
  v_ruleset_id uuid;
  v_definition jsonb;
  v_goal numeric;
  v_assist numeric;
  v_penalty_scored numeric;
  v_penalty_saved numeric;
  v_yellow numeric;
  v_red numeric;
  v_penalty_missed numeric;
  v_own_goal numeric;
  v_goal_conceded numeric;
  v_double boolean;
  v_fair numeric;
  v_empty numeric;
  v_lineup_size int;
  v_basis text;
  v_outside text;
  v_bad_captain text;
begin
  if p_gameweek_id is null then
    raise exception 'Identificativo giornata mancante.'
      using errcode = '22004';
  end if;

  select g.season_id, g.number, g.status, s.ruleset_id, r.definition
    into v_season_id, v_number, v_status, v_ruleset_id, v_definition
  from public.gameweeks g
  join public.seasons s on s.id = g.season_id
  join public.rulesets r on r.id = s.ruleset_id
  where g.id = p_gameweek_id;

  if not found then
    raise exception 'Giornata non trovata: %.', p_gameweek_id
      using errcode = 'P0002';
  end if;

  if v_status = 'final' then
    raise exception 'La giornata % è final e i punteggi non si ricalcolano.', v_number
      using errcode = '23514';
  end if;

  if v_definition -> 'bonus_malus' is null then
    raise exception 'Ruleset senza bonus_malus.'
      using errcode = '23514';
  end if;

  v_goal := coalesce((v_definition -> 'bonus_malus' ->> 'goal')::numeric, 0);
  v_assist := coalesce((v_definition -> 'bonus_malus' ->> 'assist')::numeric, 0);
  v_penalty_scored := coalesce((v_definition -> 'bonus_malus' ->> 'penalty_scored')::numeric, 0);
  v_penalty_saved := coalesce((v_definition -> 'bonus_malus' ->> 'penalty_saved')::numeric, 0);
  v_yellow := (v_definition -> 'bonus_malus' ->> 'yellow_card')::numeric;
  v_red := (v_definition -> 'bonus_malus' ->> 'red_card')::numeric;
  v_penalty_missed := coalesce((v_definition -> 'bonus_malus' ->> 'penalty_missed')::numeric, 0);
  v_own_goal := coalesce((v_definition -> 'bonus_malus' ->> 'own_goal')::numeric, 0);
  v_goal_conceded := coalesce((v_definition -> 'bonus_malus' ->> 'goal_conceded')::numeric, 0);
  v_double := coalesce((v_definition ->> 'double_captain_malus')::boolean, true);
  v_fair := coalesce((v_definition -> 'fair_play' ->> 'points')::numeric, 0);
  v_empty := coalesce((v_definition ->> 'empty_slot_points')::numeric, 0);
  v_lineup_size := coalesce((v_definition ->> 'lineup_size')::int, 11);
  v_basis := coalesce(v_definition -> 'defense_modifier' ->> 'basis', 'voto');

  if v_yellow is null or v_red is null then
    raise exception 'Ruleset senza il valore di yellow_card o red_card.'
      using errcode = '23514';
  end if;

  select string_agg(ft.name || ': ' || p.full_name, ', ' order by ft.name, p.full_name)
    into v_outside
  from public.lineups l
  join public.lineup_slots ls on ls.lineup_id = l.id
  join public.fantasy_teams ft on ft.id = l.fantasy_team_id
  join public.players p on p.id = ls.player_id
  where l.gameweek_id = p_gameweek_id
    and ft.season_id = v_season_id
    and not exists (
      select 1
      from public.roster_stints rs
      where rs.fantasy_team_id = l.fantasy_team_id
        and rs.player_id = ls.player_id
        and rs.active_from_gameweek <= v_number
        and (
          rs.active_until_gameweek is null
          or rs.active_until_gameweek >= v_number
        )
    );

  if v_outside is not null then
    raise exception 'Formazioni con calciatori fuori rosa: %.', v_outside
      using errcode = '23514';
  end if;

  drop table if exists pg_temp._fv_xi;
  create temp table pg_temp._fv_xi (
    fantasy_team_id uuid not null,
    player_id uuid not null,
    role public.player_role not null,
    is_starter boolean not null,
    is_substitute boolean not null,
    is_captain boolean not null,
    is_vice_captain boolean not null,
    is_effective_captain boolean not null default false,
    voto numeric(3,1),
    bonus_points numeric(8,2) not null,
    malus_points numeric(8,2) not null,
    malus_factor numeric(2,1) not null default 1,
    player_points numeric(8,2),
    yellow_cards integer not null default 0,
    primary key (fantasy_team_id, player_id)
  ) on commit drop;

  insert into pg_temp._fv_xi (
    fantasy_team_id,
    player_id,
    role,
    is_starter,
    is_substitute,
    is_captain,
    is_vice_captain,
    voto,
    bonus_points,
    malus_points,
    yellow_cards
  )
  with roster as (
    select distinct on (ft.id, rs.player_id)
      ft.id as fantasy_team_id,
      rs.player_id,
      pr.role
    from public.fantasy_teams ft
    join public.roster_stints rs
      on rs.fantasy_team_id = ft.id
     and rs.active_from_gameweek <= v_number
     and (
       rs.active_until_gameweek is null
       or rs.active_until_gameweek >= v_number
     )
    join public.player_registrations pr
      on pr.season_id = ft.season_id
     and pr.player_id = rs.player_id
     and pr.effective_from_gameweek <= v_number
     and (
       pr.effective_to_gameweek is null
       or pr.effective_to_gameweek >= v_number
     )
    where ft.season_id = v_season_id
    order by ft.id, rs.player_id, pr.effective_from_gameweek desc
  ),
  starters as (
    select
      l.fantasy_team_id,
      ls.player_id,
      ls.is_captain,
      ls.is_vice_captain,
      roster.role
    from public.lineups l
    join public.lineup_slots ls on ls.lineup_id = l.id
    join roster
      on roster.fantasy_team_id = l.fantasy_team_id
     and roster.player_id = ls.player_id
    where l.gameweek_id = p_gameweek_id
  ),
  stats as (
    select *
    from public.player_gameweek_stats
    where gameweek_id = p_gameweek_id
      and voto is not null
  ),
  holes as (
    select
      starters.fantasy_team_id,
      starters.player_id,
      starters.role,
      row_number() over (
        partition by starters.fantasy_team_id, starters.role
        order by starters.player_id
      ) as hole_rn
    from starters
    where not exists (
      select 1
      from stats
      where stats.player_id = starters.player_id
    )
  ),
  bench as (
    select
      roster.fantasy_team_id,
      roster.player_id,
      roster.role,
      row_number() over (
        partition by roster.fantasy_team_id, roster.role
        order by stats.voto desc, roster.player_id
      ) as bench_rn
    from roster
    join stats on stats.player_id = roster.player_id
    where not exists (
      select 1
      from starters
      where starters.fantasy_team_id = roster.fantasy_team_id
        and starters.player_id = roster.player_id
    )
  ),
  subs as (
    select
      holes.fantasy_team_id,
      bench.player_id,
      bench.role
    from holes
    join bench
      on bench.fantasy_team_id = holes.fantasy_team_id
     and bench.role = holes.role
     and bench.bench_rn = holes.hole_rn
  ),
  xi as (
    select
      starters.fantasy_team_id,
      starters.player_id,
      starters.role,
      true as is_starter,
      false as is_substitute,
      starters.is_captain,
      starters.is_vice_captain
    from starters
    union all
    select
      subs.fantasy_team_id,
      subs.player_id,
      subs.role,
      false,
      true,
      false,
      false
    from subs
  )
  select
    xi.fantasy_team_id,
    xi.player_id,
    xi.role,
    xi.is_starter,
    xi.is_substitute,
    xi.is_captain,
    xi.is_vice_captain,
    stats.voto,
    coalesce(stats.goals, 0) * v_goal
      + coalesce(stats.assists, 0) * v_assist
      + coalesce(stats.penalties_scored, 0) * v_penalty_scored
      + coalesce(stats.penalties_saved, 0) * v_penalty_saved,
    coalesce(stats.yellow_cards, 0) * v_yellow
      + coalesce(stats.red_cards, 0) * v_red
      + coalesce(stats.penalties_missed, 0) * v_penalty_missed
      + coalesce(stats.own_goals, 0) * v_own_goal
      + case
          when xi.role = 'GK' then coalesce(stats.goals_conceded, 0) * v_goal_conceded
          else 0
        end,
    coalesce(stats.yellow_cards, 0)
  from xi
  left join stats on stats.player_id = xi.player_id;

  update pg_temp._fv_xi as xi
  set is_effective_captain = true
  from (
    select distinct on (candidates.fantasy_team_id)
      candidates.fantasy_team_id,
      candidates.player_id
    from (
      select fantasy_team_id, player_id, 1 as priority
      from pg_temp._fv_xi
      where is_captain
        and not is_substitute
        and voto is not null
      union all
      select fantasy_team_id, player_id, 2
      from pg_temp._fv_xi
      where is_vice_captain
        and not is_substitute
        and voto is not null
    ) as candidates
    order by candidates.fantasy_team_id, candidates.priority
  ) as chosen
  where xi.fantasy_team_id = chosen.fantasy_team_id
    and xi.player_id = chosen.player_id;

  update pg_temp._fv_xi
  set
    malus_factor = case
      when is_effective_captain and v_double then 2
      else 1
    end,
    player_points = case
      when voto is null then null
      else voto + bonus_points + malus_points * case
        when is_effective_captain and v_double then 2
        else 1
      end
    end;

  select string_agg(
    ft.name || ' (voto ' || xi.voto || ')',
    ', '
    order by ft.name
  )
    into v_bad_captain
  from pg_temp._fv_xi xi
  join public.fantasy_teams ft on ft.id = xi.fantasy_team_id
  where xi.is_effective_captain
    and public.captain_modifier_for_vote(v_definition, xi.voto) is null;

  if v_bad_captain is not null then
    raise exception
      'Voto del capitano effettivo fuori dalle fasce del ruleset: %.',
      v_bad_captain
      using errcode = '23514';
  end if;

  delete from public.team_gameweek_scores
  where gameweek_id = p_gameweek_id;

  insert into public.team_gameweek_scores (
    fantasy_team_id,
    gameweek_id,
    ruleset_id,
    players_points,
    captain_modifier,
    captain_player_id,
    fair_play,
    defense_modifier,
    defense_average,
    reserve_points,
    total
  )
  with captain_mods as (
    select
      xi.fantasy_team_id,
      xi.player_id,
      public.captain_modifier_for_vote(v_definition, xi.voto) as points
    from pg_temp._fv_xi xi
    where xi.is_effective_captain
  ),
  ranked_defenders as (
    select
      xi.fantasy_team_id,
      case
        when v_basis = 'fantavoto' then xi.voto + xi.bonus_points + xi.malus_points
        else xi.voto
      end as rating,
      row_number() over (
        partition by xi.fantasy_team_id
        order by
          case
            when v_basis = 'fantavoto' then xi.voto + xi.bonus_points + xi.malus_points
            else xi.voto
          end desc,
          (xi.voto + xi.bonus_points + xi.malus_points) desc,
          xi.player_id
      ) as rn,
      count(*) over (partition by xi.fantasy_team_id) as defender_count
    from pg_temp._fv_xi xi
    where xi.role = 'DEF'
      and xi.voto is not null
  ),
  goalkeepers as (
    select distinct on (xi.fantasy_team_id)
      xi.fantasy_team_id,
      case
        when v_basis = 'fantavoto' then xi.voto + xi.bonus_points + xi.malus_points
        else xi.voto
      end as rating
    from pg_temp._fv_xi xi
    where xi.role = 'GK'
      and xi.voto is not null
    order by
      xi.fantasy_team_id,
      case
        when v_basis = 'fantavoto' then xi.voto + xi.bonus_points + xi.malus_points
        else xi.voto
      end desc,
      xi.player_id
  ),
  defense as (
    select
      goalkeepers.fantasy_team_id,
      (goalkeepers.rating + sum(ranked_defenders.rating)) / 4 as average
    from goalkeepers
    join ranked_defenders
      on ranked_defenders.fantasy_team_id = goalkeepers.fantasy_team_id
     and ranked_defenders.rn <= 3
     and ranked_defenders.defender_count >= 4
    group by goalkeepers.fantasy_team_id, goalkeepers.rating
    having count(*) = 3
  ),
  starter_counts as (
    select l.fantasy_team_id, count(*)::int as starter_count
    from public.lineups l
    join public.lineup_slots ls on ls.lineup_id = l.id
    where l.gameweek_id = p_gameweek_id
    group by l.fantasy_team_id
  )
  select
    ft.id,
    p_gameweek_id,
    v_ruleset_id,
    round(coalesce(sum(xi.player_points) filter (where xi.voto is not null), 0), 2),
    round(coalesce(captain_mods.points, 0), 2),
    captain_mods.player_id,
    round(
      case
        when count(xi.player_id) filter (where xi.voto is not null) > 0
         and count(xi.player_id) filter (where xi.voto is not null and xi.yellow_cards > 0) = 0
        then v_fair
        else 0
      end,
      2
    ),
    round(coalesce(public.defense_modifier_for_average(v_definition, defense.average), 0), 2),
    round(defense.average, 2),
    round(v_empty * greatest(v_lineup_size - coalesce(starter_counts.starter_count, 0), 0), 2),
    round(
      coalesce(sum(xi.player_points) filter (where xi.voto is not null), 0)
      + coalesce(captain_mods.points, 0)
      + case
          when count(xi.player_id) filter (where xi.voto is not null) > 0
           and count(xi.player_id) filter (where xi.voto is not null and xi.yellow_cards > 0) = 0
          then v_fair
          else 0
        end
      + coalesce(public.defense_modifier_for_average(v_definition, defense.average), 0)
      + v_empty * greatest(v_lineup_size - coalesce(starter_counts.starter_count, 0), 0),
      2
    )
  from public.fantasy_teams ft
  left join pg_temp._fv_xi xi on xi.fantasy_team_id = ft.id
  left join captain_mods on captain_mods.fantasy_team_id = ft.id
  left join defense on defense.fantasy_team_id = ft.id
  left join starter_counts on starter_counts.fantasy_team_id = ft.id
  where ft.season_id = v_season_id
  group by
    ft.id,
    captain_mods.points,
    captain_mods.player_id,
    defense.average,
    starter_counts.starter_count;

  insert into public.lineup_player_scores (
    fantasy_team_id,
    gameweek_id,
    player_id,
    voto,
    bonus_points,
    malus_points,
    malus_factor,
    player_points,
    is_effective_captain
  )
  select
    xi.fantasy_team_id,
    p_gameweek_id,
    xi.player_id,
    xi.voto,
    round(xi.bonus_points, 2),
    round(xi.malus_points, 2),
    xi.malus_factor,
    round(xi.player_points, 2),
    xi.is_effective_captain
  from pg_temp._fv_xi xi;

  return query
  select s.*
  from public.team_gameweek_scores s
  where s.gameweek_id = p_gameweek_id
  order by s.total desc, s.fantasy_team_id;
end;
$$;

--
-- Name: can_read_league(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_league(p_league uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.is_super_admin() then
    return true;
  end if;

  if exists (
    select 1
    from public.private_leagues league
    where league.id = p_league
      and league.owner_user_id = auth.uid()
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.private_league_members member
    join public.fantasy_teams team on team.id = member.fantasy_team_id
    where member.private_league_id = p_league
      and team.user_id = auth.uid()
  ) then
    return true;
  end if;

  if to_regclass('public.league_delegates') is not null
     and exists (
       select 1
       from public.league_delegates delegate
       where delegate.league_id = p_league
         and delegate.user_id = auth.uid()
     ) then
    return true;
  end if;

  return false;
end;
$$;

--
-- Name: can_read_team(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_team(p_team uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.fantasy_teams team
      where team.id = p_team
        and team.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.private_league_members mine
      join public.fantasy_teams my_team on my_team.id = mine.fantasy_team_id
      join public.private_league_members theirs on theirs.private_league_id = mine.private_league_id
      where my_team.user_id = auth.uid()
        and theirs.fantasy_team_id = p_team
    )
    or exists (
      select 1
      from public.private_leagues league
      join public.private_league_members member on member.private_league_id = league.id
      where league.owner_user_id = auth.uid()
        and member.fantasy_team_id = p_team
    );
$$;

--
-- Name: captain_modifier_for_vote(jsonb, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.captain_modifier_for_vote(p_definition jsonb, p_voto numeric) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select (band ->> 'points')::numeric
  from jsonb_array_elements(coalesce(p_definition -> 'captain_modifier', '[]'::jsonb)) as band
  where (
      band ? 'eq'
      and p_voto = (band ->> 'eq')::numeric
    )
    or (
      band ? 'max_exclusive'
      and not (band ? 'eq')
      and p_voto < (band ->> 'max_exclusive')::numeric
    )
    or (
      band ? 'min_inclusive'
      and not (band ? 'eq')
      and p_voto >= (band ->> 'min_inclusive')::numeric
    )
  order by
    case when band ? 'eq' then 0 when band ? 'max_exclusive' then 1 else 2 end
  limit 1;
$$;

--
-- Name: defense_modifier_for_average(jsonb, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.defense_modifier_for_average(p_definition jsonb, p_average numeric) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (
      select (band ->> 'points')::numeric
      from jsonb_array_elements(
        coalesce(p_definition -> 'defense_modifier' -> 'bands', '[]'::jsonb)
      ) as band
      where p_average >= (band ->> 'min')::numeric
      order by (band ->> 'min')::numeric desc
      limit 1
    ),
    0
  );
$$;

--
-- Name: gameweek_deadline_from_kickoff(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gameweek_deadline_from_kickoff(p_first_kickoff timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select p_first_kickoff - interval '1 minute';
$$;

--
-- Name: gameweeks_final_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gameweeks_final_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

--
-- Name: gameweeks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gameweeks (
    id uuid NOT NULL,
    season_id uuid NOT NULL,
    number integer NOT NULL,
    deadline_at timestamp with time zone NOT NULL,
    status public.gameweek_status DEFAULT 'scheduled'::public.gameweek_status NOT NULL,
    scored_at timestamp with time zone,
    CONSTRAINT gameweeks_number_check CHECK ((number >= 1))
);

--
-- Name: generate_season_calendar(uuid, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_season_calendar(p_season_id uuid, p_start_date timestamp with time zone, p_rounds integer DEFAULT 38) RETURNS SETOF public.gameweeks
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
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

--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and platform_role = 'super_admin'
  );
$$;

--
-- Name: league_standings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.league_standings(p_league_id uuid) RETURNS TABLE(fantasy_team_id uuid, entry_matchday integer, skipped_count integer, played_count integer, real_points numeric, average_points numeric, entry_points numeric, total_points numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with   league as (
    select
      season_id,
      coalesce(start_matchday, 1) as start_matchday,
      coalesce(end_matchday, 38) as end_matchday
    from public.private_leagues
    where id = p_league_id
  ),
  weeks as (
    select g.id, g.number,
      (
        g.deadline_at <= now()
        or g.status in ('locked', 'scored', 'final')
      ) as closed
    from public.gameweeks g
    join league l on l.season_id = g.season_id
    where g.number between l.start_matchday and l.end_matchday
  ),
  members as (
    select m.fantasy_team_id
    from public.private_league_members m
    where m.private_league_id = p_league_id
  ),
  fielded as (
    select ln.fantasy_team_id, w.number, w.closed, w.id as gameweek_id
    from public.lineups ln
    join weeks w on w.id = ln.gameweek_id
    join members m on m.fantasy_team_id = ln.fantasy_team_id
  ),
  first_entry as (
    select fantasy_team_id, min(number) as entry_matchday
    from fielded
    group by fantasy_team_id
  ),
  scored as (
    select s.fantasy_team_id, w.number, s.total
    from public.team_gameweek_scores s
    join weeks w on w.id = s.gameweek_id
    join members m on m.fantasy_team_id = s.fantasy_team_id
  ),
  calc as (
    select
      m.fantasy_team_id,
      e.entry_matchday,
      case
        when e.entry_matchday is null or e.entry_matchday <= l.start_matchday then 0
        else (
          select count(*)::integer
          from weeks w
          where w.closed
            and w.number < e.entry_matchday
        )
      end as skipped_count,
      case
        when e.entry_matchday is null or e.entry_matchday <= l.start_matchday then (
          select coalesce(sum(coalesce(s.total, 0)), 0)
          from weeks w
          left join scored s
            on s.fantasy_team_id = m.fantasy_team_id
           and s.number = w.number
          where w.closed
        )
        else (
          select coalesce(sum(coalesce(s.total, 0)), 0)
          from fielded f
          left join scored s
            on s.fantasy_team_id = f.fantasy_team_id
           and s.number = f.number
          where f.fantasy_team_id = m.fantasy_team_id
            and f.closed
            and f.number >= e.entry_matchday
        )
      end as real_points,
      case
        when e.entry_matchday is null or e.entry_matchday <= l.start_matchday then (
          select count(*)::integer from weeks w where w.closed
        )
        else (
          select count(*)::integer
          from fielded f
          where f.fantasy_team_id = m.fantasy_team_id
            and f.closed
            and f.number >= e.entry_matchday
        )
      end as played_count
    from members m
    cross join league l
    left join first_entry e on e.fantasy_team_id = m.fantasy_team_id
  )
  select
    c.fantasy_team_id,
    c.entry_matchday,
    c.skipped_count,
    c.played_count,
    round(c.real_points, 2) as real_points,
    case
      when c.skipped_count > 0 then (
        select round(coalesce(avg(coalesce(s.total, 0)), 0), 2)
        from weeks w
        cross join members other
        left join scored s
          on s.fantasy_team_id = other.fantasy_team_id
         and s.number = w.number
        where w.closed
          and w.number < c.entry_matchday
      )
      when c.played_count = 0 then null
      else round(c.real_points / c.played_count, 2)
    end as average_points,
    case
      when c.skipped_count = 0 then 0
      else round((
        select coalesce(avg(coalesce(s.total, 0)), 0)
        from weeks w
        cross join members other
        left join scored s
          on s.fantasy_team_id = other.fantasy_team_id
         and s.number = w.number
        where w.closed
          and w.number < c.entry_matchday
      ) * c.skipped_count, 2)
    end as entry_points,
    case
      when c.skipped_count = 0 then round(c.real_points, 2)
      else round(c.real_points + (
        select coalesce(avg(coalesce(s.total, 0)), 0)
        from weeks w
        cross join members other
        left join scored s
          on s.fantasy_team_id = other.fantasy_team_id
         and s.number = w.number
        where w.closed
          and w.number < c.entry_matchday
      ) * c.skipped_count, 2)
    end as total_points
  from calc c;
$$;

--
-- Name: lock_fantasy_team_for_lineup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_fantasy_team_for_lineup() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform 1
  from public.fantasy_teams
  where id = new.fantasy_team_id
  for update;
  return new;
end;
$$;

--
-- Name: record_fixture_sync(uuid, public.calendar_save_mode, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_fixture_sync(p_season_id uuid, p_save_mode public.calendar_save_mode, p_payload jsonb, p_provider text DEFAULT 'api_football'::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
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

--
-- Name: gameweek_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gameweek_overrides (
    gameweek_id uuid NOT NULL,
    deadline_at timestamp with time zone,
    status public.gameweek_status,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gameweek_overrides_check CHECK (((deadline_at IS NOT NULL) OR (status IS NOT NULL)))
);

--
-- Name: gameweeks_with_overrides; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gameweeks_with_overrides WITH (security_invoker='true') AS
 SELECT g.id,
    g.season_id,
    g.number,
    g.deadline_at AS base_deadline_at,
    g.status AS base_status,
    o.deadline_at AS override_deadline_at,
    o.status AS override_status,
    COALESCE(o.deadline_at, g.deadline_at) AS effective_deadline_at,
    COALESCE(o.status, g.status) AS effective_status,
    o.note AS override_note,
    o.updated_at AS override_updated_at
   FROM (public.gameweeks g
     LEFT JOIN public.gameweek_overrides o ON ((o.gameweek_id = g.id)));

--
-- Name: set_gameweek_override(uuid, timestamp with time zone, public.gameweek_status, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_gameweek_override(p_gameweek_id uuid, p_deadline_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_status public.gameweek_status DEFAULT NULL::public.gameweek_status, p_note text DEFAULT NULL::text, p_force boolean DEFAULT false) RETURNS public.gameweeks_with_overrides
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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

--
-- Name: submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_lineup(p_fantasy_team_id uuid, p_gameweek_id uuid, p_player_ids uuid[], p_captain_id uuid, p_vice_captain_id uuid, p_bench_ids uuid[] DEFAULT '{}'::uuid[]) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_season_id uuid;
  v_team_season_id uuid;
  v_number int;
  v_status public.gameweek_status;
  v_deadline timestamptz;
  v_lineup_id uuid;
  v_count int;
  v_gk int;
  v_def int;
  v_mid int;
  v_fwd int;
  v_missing text;
begin
  if p_fantasy_team_id is null or p_gameweek_id is null then
    raise exception 'Squadra e giornata sono obbligatorie.'
      using errcode = '22004';
  end if;

  if p_player_ids is null or cardinality(p_player_ids) = 0 then
    raise exception 'La formazione non contiene titolari.'
      using errcode = '22023';
  end if;

  if exists (select 1 from unnest(p_player_ids) as player_id where player_id is null) then
    raise exception 'La formazione contiene un calciatore nullo.'
      using errcode = '22023';
  end if;

  select count(*) - count(distinct player_id)
    into v_count
  from unnest(p_player_ids) as player_id;

  if v_count > 0 then
    raise exception 'La formazione contiene calciatori ripetuti.'
      using errcode = '22023';
  end if;

  v_count := cardinality(p_player_ids);

  if v_count > 11 then
    raise exception 'I titolari sono %; il massimo è 11.', v_count
      using errcode = '23514';
  end if;

  if p_captain_id is null or not (p_player_ids @> array[p_captain_id]) then
    raise exception 'Il capitano deve essere uno dei titolari.'
      using errcode = '23514';
  end if;

  if v_count = 1 then
    if p_vice_captain_id is not null then
      raise exception 'Con un solo titolare il vice non va indicato.'
        using errcode = '23514';
    end if;
  elsif p_vice_captain_id is null
     or p_vice_captain_id = p_captain_id
     or not (p_player_ids @> array[p_vice_captain_id]) then
    raise exception 'Il vice deve essere un titolare diverso dal capitano.'
      using errcode = '23514';
  end if;

  select g.season_id, g.number, g.status, g.deadline_at, ft.season_id
    into v_season_id, v_number, v_status, v_deadline, v_team_season_id
  from public.gameweeks g
  join public.fantasy_teams ft on ft.id = p_fantasy_team_id
  where g.id = p_gameweek_id;

  if not found then
    raise exception 'Squadra o giornata inesistente.'
      using errcode = 'P0002';
  end if;

  if v_team_season_id <> v_season_id then
    raise exception 'La giornata non appartiene alla stagione della squadra.'
      using errcode = '23514';
  end if;

  -- Serializza i salvataggi della stessa squadra (ultimi minuti prima della deadline).
  perform 1
  from public.fantasy_teams
  where id = p_fantasy_team_id
  for update;

  if v_status in ('locked', 'scored', 'final') then
    raise exception 'La giornata % è chiusa (stato: %).', v_number, v_status
      using errcode = '23514';
  end if;

  if now() >= v_deadline then
    raise exception 'La deadline della giornata % è scaduta (%).', v_number, v_deadline
      using errcode = '23514';
  end if;

  perform public.validate_fantasy_team_roster(p_fantasy_team_id, v_number);

  select string_agg(coalesce(p.full_name, missing.player_id::text), ', ' order by p.full_name)
    into v_missing
  from unnest(p_player_ids) as missing(player_id)
  left join public.players p on p.id = missing.player_id
  where not exists (
    select 1
    from public.roster_stints rs
    where rs.fantasy_team_id = p_fantasy_team_id
      and rs.player_id = missing.player_id
      and rs.active_from_gameweek <= v_number
      and (
        rs.active_until_gameweek is null
        or rs.active_until_gameweek >= v_number
      )
  );

  if v_missing is not null then
    raise exception 'Titolari fuori rosa nella giornata %: %.', v_number, v_missing
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_bench_ids, '{}'::uuid[])) as bench_player(player_id)
    where bench_player.player_id is null
       or p_player_ids @> array[bench_player.player_id]
  ) then
    raise exception 'La panchina ripete un titolare o contiene un calciatore nullo.'
      using errcode = '22023';
  end if;

  select count(*) - count(distinct player_id)
    into v_count
  from unnest(coalesce(p_bench_ids, '{}'::uuid[])) as player_id;

  if v_count > 0 then
    raise exception 'La panchina contiene calciatori ripetuti.'
      using errcode = '22023';
  end if;

  v_count := cardinality(p_player_ids);

  select string_agg(coalesce(p.full_name, missing.player_id::text), ', ' order by p.full_name)
    into v_missing
  from unnest(coalesce(p_bench_ids, '{}'::uuid[])) as missing(player_id)
  left join public.players p on p.id = missing.player_id
  where missing.player_id is not null
    and not exists (
      select 1
      from public.roster_stints rs
      where rs.fantasy_team_id = p_fantasy_team_id
        and rs.player_id = missing.player_id
        and rs.active_from_gameweek <= v_number
        and (
          rs.active_until_gameweek is null
          or rs.active_until_gameweek >= v_number
        )
    );

  if v_missing is not null then
    raise exception 'Panchinari fuori rosa nella giornata %: %.', v_number, v_missing
      using errcode = '23514';
  end if;

  select count(distinct picked.player_id)
    into v_gk
  from unnest(p_player_ids) as picked(player_id)
  join public.player_registrations pr
    on pr.player_id = picked.player_id
   and pr.season_id = v_season_id
   and pr.effective_from_gameweek <= v_number
   and (
     pr.effective_to_gameweek is null
     or pr.effective_to_gameweek >= v_number
   )
  where pr.role = 'GK';

  if v_gk > 1 or (v_count = 11 and v_gk <> 1) then
    raise exception
      'Portieri titolari: %. Con 11 schierati ne serve uno; altrimenti al massimo uno.',
      v_gk
      using errcode = '23514';
  end if;

  select
    count(distinct picked.player_id) filter (where pr.role = 'DEF'),
    count(distinct picked.player_id) filter (where pr.role = 'MID'),
    count(distinct picked.player_id) filter (where pr.role = 'FWD')
    into v_def, v_mid, v_fwd
  from unnest(p_player_ids) as picked(player_id)
  join public.player_registrations pr
    on pr.player_id = picked.player_id
   and pr.season_id = v_season_id
   and pr.effective_from_gameweek <= v_number
   and (
     pr.effective_to_gameweek is null
     or pr.effective_to_gameweek >= v_number
   );

  if not (
       (v_gk <= 1 and v_def <= 3 and v_mid <= 4 and v_fwd <= 3)
    or (v_gk <= 1 and v_def <= 3 and v_mid <= 5 and v_fwd <= 2)
    or (v_gk <= 1 and v_def <= 4 and v_mid <= 3 and v_fwd <= 3)
    or (v_gk <= 1 and v_def <= 4 and v_mid <= 4 and v_fwd <= 2)
    or (v_gk <= 1 and v_def <= 4 and v_mid <= 5 and v_fwd <= 1)
    or (v_gk <= 1 and v_def <= 5 and v_mid <= 3 and v_fwd <= 2)
    or (v_gk <= 1 and v_def <= 5 and v_mid <= 4 and v_fwd <= 1)
  ) then
    raise exception
      'Modulo %-%-% non ammesso. Moduli: 3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1.',
      v_def, v_mid, v_fwd
      using errcode = '23514';
  end if;

  insert into public.lineups (id, fantasy_team_id, gameweek_id, status, saved_at)
  values (gen_random_uuid(), p_fantasy_team_id, p_gameweek_id, 'draft', now())
  on conflict (fantasy_team_id, gameweek_id) do update
  set
    status = 'draft',
    locked_at = null,
    saved_at = now()
  returning id into v_lineup_id;

  delete from public.lineup_slots
  where lineup_id = v_lineup_id;

  -- Titolari: is_starter true, slot_order = posizione in p_player_ids (da 1).
  -- Panchina: is_starter false, capitano e vice spenti, slot_order = ordine dei clic (da 1).
  insert into public.lineup_slots (lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order)
  select
    v_lineup_id,
    picked.player_id,
    picked.player_id = p_captain_id,
    picked.player_id is not distinct from p_vice_captain_id,
    true,
    picked.ordinality::int
  from unnest(p_player_ids) with ordinality as picked(player_id, ordinality)
  union all
  select
    v_lineup_id,
    picked.player_id,
    false,
    false,
    false,
    picked.ordinality::int
  from unnest(coalesce(p_bench_ids, '{}'::uuid[])) with ordinality as picked(player_id, ordinality)
  where picked.player_id is not null
    and not (p_player_ids @> array[picked.player_id]);

  return v_lineup_id;
end;
$$;

--
-- Name: validate_fantasy_team_roster(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_fantasy_team_roster(p_fantasy_team_id uuid, p_gameweek integer) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_team_name text;
  v_season_id uuid;
  v_definition jsonb;
  v_squad_size int;
  v_gk_min int;
  v_gk_max int;
  v_out_min int;
  v_out_max int;
  v_errors text[];
begin
  if p_fantasy_team_id is null then
    raise exception 'Identificativo squadra mancante.'
      using errcode = '22004';
  end if;

  if p_gameweek is null or p_gameweek < 1 then
    raise exception 'Giornata non valida: %.', p_gameweek
      using errcode = '22023';
  end if;

  select ft.name, ft.season_id, r.definition
    into v_team_name, v_season_id, v_definition
  from public.fantasy_teams ft
  join public.seasons s on s.id = ft.season_id
  join public.rulesets r on r.id = s.ruleset_id
  where ft.id = p_fantasy_team_id;

  if not found then
    raise exception 'Squadra fantacalcio non trovata: %.', p_fantasy_team_id
      using errcode = 'P0002';
  end if;

  v_squad_size := (v_definition ->> 'squad_size')::int;
  v_gk_min := (v_definition -> 'goalkeepers' ->> 'min')::int;
  v_gk_max := (v_definition -> 'goalkeepers' ->> 'max')::int;
  v_out_min := (v_definition -> 'outfield_roles' ->> 'min')::int;
  v_out_max := (v_definition -> 'outfield_roles' ->> 'max')::int;

  if v_squad_size is null
     or v_gk_min is null or v_gk_max is null
     or v_out_min is null or v_out_max is null then
    raise exception
      'Ruleset della stagione incompleto: servono squad_size, goalkeepers.min, goalkeepers.max, outfield_roles.min e outfield_roles.max.'
      using errcode = '23514';
  end if;

  with active as (
    select rs.player_id, count(*) as stint_count
    from public.roster_stints rs
    where rs.fantasy_team_id = p_fantasy_team_id
      and rs.active_from_gameweek <= p_gameweek
      and (
        rs.active_until_gameweek is null
        or rs.active_until_gameweek >= p_gameweek
      )
    group by rs.player_id
  ),
  reg_counts as (
    select pr.player_id, count(*) as reg_count
    from public.player_registrations pr
    join active a on a.player_id = pr.player_id
    where pr.season_id = v_season_id
      and pr.effective_from_gameweek <= p_gameweek
      and (
        pr.effective_to_gameweek is null
        or pr.effective_to_gameweek >= p_gameweek
      )
    group by pr.player_id
  ),
  resolved as (
    select
      a.player_id,
      p.full_name,
      pr.club_id,
      pr.role
    from active a
    join reg_counts rc
      on rc.player_id = a.player_id
     and rc.reg_count = 1
    join public.players p on p.id = a.player_id
    join public.player_registrations pr
      on pr.player_id = a.player_id
     and pr.season_id = v_season_id
     and pr.effective_from_gameweek <= p_gameweek
     and (
       pr.effective_to_gameweek is null
       or pr.effective_to_gameweek >= p_gameweek
     )
  )
  select coalesce(array_agg(violations.msg order by violations.ord), array[]::text[])
    into v_errors
  from (
    select
      10 as ord,
      '- Dimensione rosa: attesi '
        || v_squad_size
        || ' calciatori, trovati '
        || (select count(*) from active)
        || '.' as msg
    where (select count(*) from active) <> v_squad_size

    union all

    select
      20,
      '- Calciatori presenti più volte nella rosa della giornata: '
        || string_agg(p.full_name, ', ' order by p.full_name)
        || '.'
    from active a
    join public.players p on p.id = a.player_id
    where a.stint_count > 1
    having count(*) > 0

    union all

    select
      30,
      '- Calciatori senza iscrizione valida nel listone per la giornata '
        || p_gameweek
        || ': '
        || string_agg(p.full_name, ', ' order by p.full_name)
        || '.'
    from active a
    join public.players p on p.id = a.player_id
    left join reg_counts rc on rc.player_id = a.player_id
    where coalesce(rc.reg_count, 0) = 0
    having count(*) > 0

    union all

    select
      40,
      '- Calciatori con più iscrizioni sovrapposte nel listone: '
        || string_agg(p.full_name, ', ' order by p.full_name)
        || '.'
    from active a
    join public.players p on p.id = a.player_id
    join reg_counts rc on rc.player_id = a.player_id
    where rc.reg_count > 1
    having count(*) > 0

    union all

    select
      50,
      '- Configurazione stagione: il ruleset richiede una rosa di '
        || v_squad_size
        || ' calciatori, ma i club della stagione sono '
        || (
          select count(*)
          from public.season_clubs sc
          where sc.season_id = v_season_id
        )
        || '.'
    where (
      select count(*)
      from public.season_clubs sc
      where sc.season_id = v_season_id
    ) <> v_squad_size

    union all

    select
      60,
      '- Club della stagione senza esattamente un calciatore: '
        || string_agg(gaps.line, '; ' order by gaps.line)
        || '.'
    from (
      select format(
        '%s (%s)',
        coalesce(ct.short_name, cl.code),
        case
          when count(rr.player_id) = 0 then '0'
          else count(rr.player_id)::text
            || ': '
            || string_agg(rr.full_name, ', ' order by rr.full_name)
        end
      ) as line
      from public.season_clubs sc
      join public.clubs cl on cl.id = sc.club_id
      left join public.club_translations ct
        on ct.club_id = cl.id
       and ct.locale = 'it'
      left join resolved rr on rr.club_id = sc.club_id
      where sc.season_id = v_season_id
      group by cl.code, ct.short_name
      having count(rr.player_id) <> 1
    ) gaps
    having count(*) > 0

    union all

    select
      70,
      '- Calciatori il cui club non appartiene alla stagione: '
        || string_agg(
          rr.full_name || ' (' || coalesce(ct.short_name, cl.code) || ')',
          ', '
          order by rr.full_name
        )
        || '.'
    from resolved rr
    join public.clubs cl on cl.id = rr.club_id
    left join public.club_translations ct
      on ct.club_id = cl.id
     and ct.locale = 'it'
    where not exists (
      select 1
      from public.season_clubs sc
      where sc.season_id = v_season_id
        and sc.club_id = rr.club_id
    )
    having count(*) > 0

    union all

    select
      roles.ord,
      '- '
        || roles.label
        || ' ('
        || roles.role::text
        || '): ammessi da '
        || roles.min_n
        || ' a '
        || roles.max_n
        || ', trovati '
        || roles.found
        || '.'
    from (
      select
        expected.role,
        expected.label,
        expected.min_n,
        expected.max_n,
        expected.ord,
        coalesce(found.n, 0) as found
      from (
        values
          ('GK'::public.player_role, 'Portieri', v_gk_min, v_gk_max, 90),
          ('DEF'::public.player_role, 'Difensori', v_out_min, v_out_max, 100),
          ('MID'::public.player_role, 'Centrocampisti', v_out_min, v_out_max, 110),
          ('FWD'::public.player_role, 'Attaccanti', v_out_min, v_out_max, 120)
      ) as expected(role, label, min_n, max_n, ord)
      left join (
        select rr.role, count(*) as n
        from resolved rr
        group by rr.role
      ) found on found.role = expected.role
    ) roles
    where roles.found < roles.min_n
       or roles.found > roles.max_n
  ) violations;

  if cardinality(v_errors) > 0 then
    raise exception '%',
      'Rosa non valida per "'
      || v_team_name
      || '" (giornata '
      || p_gameweek
      || '):'
      || E'\n'
      || array_to_string(v_errors, E'\n')
      using errcode = '23514';
  end if;
end;
$$;

--
-- Name: vote_clock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vote_clock() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'auto', coalesce((select s.auto_sync_enabled from public.system_settings s where s.id = 1), true),
    'halftime', coalesce((select s.halftime_read_enabled from public.system_settings s where s.id = 1), true),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'number', g.number,
        'status', g.status::text,
        'seasonCode', se.code,
        'matches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id,
            'kickoffAt', m.kickoff_at,
            'status', m.status::text,
            'home', lower(h.code),
            'away', lower(a.code),
            'homeClubId', m.home_club_id,
            'awayClubId', m.away_club_id,
            'postponed', m.postponed,
            'holdStatus', m.hold_status,
            'holdKickoffAt', m.hold_kickoff_at
          ) order by m.kickoff_at, m.id)
          from public.real_matches m
          join public.clubs h on h.id = m.home_club_id
          join public.clubs a on a.id = m.away_club_id
          where m.gameweek_id = g.id
        ), '[]'::jsonb)
      ) order by g.number)
      from public.gameweeks g
      join public.seasons se on se.id = g.season_id
      join public.competitions c on c.id = se.competition_id
      where c.code = 'serie_a'
        and se.code <> 'sandbox'
        and g.status::text <> 'final'
        and exists (
          select 1 from public.real_matches r
          where r.gameweek_id = g.id
            and r.kickoff_at between now() - interval '10 days' and now() + interval '1 day'
        )
    ), '[]'::jsonb),
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', v.task_key,
        'attempt', v.attempt,
        'weekId', v.gameweek_id,
        'kind', v.kind,
        'outcome', v.outcome,
        'startedAt', v.started_at,
        'finishedAt', v.finished_at
      ))
      from public.vote_reads v
      where v.started_at > now() - interval '45 days'
    ), '[]'::jsonb)
  );
$$;

--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    title text,
    body text,
    image_url text,
    cta_label text,
    cta_href text,
    is_active boolean DEFAULT false NOT NULL,
    once_per_user boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_announcements_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'image'::text, 'both'::text])))
);

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: bonus_type_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_type_translations (
    code text NOT NULL,
    locale text NOT NULL,
    label text NOT NULL
);

--
-- Name: calendar_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    provider text DEFAULT 'api_football'::text NOT NULL,
    save_mode public.calendar_save_mode NOT NULL,
    status text DEFAULT 'stored'::text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    CONSTRAINT calendar_sync_runs_status_check CHECK ((status = ANY (ARRAY['stored'::text, 'applied'::text])))
);

--
-- Name: checkpoint_moves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_moves (
    id uuid NOT NULL,
    checkpoint_id uuid NOT NULL,
    fantasy_team_id uuid NOT NULL,
    player_out_id uuid NOT NULL,
    player_in_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkpoint_moves_check CHECK ((player_out_id <> player_in_id))
);

--
-- Name: checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoints (
    id uuid NOT NULL,
    season_id uuid NOT NULL,
    sequence smallint NOT NULL,
    gameweek_id uuid NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    CONSTRAINT checkpoints_check CHECK ((opens_at < closes_at)),
    CONSTRAINT checkpoints_sequence_check CHECK (((sequence >= 1) AND (sequence <= 3)))
);

--
-- Name: club_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_badges (
    club_code text NOT NULL,
    primary_color text NOT NULL,
    secondary_color text NOT NULL,
    logo_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: club_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_translations (
    club_id uuid NOT NULL,
    locale text NOT NULL,
    name text NOT NULL,
    short_name text NOT NULL
);

--
-- Name: clubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubs (
    id uuid NOT NULL,
    competition_id uuid NOT NULL,
    code text NOT NULL
);

--
-- Name: competition_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_translations (
    competition_id uuid NOT NULL,
    locale text NOT NULL,
    name text NOT NULL
);

--
-- Name: competitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitions (
    id uuid NOT NULL,
    code text NOT NULL,
    country_code character(2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    start_matchday integer DEFAULT 1,
    end_matchday integer DEFAULT 38
);

--
-- Name: device_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_push_tokens (
    token text NOT NULL,
    user_id uuid NOT NULL,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);

--
-- Name: engagement_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_notices (
    dedupe_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: external_fixtures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_fixtures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    gameweek_number integer NOT NULL,
    external_ref text NOT NULL,
    home_club_code text,
    away_club_code text,
    kickoff_at timestamp with time zone NOT NULL,
    save_mode public.calendar_save_mode NOT NULL,
    sync_run_id uuid NOT NULL,
    CONSTRAINT external_fixtures_gameweek_number_check CHECK ((gameweek_number >= 1))
);

--
-- Name: fantasy_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_teams (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_sandbox boolean DEFAULT false NOT NULL
);

--
-- Name: league_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    fantasy_team_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    detail text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_badges_kind_check CHECK ((kind = ANY (ARRAY['pollo'::text, 're_bonus'::text, 'rigorista'::text])))
);

--
-- Name: league_delegates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_delegates (
    league_id uuid NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: league_feed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_feed (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    gameweek_id uuid,
    kind text NOT NULL,
    body text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_feed_kind_check CHECK ((kind = ANY (ARRAY['mercato'::text, 'risultati'::text, 'badge'::text, 'ribaltone'::text])))
);

--
-- Name: league_regulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_regulations (
    league_id uuid NOT NULL,
    body_md text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);

--
-- Name: lineup_player_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lineup_player_scores (
    fantasy_team_id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    player_id uuid NOT NULL,
    voto numeric(3,1),
    bonus_points numeric(5,2) NOT NULL,
    malus_points numeric(5,2) NOT NULL,
    malus_factor numeric(2,1) NOT NULL,
    player_points numeric(5,2),
    is_effective_captain boolean NOT NULL
);

--
-- Name: lineup_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lineup_slots (
    lineup_id uuid NOT NULL,
    player_id uuid NOT NULL,
    is_captain boolean DEFAULT false NOT NULL,
    is_vice_captain boolean DEFAULT false NOT NULL,
    is_starter boolean DEFAULT true NOT NULL,
    slot_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT lineup_slots_bench_flags CHECK ((is_starter OR ((NOT is_captain) AND (NOT is_vice_captain)))),
    CONSTRAINT lineup_slots_check CHECK ((NOT (is_captain AND is_vice_captain)))
);

--
-- Name: lineups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lineups (
    id uuid NOT NULL,
    fantasy_team_id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    status public.lineup_status DEFAULT 'draft'::public.lineup_status NOT NULL,
    locked_at timestamp with time zone,
    saved_at timestamp with time zone,
    origin text DEFAULT 'user'::text NOT NULL,
    CONSTRAINT lineups_origin_check CHECK ((origin = ANY (ARRAY['user'::text, 'office'::text])))
);

--
-- Name: live_rank_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_rank_snapshots (
    league_id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    fantasy_team_id uuid NOT NULL,
    points numeric(8,2) NOT NULL
);

--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT notification_templates_kind_check CHECK ((kind = ANY (ARRAY['deadline'::text, 'bonus'::text, 'overtake'::text])))
);

--
-- Name: platform_home; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_home (
    id integer DEFAULT 1 NOT NULL,
    promo_image text,
    promo_href text,
    promo_label text,
    probabili_href text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_home_id_check CHECK ((id = 1))
);

--
-- Name: platform_maintenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_maintenance (
    id integer NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    message text DEFAULT 'Manutenzione in corso. Puoi consultare la lega: formazioni e mercati restano chiusi fino alla fine del calcolo.'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_maintenance_id_check CHECK ((id = 1))
);

--
-- Name: platform_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_news (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link_url text,
    link_label text,
    pinned boolean DEFAULT false NOT NULL,
    published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: player_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_id uuid NOT NULL,
    matchday integer NOT NULL,
    status text NOT NULL,
    play_probability integer,
    reason text,
    source_provider text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_availability_matchday_check CHECK ((matchday >= 1)),
    CONSTRAINT player_availability_play_probability_check CHECK (((play_probability IS NULL) OR ((play_probability >= 0) AND (play_probability <= 100)))),
    CONSTRAINT player_availability_status_check CHECK ((status = ANY (ARRAY['available'::text, 'starter'::text, 'bench'::text, 'doubt'::text, 'injured'::text, 'suspended'::text])))
);

--
-- Name: player_gameweek_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_gameweek_stats (
    id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    player_id uuid NOT NULL,
    vote_import_id uuid NOT NULL,
    voto numeric(3,1),
    goals integer DEFAULT 0 NOT NULL,
    assists integer DEFAULT 0 NOT NULL,
    yellow_cards integer DEFAULT 0 NOT NULL,
    red_cards integer DEFAULT 0 NOT NULL,
    penalties_scored integer DEFAULT 0 NOT NULL,
    penalties_missed integer DEFAULT 0 NOT NULL,
    penalties_saved integer DEFAULT 0 NOT NULL,
    own_goals integer DEFAULT 0 NOT NULL,
    goals_conceded integer DEFAULT 0 NOT NULL,
    postponed boolean DEFAULT false NOT NULL,
    CONSTRAINT player_gameweek_stats_voto_check CHECK (((voto IS NULL) OR ((voto >= (0)::numeric) AND (voto <= (10)::numeric))))
);

--
-- Name: player_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_registrations (
    id uuid NOT NULL,
    season_id uuid NOT NULL,
    player_id uuid NOT NULL,
    club_id uuid NOT NULL,
    role public.player_role NOT NULL,
    is_super boolean DEFAULT false NOT NULL,
    effective_from_gameweek integer NOT NULL,
    effective_to_gameweek integer,
    role_locked boolean DEFAULT false NOT NULL
);

--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id uuid NOT NULL,
    external_ref text,
    full_name text NOT NULL,
    competition_id uuid NOT NULL
);

--
-- Name: private_league_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_league_members (
    private_league_id uuid NOT NULL,
    fantasy_team_id uuid NOT NULL
);

--
-- Name: private_leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_leagues (
    id uuid NOT NULL,
    season_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    join_code text NOT NULL,
    start_matchday integer DEFAULT 1 NOT NULL,
    end_matchday integer DEFAULT 38 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    competition_format text DEFAULT 'classic'::text NOT NULL,
    is_sandbox boolean DEFAULT false NOT NULL,
    CONSTRAINT private_leagues_competition_format CHECK ((competition_format = ANY (ARRAY['classic'::text, 'h2h'::text, 'hybrid'::text]))),
    CONSTRAINT private_leagues_matchday_range CHECK (((start_matchday >= 1) AND (end_matchday >= start_matchday)))
);

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text NOT NULL,
    locale text DEFAULT 'it'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_role text DEFAULT 'member'::text NOT NULL,
    email text,
    first_name text,
    last_name text,
    phone text,
    must_reset_password boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_platform_role CHECK ((platform_role = ANY (ARRAY['member'::text, 'super_admin'::text])))
);

--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    endpoint text NOT NULL,
    user_id uuid NOT NULL,
    p256dh text NOT NULL,
    auth_secret text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: real_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.real_matches (
    id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    home_club_id uuid NOT NULL,
    away_club_id uuid NOT NULL,
    kickoff_at timestamp with time zone NOT NULL,
    kickoff_locked boolean DEFAULT false NOT NULL,
    status public.match_status DEFAULT 'scheduled'::public.match_status NOT NULL,
    home_goals integer,
    away_goals integer,
    postponed boolean DEFAULT false NOT NULL,
    hold_status text DEFAULT 'none'::text NOT NULL,
    hold_kickoff_at timestamp with time zone,
    CONSTRAINT real_matches_check CHECK ((home_club_id <> away_club_id)),
    CONSTRAINT real_matches_goals_check CHECK ((((home_goals IS NULL) AND (away_goals IS NULL)) OR ((home_goals >= 0) AND (away_goals >= 0)))),
    CONSTRAINT real_matches_hold_status CHECK ((hold_status = ANY (ARRAY['none'::text, 'postponed'::text, 'suspended'::text])))
);

--
-- Name: roster_checkpoint_uses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_checkpoint_uses (
    fantasy_team_id uuid NOT NULL,
    after_matchday integer NOT NULL,
    changes_used integer DEFAULT 0 NOT NULL,
    CONSTRAINT roster_checkpoint_uses_after_matchday_check CHECK ((after_matchday >= 1)),
    CONSTRAINT roster_checkpoint_uses_changes_used_check CHECK ((changes_used >= 0))
);

--
-- Name: roster_stints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_stints (
    id uuid NOT NULL,
    fantasy_team_id uuid NOT NULL,
    player_id uuid NOT NULL,
    active_from_gameweek integer NOT NULL,
    active_until_gameweek integer,
    CONSTRAINT roster_stints_check CHECK (((active_until_gameweek IS NULL) OR (active_until_gameweek >= active_from_gameweek)))
);

--
-- Name: rulesets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rulesets (
    id uuid NOT NULL,
    code text NOT NULL,
    version integer NOT NULL,
    definition jsonb NOT NULL
);

--
-- Name: season_clubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.season_clubs (
    season_id uuid NOT NULL,
    club_id uuid NOT NULL
);

--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id uuid NOT NULL,
    competition_id uuid NOT NULL,
    ruleset_id uuid NOT NULL,
    code text NOT NULL,
    status public.season_status DEFAULT 'draft'::public.season_status NOT NULL,
    starts_on date,
    ends_on date,
    is_sandbox boolean DEFAULT false NOT NULL
);

--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    job_type text NOT NULL,
    trigger_source text NOT NULL,
    status text NOT NULL,
    records_written integer DEFAULT 0 NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    CONSTRAINT sync_logs_job_type_check CHECK ((job_type = ANY (ARRAY['votes'::text, 'availability'::text, 'kickoffs'::text]))),
    CONSTRAINT sync_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'skipped'::text, 'error'::text]))),
    CONSTRAINT sync_logs_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['cron'::text, 'manual'::text])))
);

--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    votes_source_url text DEFAULT 'https://www.fantacalcio.it/serie-a/voti'::text NOT NULL,
    votes_provider text DEFAULT 'fantacalcio'::text NOT NULL,
    availability_provider text DEFAULT 'api-sports'::text NOT NULL,
    api_sports_league_id integer DEFAULT 135 NOT NULL,
    api_sports_season integer DEFAULT 2026 NOT NULL,
    sync_window_post_match_min integer DEFAULT 125 NOT NULL,
    sync_window_post_match_max integer DEFAULT 150 NOT NULL,
    sync_window_evening_start text DEFAULT '23:15'::text NOT NULL,
    sync_window_evening_end text DEFAULT '23:45'::text NOT NULL,
    sync_window_morning_start text DEFAULT '09:15'::text NOT NULL,
    sync_window_morning_end text DEFAULT '09:45'::text NOT NULL,
    auto_sync_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    brand_logo_url text DEFAULT ''::text NOT NULL,
    brand_icon_192_url text DEFAULT ''::text NOT NULL,
    brand_icon_512_url text DEFAULT ''::text NOT NULL,
    brand_accent_color text DEFAULT '#c6f531'::text NOT NULL,
    notify_on_sync_success boolean DEFAULT true NOT NULL,
    halftime_read_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT system_settings_id_check CHECK ((id = 1))
);

--
-- Name: user_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);

--
-- Name: vote_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_imports (
    id uuid NOT NULL,
    gameweek_id uuid NOT NULL,
    source text NOT NULL,
    source_note text DEFAULT 'Napoli'::text NOT NULL,
    payload_hash text NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: vote_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_reads (
    task_key text NOT NULL,
    attempt smallint NOT NULL,
    gameweek_id uuid,
    kind text NOT NULL,
    outcome text DEFAULT 'pending'::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT vote_reads_attempt_check CHECK (((attempt >= 0) AND (attempt <= 2))),
    CONSTRAINT vote_reads_kind_check CHECK ((kind = ANY (ARRAY['halftime'::text, 'fulltime'::text, 'morning'::text, 'calendar'::text, 'calc'::text]))),
    CONSTRAINT vote_reads_outcome_check CHECK ((outcome = ANY (ARRAY['pending'::text, 'ok'::text, 'not_ready'::text, 'error'::text, 'alert'::text])))
);

--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);

--
-- Name: app_announcements app_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_announcements
    ADD CONSTRAINT app_announcements_pkey PRIMARY KEY (id);

--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);

--
-- Name: bonus_type_translations bonus_type_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_type_translations
    ADD CONSTRAINT bonus_type_translations_pkey PRIMARY KEY (code, locale);

--
-- Name: calendar_sync_runs calendar_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_sync_runs
    ADD CONSTRAINT calendar_sync_runs_pkey PRIMARY KEY (id);

--
-- Name: checkpoint_moves checkpoint_moves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_moves
    ADD CONSTRAINT checkpoint_moves_pkey PRIMARY KEY (id);

--
-- Name: checkpoints checkpoints_gameweek_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_gameweek_id_key UNIQUE (gameweek_id);

--
-- Name: checkpoints checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (id);

--
-- Name: checkpoints checkpoints_season_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_season_id_sequence_key UNIQUE (season_id, sequence);

--
-- Name: club_badges club_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_badges
    ADD CONSTRAINT club_badges_pkey PRIMARY KEY (club_code);

--
-- Name: club_translations club_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_translations
    ADD CONSTRAINT club_translations_pkey PRIMARY KEY (club_id, locale);

--
-- Name: clubs clubs_competition_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_competition_id_code_key UNIQUE (competition_id, code);

--
-- Name: clubs clubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_pkey PRIMARY KEY (id);

--
-- Name: competition_translations competition_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_translations
    ADD CONSTRAINT competition_translations_pkey PRIMARY KEY (competition_id, locale);

--
-- Name: competitions competitions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_code_key UNIQUE (code);

--
-- Name: competitions competitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_pkey PRIMARY KEY (id);

--
-- Name: device_push_tokens device_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_pkey PRIMARY KEY (token);

--
-- Name: engagement_notices engagement_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_notices
    ADD CONSTRAINT engagement_notices_pkey PRIMARY KEY (dedupe_key);

--
-- Name: external_fixtures external_fixtures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_fixtures
    ADD CONSTRAINT external_fixtures_pkey PRIMARY KEY (id);

--
-- Name: external_fixtures external_fixtures_season_id_external_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_fixtures
    ADD CONSTRAINT external_fixtures_season_id_external_ref_key UNIQUE (season_id, external_ref);

--
-- Name: fantasy_teams fantasy_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_teams
    ADD CONSTRAINT fantasy_teams_pkey PRIMARY KEY (id);

--
-- Name: gameweek_overrides gameweek_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gameweek_overrides
    ADD CONSTRAINT gameweek_overrides_pkey PRIMARY KEY (gameweek_id);

--
-- Name: gameweeks gameweeks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gameweeks
    ADD CONSTRAINT gameweeks_pkey PRIMARY KEY (id);

--
-- Name: gameweeks gameweeks_season_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gameweeks
    ADD CONSTRAINT gameweeks_season_id_number_key UNIQUE (season_id, number);

--
-- Name: league_badges league_badges_league_id_gameweek_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_badges
    ADD CONSTRAINT league_badges_league_id_gameweek_id_kind_key UNIQUE (league_id, gameweek_id, kind);

--
-- Name: league_badges league_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_badges
    ADD CONSTRAINT league_badges_pkey PRIMARY KEY (id);

--
-- Name: league_delegates league_delegates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_delegates
    ADD CONSTRAINT league_delegates_pkey PRIMARY KEY (league_id, user_id);

--
-- Name: league_feed league_feed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_feed
    ADD CONSTRAINT league_feed_pkey PRIMARY KEY (id);

--
-- Name: league_regulations league_regulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_regulations
    ADD CONSTRAINT league_regulations_pkey PRIMARY KEY (league_id);

--
-- Name: lineup_player_scores lineup_player_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_player_scores
    ADD CONSTRAINT lineup_player_scores_pkey PRIMARY KEY (fantasy_team_id, gameweek_id, player_id);

--
-- Name: lineup_slots lineup_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_pkey PRIMARY KEY (lineup_id, player_id);

--
-- Name: lineups lineups_fantasy_team_id_gameweek_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineups
    ADD CONSTRAINT lineups_fantasy_team_id_gameweek_id_key UNIQUE (fantasy_team_id, gameweek_id);

--
-- Name: lineups lineups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineups
    ADD CONSTRAINT lineups_pkey PRIMARY KEY (id);

--
-- Name: live_rank_snapshots live_rank_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rank_snapshots
    ADD CONSTRAINT live_rank_snapshots_pkey PRIMARY KEY (league_id, gameweek_id, fantasy_team_id);

--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (kind);

--
-- Name: platform_home platform_home_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_home
    ADD CONSTRAINT platform_home_pkey PRIMARY KEY (id);

--
-- Name: platform_maintenance platform_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_maintenance
    ADD CONSTRAINT platform_maintenance_pkey PRIMARY KEY (id);

--
-- Name: platform_news platform_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_news
    ADD CONSTRAINT platform_news_pkey PRIMARY KEY (id);

--
-- Name: player_availability player_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_availability
    ADD CONSTRAINT player_availability_pkey PRIMARY KEY (id);

--
-- Name: player_availability player_availability_player_id_matchday_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_availability
    ADD CONSTRAINT player_availability_player_id_matchday_key UNIQUE (player_id, matchday);

--
-- Name: player_gameweek_stats player_gameweek_stats_gameweek_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_gameweek_stats
    ADD CONSTRAINT player_gameweek_stats_gameweek_id_player_id_key UNIQUE (gameweek_id, player_id);

--
-- Name: player_gameweek_stats player_gameweek_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_gameweek_stats
    ADD CONSTRAINT player_gameweek_stats_pkey PRIMARY KEY (id);

--
-- Name: player_registrations player_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_registrations
    ADD CONSTRAINT player_registrations_pkey PRIMARY KEY (id);

--
-- Name: player_registrations player_registrations_season_id_player_id_effective_from_gam_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_registrations
    ADD CONSTRAINT player_registrations_season_id_player_id_effective_from_gam_key UNIQUE (season_id, player_id, effective_from_gameweek);

--
-- Name: players players_competition_external_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_competition_external_ref_key UNIQUE (competition_id, external_ref);

--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);

--
-- Name: private_league_members private_league_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_league_members
    ADD CONSTRAINT private_league_members_pkey PRIMARY KEY (private_league_id, fantasy_team_id);

--
-- Name: private_leagues private_leagues_join_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_join_code_key UNIQUE (join_code);

--
-- Name: private_leagues private_leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_pkey PRIMARY KEY (id);

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (endpoint);

--
-- Name: real_matches real_matches_gameweek_id_home_club_id_away_club_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.real_matches
    ADD CONSTRAINT real_matches_gameweek_id_home_club_id_away_club_id_key UNIQUE (gameweek_id, home_club_id, away_club_id);

--
-- Name: real_matches real_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.real_matches
    ADD CONSTRAINT real_matches_pkey PRIMARY KEY (id);

--
-- Name: roster_checkpoint_uses roster_checkpoint_uses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_checkpoint_uses
    ADD CONSTRAINT roster_checkpoint_uses_pkey PRIMARY KEY (fantasy_team_id, after_matchday);

--
-- Name: roster_stints roster_stints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_stints
    ADD CONSTRAINT roster_stints_pkey PRIMARY KEY (id);

--
-- Name: rulesets rulesets_code_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rulesets
    ADD CONSTRAINT rulesets_code_version_key UNIQUE (code, version);

--
-- Name: rulesets rulesets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rulesets
    ADD CONSTRAINT rulesets_pkey PRIMARY KEY (id);

--
-- Name: season_clubs season_clubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_clubs
    ADD CONSTRAINT season_clubs_pkey PRIMARY KEY (season_id, club_id);

--
-- Name: seasons seasons_competition_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_competition_id_code_key UNIQUE (competition_id, code);

--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);

--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);

--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);

--
-- Name: team_gameweek_scores team_gameweek_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_gameweek_scores
    ADD CONSTRAINT team_gameweek_scores_pkey PRIMARY KEY (fantasy_team_id, gameweek_id);

--
-- Name: user_notices user_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notices
    ADD CONSTRAINT user_notices_pkey PRIMARY KEY (id);

--
-- Name: vote_imports vote_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_imports
    ADD CONSTRAINT vote_imports_pkey PRIMARY KEY (id);

--
-- Name: vote_reads vote_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_reads
    ADD CONSTRAINT vote_reads_pkey PRIMARY KEY (task_key, attempt);

--
-- Name: admin_audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_created_at_idx ON public.admin_audit_logs USING btree (created_at DESC);

--
-- Name: external_fixtures_season_gameweek_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_fixtures_season_gameweek_idx ON public.external_fixtures USING btree (season_id, gameweek_number);

--
-- Name: fantasy_teams_sandbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fantasy_teams_sandbox_idx ON public.fantasy_teams USING btree (is_sandbox);

--
-- Name: fantasy_teams_user_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fantasy_teams_user_season_idx ON public.fantasy_teams USING btree (user_id, season_id);

--
-- Name: lineup_slots_lineup_player_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lineup_slots_lineup_player_uidx ON public.lineup_slots USING btree (lineup_id, player_id);

--
-- Name: private_leagues_sandbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_leagues_sandbox_idx ON public.private_leagues USING btree (is_sandbox);

--
-- Name: profiles_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_email_uidx ON public.profiles USING btree (lower(email)) WHERE (email IS NOT NULL);

--
-- Name: real_matches_gameweek_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX real_matches_gameweek_idx ON public.real_matches USING btree (gameweek_id);

--
-- Name: user_notices_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_notices_user_idx ON public.user_notices USING btree (user_id, created_at DESC);

--
-- Name: vote_imports_gameweek_payload_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vote_imports_gameweek_payload_uidx ON public.vote_imports USING btree (gameweek_id, payload_hash) WHERE (source <> 'mock'::text);

--
-- Name: vote_reads_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vote_reads_started_at ON public.vote_reads USING btree (started_at DESC);

--
-- Name: lineups lineup_team_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lineup_team_lock BEFORE INSERT OR UPDATE ON public.lineups FOR EACH ROW EXECUTE FUNCTION public.lock_fantasy_team_for_lineup();

--
-- Name: calendar_sync_runs calendar_sync_runs_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_sync_runs
    ADD CONSTRAINT calendar_sync_runs_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: checkpoint_moves checkpoint_moves_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_moves
    ADD CONSTRAINT checkpoint_moves_checkpoint_id_fkey FOREIGN KEY (checkpoint_id) REFERENCES public.checkpoints(id);

--
-- Name: checkpoint_moves checkpoint_moves_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_moves
    ADD CONSTRAINT checkpoint_moves_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id);

--
-- Name: checkpoint_moves checkpoint_moves_player_in_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_moves
    ADD CONSTRAINT checkpoint_moves_player_in_id_fkey FOREIGN KEY (player_in_id) REFERENCES public.players(id);

--
-- Name: checkpoint_moves checkpoint_moves_player_out_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_moves
    ADD CONSTRAINT checkpoint_moves_player_out_id_fkey FOREIGN KEY (player_out_id) REFERENCES public.players(id);

--
-- Name: checkpoints checkpoints_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id);

--
-- Name: checkpoints checkpoints_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: club_translations club_translations_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_translations
    ADD CONSTRAINT club_translations_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);

--
-- Name: clubs clubs_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id);

--
-- Name: competition_translations competition_translations_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_translations
    ADD CONSTRAINT competition_translations_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id);

--
-- Name: device_push_tokens device_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: external_fixtures external_fixtures_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_fixtures
    ADD CONSTRAINT external_fixtures_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: external_fixtures external_fixtures_sync_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_fixtures
    ADD CONSTRAINT external_fixtures_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.calendar_sync_runs(id);

--
-- Name: fantasy_teams fantasy_teams_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_teams
    ADD CONSTRAINT fantasy_teams_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: fantasy_teams fantasy_teams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_teams
    ADD CONSTRAINT fantasy_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);

--
-- Name: gameweek_overrides gameweek_overrides_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gameweek_overrides
    ADD CONSTRAINT gameweek_overrides_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id) ON DELETE CASCADE;

--
-- Name: gameweeks gameweeks_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gameweeks
    ADD CONSTRAINT gameweeks_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: league_badges league_badges_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_badges
    ADD CONSTRAINT league_badges_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id) ON DELETE CASCADE;

--
-- Name: league_badges league_badges_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_badges
    ADD CONSTRAINT league_badges_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id) ON DELETE CASCADE;

--
-- Name: league_badges league_badges_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_badges
    ADD CONSTRAINT league_badges_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.private_leagues(id) ON DELETE CASCADE;

--
-- Name: league_delegates league_delegates_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_delegates
    ADD CONSTRAINT league_delegates_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);

--
-- Name: league_delegates league_delegates_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_delegates
    ADD CONSTRAINT league_delegates_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.private_leagues(id) ON DELETE CASCADE;

--
-- Name: league_delegates league_delegates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_delegates
    ADD CONSTRAINT league_delegates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: league_feed league_feed_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_feed
    ADD CONSTRAINT league_feed_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id) ON DELETE SET NULL;

--
-- Name: league_feed league_feed_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_feed
    ADD CONSTRAINT league_feed_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.private_leagues(id) ON DELETE CASCADE;

--
-- Name: league_regulations league_regulations_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_regulations
    ADD CONSTRAINT league_regulations_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.private_leagues(id) ON DELETE CASCADE;

--
-- Name: lineup_player_scores lineup_player_scores_fantasy_team_id_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_player_scores
    ADD CONSTRAINT lineup_player_scores_fantasy_team_id_gameweek_id_fkey FOREIGN KEY (fantasy_team_id, gameweek_id) REFERENCES public.team_gameweek_scores(fantasy_team_id, gameweek_id) ON DELETE CASCADE;

--
-- Name: lineup_player_scores lineup_player_scores_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_player_scores
    ADD CONSTRAINT lineup_player_scores_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);

--
-- Name: lineup_slots lineup_slots_lineup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_lineup_id_fkey FOREIGN KEY (lineup_id) REFERENCES public.lineups(id) ON DELETE CASCADE;

--
-- Name: lineup_slots lineup_slots_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);

--
-- Name: lineups lineups_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineups
    ADD CONSTRAINT lineups_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id);

--
-- Name: lineups lineups_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineups
    ADD CONSTRAINT lineups_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id);

--
-- Name: live_rank_snapshots live_rank_snapshots_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rank_snapshots
    ADD CONSTRAINT live_rank_snapshots_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id) ON DELETE CASCADE;

--
-- Name: live_rank_snapshots live_rank_snapshots_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rank_snapshots
    ADD CONSTRAINT live_rank_snapshots_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id) ON DELETE CASCADE;

--
-- Name: live_rank_snapshots live_rank_snapshots_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rank_snapshots
    ADD CONSTRAINT live_rank_snapshots_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.private_leagues(id) ON DELETE CASCADE;

--
-- Name: player_availability player_availability_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_availability
    ADD CONSTRAINT player_availability_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

--
-- Name: player_gameweek_stats player_gameweek_stats_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_gameweek_stats
    ADD CONSTRAINT player_gameweek_stats_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id);

--
-- Name: player_gameweek_stats player_gameweek_stats_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_gameweek_stats
    ADD CONSTRAINT player_gameweek_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);

--
-- Name: player_gameweek_stats player_gameweek_stats_vote_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_gameweek_stats
    ADD CONSTRAINT player_gameweek_stats_vote_import_id_fkey FOREIGN KEY (vote_import_id) REFERENCES public.vote_imports(id);

--
-- Name: player_registrations player_registrations_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_registrations
    ADD CONSTRAINT player_registrations_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);

--
-- Name: player_registrations player_registrations_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_registrations
    ADD CONSTRAINT player_registrations_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);

--
-- Name: player_registrations player_registrations_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_registrations
    ADD CONSTRAINT player_registrations_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: players players_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id);

--
-- Name: private_league_members private_league_members_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_league_members
    ADD CONSTRAINT private_league_members_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id);

--
-- Name: private_league_members private_league_members_private_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_league_members
    ADD CONSTRAINT private_league_members_private_league_id_fkey FOREIGN KEY (private_league_id) REFERENCES public.private_leagues(id);

--
-- Name: private_leagues private_leagues_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id);

--
-- Name: private_leagues private_leagues_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: real_matches real_matches_away_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.real_matches
    ADD CONSTRAINT real_matches_away_club_id_fkey FOREIGN KEY (away_club_id) REFERENCES public.clubs(id);

--
-- Name: real_matches real_matches_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.real_matches
    ADD CONSTRAINT real_matches_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id);

--
-- Name: real_matches real_matches_home_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.real_matches
    ADD CONSTRAINT real_matches_home_club_id_fkey FOREIGN KEY (home_club_id) REFERENCES public.clubs(id);

--
-- Name: roster_checkpoint_uses roster_checkpoint_uses_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_checkpoint_uses
    ADD CONSTRAINT roster_checkpoint_uses_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id) ON DELETE CASCADE;

--
-- Name: roster_stints roster_stints_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_stints
    ADD CONSTRAINT roster_stints_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id);

--
-- Name: roster_stints roster_stints_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_stints
    ADD CONSTRAINT roster_stints_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);

--
-- Name: season_clubs season_clubs_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_clubs
    ADD CONSTRAINT season_clubs_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);

--
-- Name: season_clubs season_clubs_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_clubs
    ADD CONSTRAINT season_clubs_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: seasons seasons_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id);

--
-- Name: seasons seasons_ruleset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_ruleset_id_fkey FOREIGN KEY (ruleset_id) REFERENCES public.rulesets(id);

--
-- Name: team_gameweek_scores team_gameweek_scores_captain_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_gameweek_scores
    ADD CONSTRAINT team_gameweek_scores_captain_player_id_fkey FOREIGN KEY (captain_player_id) REFERENCES public.players(id);

--
-- Name: team_gameweek_scores team_gameweek_scores_fantasy_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_gameweek_scores
    ADD CONSTRAINT team_gameweek_scores_fantasy_team_id_fkey FOREIGN KEY (fantasy_team_id) REFERENCES public.fantasy_teams(id);

--
-- Name: team_gameweek_scores team_gameweek_scores_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_gameweek_scores
    ADD CONSTRAINT team_gameweek_scores_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id);

--
-- Name: team_gameweek_scores team_gameweek_scores_ruleset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_gameweek_scores
    ADD CONSTRAINT team_gameweek_scores_ruleset_id_fkey FOREIGN KEY (ruleset_id) REFERENCES public.rulesets(id);

--
-- Name: vote_imports vote_imports_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_imports
    ADD CONSTRAINT vote_imports_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id);

--
-- Name: vote_reads vote_reads_gameweek_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_reads
    ADD CONSTRAINT vote_reads_gameweek_id_fkey FOREIGN KEY (gameweek_id) REFERENCES public.gameweeks(id) ON DELETE CASCADE;

--
-- Name: admin_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_logs admin_audit_logs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_audit_logs_read ON public.admin_audit_logs FOR SELECT TO authenticated USING (public.is_super_admin());

--
-- Name: app_announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: app_announcements app_announcements_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_announcements_admin ON public.app_announcements TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: app_announcements app_announcements_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_announcements_read ON public.app_announcements FOR SELECT TO authenticated USING (((is_active = true) OR public.is_super_admin()));

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_admin ON public.app_settings TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: app_settings app_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_read ON public.app_settings FOR SELECT TO authenticated USING (public.is_super_admin());

--
-- Name: bonus_type_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bonus_type_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: bonus_type_translations bonus_type_translations_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bonus_type_translations_public_read ON public.bonus_type_translations FOR SELECT TO authenticated, anon USING (true);

--
-- Name: calendar_sync_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_sync_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: checkpoint_moves; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkpoint_moves ENABLE ROW LEVEL SECURITY;

--
-- Name: checkpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: club_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: club_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: club_translations club_translations_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_translations_public_read ON public.club_translations FOR SELECT TO authenticated, anon USING (true);

--
-- Name: clubs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

--
-- Name: clubs clubs_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clubs_public_read ON public.clubs FOR SELECT TO authenticated, anon USING (true);

--
-- Name: competition_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_translations competition_translations_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competition_translations_public_read ON public.competition_translations FOR SELECT TO authenticated, anon USING (true);

--
-- Name: competitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

--
-- Name: competitions competitions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competitions_public_read ON public.competitions FOR SELECT TO authenticated, anon USING (true);

--
-- Name: device_push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: device_push_tokens device_push_tokens_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_push_tokens_own ON public.device_push_tokens TO authenticated USING (((user_id = auth.uid()) OR public.is_super_admin())) WITH CHECK (((user_id = auth.uid()) OR public.is_super_admin()));

--
-- Name: engagement_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: external_fixtures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_fixtures ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_teams fantasy_teams_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_teams_owner_update ON public.fantasy_teams FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR public.is_super_admin())) WITH CHECK (((user_id = auth.uid()) OR public.is_super_admin()));

--
-- Name: fantasy_teams fantasy_teams_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_teams_read ON public.fantasy_teams FOR SELECT TO authenticated USING (public.can_read_team(id));

--
-- Name: gameweek_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gameweek_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: gameweeks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gameweeks ENABLE ROW LEVEL SECURITY;

--
-- Name: gameweeks gameweeks_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gameweeks_public_read ON public.gameweeks FOR SELECT TO authenticated, anon USING (true);

--
-- Name: league_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: league_badges league_badges_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_badges_league_read ON public.league_badges FOR SELECT TO authenticated USING ((public.can_read_league(league_id) OR public.can_read_team(fantasy_team_id)));

--
-- Name: league_badges league_badges_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_badges_read ON public.league_badges FOR SELECT TO authenticated USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM (public.private_league_members member
     JOIN public.fantasy_teams team ON ((team.id = member.fantasy_team_id)))
  WHERE ((member.private_league_id = league_badges.league_id) AND (team.user_id = auth.uid()))))));

--
-- Name: league_delegates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_delegates ENABLE ROW LEVEL SECURITY;

--
-- Name: league_delegates league_delegates_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_delegates_league_read ON public.league_delegates FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.can_read_league(league_id)));

--
-- Name: league_delegates league_delegates_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_delegates_member_read ON public.league_delegates FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.private_leagues league
  WHERE ((league.id = league_delegates.league_id) AND (league.owner_user_id = auth.uid()))))));

--
-- Name: league_delegates league_delegates_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_delegates_super_admin ON public.league_delegates TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: league_feed; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_feed ENABLE ROW LEVEL SECURITY;

--
-- Name: league_feed league_feed_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_feed_league_read ON public.league_feed FOR SELECT TO authenticated USING (public.can_read_league(league_id));

--
-- Name: league_feed league_feed_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_feed_read ON public.league_feed FOR SELECT TO authenticated USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM (public.private_league_members member
     JOIN public.fantasy_teams team ON ((team.id = member.fantasy_team_id)))
  WHERE ((member.private_league_id = league_feed.league_id) AND (team.user_id = auth.uid()))))));

--
-- Name: league_regulations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_regulations ENABLE ROW LEVEL SECURITY;

--
-- Name: league_regulations league_regulations_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_regulations_league_read ON public.league_regulations FOR SELECT TO authenticated USING (public.can_read_league(league_id));

--
-- Name: league_regulations league_regulations_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_regulations_read ON public.league_regulations FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.private_leagues league
  WHERE ((league.id = league_regulations.league_id) AND (league.owner_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM (public.private_league_members member
     JOIN public.fantasy_teams team ON ((team.id = member.fantasy_team_id)))
  WHERE ((member.private_league_id = league_regulations.league_id) AND (team.user_id = auth.uid()))))));

--
-- Name: league_regulations league_regulations_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY league_regulations_super_admin ON public.league_regulations TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: lineup_player_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lineup_player_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: lineup_player_scores lineup_player_scores_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lineup_player_scores_league_read ON public.lineup_player_scores FOR SELECT TO authenticated USING (public.can_read_team(fantasy_team_id));

--
-- Name: lineup_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lineup_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: lineup_slots lineup_slots_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lineup_slots_league_read ON public.lineup_slots FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.lineups lineup
  WHERE ((lineup.id = lineup_slots.lineup_id) AND public.can_read_team(lineup.fantasy_team_id)))));

--
-- Name: lineups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lineups ENABLE ROW LEVEL SECURITY;

--
-- Name: lineups lineups_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lineups_league_read ON public.lineups FOR SELECT TO authenticated USING (public.can_read_team(fantasy_team_id));

--
-- Name: lineups lineups_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lineups_member_read ON public.lineups FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.fantasy_teams team
  WHERE ((team.id = lineups.fantasy_team_id) AND (team.user_id = auth.uid())))));

--
-- Name: lineups lineups_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lineups_super_admin ON public.lineups TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: live_rank_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.live_rank_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_templates notification_templates_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_templates_super_admin ON public.notification_templates TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: platform_home; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_home ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_maintenance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_maintenance ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_maintenance platform_maintenance_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_maintenance_read ON public.platform_maintenance FOR SELECT TO authenticated USING (true);

--
-- Name: platform_maintenance platform_maintenance_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_maintenance_super_admin ON public.platform_maintenance TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: platform_news; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_news ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_news platform_news_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_news_read ON public.platform_news FOR SELECT TO authenticated USING (((published = true) OR public.is_super_admin()));

--
-- Name: platform_news platform_news_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_news_super_admin ON public.platform_news TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: player_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: player_availability player_availability_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY player_availability_admin ON public.player_availability TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: player_availability player_availability_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY player_availability_read ON public.player_availability FOR SELECT TO authenticated USING (true);

--
-- Name: player_gameweek_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_gameweek_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: player_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: player_registrations player_registrations_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY player_registrations_public_read ON public.player_registrations FOR SELECT TO authenticated, anon USING (true);

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: players players_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY players_public_read ON public.players FOR SELECT TO authenticated, anon USING (true);

--
-- Name: private_league_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_league_members ENABLE ROW LEVEL SECURITY;

--
-- Name: private_league_members private_league_members_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_league_members_league_read ON public.private_league_members FOR SELECT TO authenticated USING (public.can_read_league(private_league_id));

--
-- Name: private_league_members private_league_members_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_league_members_member_read ON public.private_league_members FOR SELECT TO authenticated USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.fantasy_teams team
  WHERE ((team.id = private_league_members.fantasy_team_id) AND (team.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.private_leagues league
  WHERE ((league.id = private_league_members.private_league_id) AND (league.owner_user_id = auth.uid()))))));

--
-- Name: private_league_members private_league_members_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_league_members_super_admin ON public.private_league_members TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: private_leagues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_leagues ENABLE ROW LEVEL SECURITY;

--
-- Name: private_leagues private_leagues_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_leagues_league_read ON public.private_leagues FOR SELECT TO authenticated USING (public.can_read_league(id));

--
-- Name: private_leagues private_leagues_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_leagues_member_read ON public.private_leagues FOR SELECT TO authenticated USING (((owner_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM (public.private_league_members member
     JOIN public.fantasy_teams team ON ((team.id = member.fantasy_team_id)))
  WHERE ((member.private_league_id = private_leagues.id) AND (team.user_id = auth.uid()))))));

--
-- Name: private_leagues private_leagues_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_leagues_super_admin ON public.private_leagues TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_super_admin()));

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own ON public.push_subscriptions TO authenticated USING (((user_id = auth.uid()) OR public.is_super_admin())) WITH CHECK (((user_id = auth.uid()) OR public.is_super_admin()));

--
-- Name: real_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.real_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: real_matches real_matches_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY real_matches_public_read ON public.real_matches FOR SELECT TO authenticated, anon USING (true);

--
-- Name: roster_checkpoint_uses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_checkpoint_uses ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_checkpoint_uses roster_checkpoint_uses_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_checkpoint_uses_league_read ON public.roster_checkpoint_uses FOR SELECT TO authenticated USING (public.can_read_team(fantasy_team_id));

--
-- Name: roster_checkpoint_uses roster_checkpoint_uses_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_checkpoint_uses_member_read ON public.roster_checkpoint_uses FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.fantasy_teams team
  WHERE ((team.id = roster_checkpoint_uses.fantasy_team_id) AND (team.user_id = auth.uid())))));

--
-- Name: roster_checkpoint_uses roster_checkpoint_uses_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_checkpoint_uses_super_admin ON public.roster_checkpoint_uses TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: roster_stints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_stints ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_stints roster_stints_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_stints_league_read ON public.roster_stints FOR SELECT TO authenticated USING (public.can_read_team(fantasy_team_id));

--
-- Name: roster_stints roster_stints_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_stints_member_read ON public.roster_stints FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.fantasy_teams team
  WHERE ((team.id = roster_stints.fantasy_team_id) AND (team.user_id = auth.uid())))));

--
-- Name: roster_stints roster_stints_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_stints_super_admin ON public.roster_stints TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: rulesets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rulesets ENABLE ROW LEVEL SECURITY;

--
-- Name: rulesets rulesets_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rulesets_public_read ON public.rulesets FOR SELECT TO authenticated, anon USING (true);

--
-- Name: season_clubs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.season_clubs ENABLE ROW LEVEL SECURITY;

--
-- Name: season_clubs season_clubs_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY season_clubs_public_read ON public.season_clubs FOR SELECT TO authenticated, anon USING (true);

--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: seasons seasons_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seasons_public_read ON public.seasons FOR SELECT TO authenticated, anon USING (true);

--
-- Name: sync_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_logs sync_logs_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_logs_admin_read ON public.sync_logs FOR SELECT TO authenticated USING (public.is_super_admin());

--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: system_settings system_settings_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_settings_admin ON public.system_settings TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

--
-- Name: team_gameweek_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_gameweek_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: team_gameweek_scores team_gameweek_scores_league_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_gameweek_scores_league_read ON public.team_gameweek_scores FOR SELECT TO authenticated USING (public.can_read_team(fantasy_team_id));

--
-- Name: user_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notices user_notices_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notices_read ON public.user_notices FOR SELECT TO authenticated USING ((user_id = auth.uid()));

--
-- Name: user_notices user_notices_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notices_read_own ON public.user_notices FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

--
-- Name: vote_imports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vote_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: vote_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vote_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION apply_calendar_sync(p_run_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_calendar_sync(p_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_calendar_sync(p_run_id uuid) TO service_role;

--
-- Name: TABLE team_gameweek_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_gameweek_scores TO service_role;
GRANT SELECT ON TABLE public.team_gameweek_scores TO authenticated;

--
-- Name: FUNCTION calculate_gameweek_scores(p_gameweek_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calculate_gameweek_scores(p_gameweek_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calculate_gameweek_scores(p_gameweek_id uuid) TO service_role;

--
-- Name: FUNCTION can_read_league(p_league uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_read_league(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_read_league(p_league uuid) TO anon;
GRANT ALL ON FUNCTION public.can_read_league(p_league uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_league(p_league uuid) TO service_role;

--
-- Name: FUNCTION can_read_team(p_team uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_read_team(p_team uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_read_team(p_team uuid) TO anon;
GRANT ALL ON FUNCTION public.can_read_team(p_team uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_team(p_team uuid) TO service_role;

--
-- Name: FUNCTION captain_modifier_for_vote(p_definition jsonb, p_voto numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.captain_modifier_for_vote(p_definition jsonb, p_voto numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.captain_modifier_for_vote(p_definition jsonb, p_voto numeric) TO service_role;

--
-- Name: FUNCTION defense_modifier_for_average(p_definition jsonb, p_average numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.defense_modifier_for_average(p_definition jsonb, p_average numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.defense_modifier_for_average(p_definition jsonb, p_average numeric) TO service_role;

--
-- Name: FUNCTION gameweek_deadline_from_kickoff(p_first_kickoff timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gameweek_deadline_from_kickoff(p_first_kickoff timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gameweek_deadline_from_kickoff(p_first_kickoff timestamp with time zone) TO service_role;

--
-- Name: FUNCTION gameweeks_final_immutable(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gameweeks_final_immutable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.gameweeks_final_immutable() TO service_role;

--
-- Name: TABLE gameweeks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gameweeks TO service_role;
GRANT SELECT ON TABLE public.gameweeks TO anon;
GRANT SELECT ON TABLE public.gameweeks TO authenticated;

--
-- Name: FUNCTION generate_season_calendar(p_season_id uuid, p_start_date timestamp with time zone, p_rounds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_season_calendar(p_season_id uuid, p_start_date timestamp with time zone, p_rounds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_season_calendar(p_season_id uuid, p_start_date timestamp with time zone, p_rounds integer) TO service_role;

--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_super_admin() TO anon;
GRANT ALL ON FUNCTION public.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin() TO service_role;

--
-- Name: FUNCTION league_standings(p_league_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.league_standings(p_league_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.league_standings(p_league_id uuid) TO service_role;

--
-- Name: FUNCTION lock_fantasy_team_for_lineup(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_fantasy_team_for_lineup() FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_fantasy_team_for_lineup() TO service_role;

--
-- Name: FUNCTION record_fixture_sync(p_season_id uuid, p_save_mode public.calendar_save_mode, p_payload jsonb, p_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_fixture_sync(p_season_id uuid, p_save_mode public.calendar_save_mode, p_payload jsonb, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_fixture_sync(p_season_id uuid, p_save_mode public.calendar_save_mode, p_payload jsonb, p_provider text) TO service_role;

--
-- Name: TABLE gameweek_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gameweek_overrides TO service_role;
GRANT SELECT ON TABLE public.gameweek_overrides TO anon;
GRANT SELECT ON TABLE public.gameweek_overrides TO authenticated;

--
-- Name: TABLE gameweeks_with_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gameweeks_with_overrides TO anon;
GRANT ALL ON TABLE public.gameweeks_with_overrides TO authenticated;
GRANT ALL ON TABLE public.gameweeks_with_overrides TO service_role;

--
-- Name: FUNCTION set_gameweek_override(p_gameweek_id uuid, p_deadline_at timestamp with time zone, p_status public.gameweek_status, p_note text, p_force boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_gameweek_override(p_gameweek_id uuid, p_deadline_at timestamp with time zone, p_status public.gameweek_status, p_note text, p_force boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_gameweek_override(p_gameweek_id uuid, p_deadline_at timestamp with time zone, p_status public.gameweek_status, p_note text, p_force boolean) TO service_role;

--
-- Name: FUNCTION submit_lineup(p_fantasy_team_id uuid, p_gameweek_id uuid, p_player_ids uuid[], p_captain_id uuid, p_vice_captain_id uuid, p_bench_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_lineup(p_fantasy_team_id uuid, p_gameweek_id uuid, p_player_ids uuid[], p_captain_id uuid, p_vice_captain_id uuid, p_bench_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_lineup(p_fantasy_team_id uuid, p_gameweek_id uuid, p_player_ids uuid[], p_captain_id uuid, p_vice_captain_id uuid, p_bench_ids uuid[]) TO service_role;

--
-- Name: FUNCTION validate_fantasy_team_roster(p_fantasy_team_id uuid, p_gameweek integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_fantasy_team_roster(p_fantasy_team_id uuid, p_gameweek integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_fantasy_team_roster(p_fantasy_team_id uuid, p_gameweek integer) TO service_role;

--
-- Name: FUNCTION vote_clock(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vote_clock() FROM PUBLIC;
GRANT ALL ON FUNCTION public.vote_clock() TO service_role;

--
-- Name: TABLE admin_audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_audit_logs TO service_role;
GRANT SELECT ON TABLE public.admin_audit_logs TO authenticated;

--
-- Name: TABLE app_announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_announcements TO service_role;
GRANT SELECT ON TABLE public.app_announcements TO authenticated;

--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT ON TABLE public.app_settings TO authenticated;

--
-- Name: TABLE bonus_type_translations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bonus_type_translations TO service_role;
GRANT SELECT ON TABLE public.bonus_type_translations TO anon;
GRANT SELECT ON TABLE public.bonus_type_translations TO authenticated;

--
-- Name: TABLE calendar_sync_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.calendar_sync_runs TO service_role;

--
-- Name: TABLE checkpoint_moves; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checkpoint_moves TO service_role;

--
-- Name: TABLE checkpoints; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checkpoints TO service_role;

--
-- Name: TABLE club_badges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.club_badges TO service_role;

--
-- Name: TABLE club_translations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.club_translations TO service_role;
GRANT SELECT ON TABLE public.club_translations TO anon;
GRANT SELECT ON TABLE public.club_translations TO authenticated;

--
-- Name: TABLE clubs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clubs TO service_role;
GRANT SELECT ON TABLE public.clubs TO anon;
GRANT SELECT ON TABLE public.clubs TO authenticated;

--
-- Name: TABLE competition_translations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_translations TO service_role;
GRANT SELECT ON TABLE public.competition_translations TO anon;
GRANT SELECT ON TABLE public.competition_translations TO authenticated;

--
-- Name: TABLE competitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competitions TO service_role;
GRANT SELECT ON TABLE public.competitions TO anon;
GRANT SELECT ON TABLE public.competitions TO authenticated;

--
-- Name: TABLE device_push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.device_push_tokens TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.device_push_tokens TO authenticated;

--
-- Name: TABLE engagement_notices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.engagement_notices TO service_role;

--
-- Name: TABLE external_fixtures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_fixtures TO service_role;

--
-- Name: TABLE fantasy_teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_teams TO service_role;
GRANT SELECT,UPDATE ON TABLE public.fantasy_teams TO authenticated;

--
-- Name: TABLE league_badges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.league_badges TO service_role;
GRANT SELECT ON TABLE public.league_badges TO authenticated;

--
-- Name: TABLE league_delegates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.league_delegates TO service_role;
GRANT SELECT ON TABLE public.league_delegates TO authenticated;

--
-- Name: TABLE league_feed; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.league_feed TO service_role;
GRANT SELECT ON TABLE public.league_feed TO authenticated;

--
-- Name: TABLE league_regulations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.league_regulations TO service_role;
GRANT SELECT ON TABLE public.league_regulations TO authenticated;

--
-- Name: TABLE lineup_player_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lineup_player_scores TO service_role;
GRANT SELECT ON TABLE public.lineup_player_scores TO authenticated;

--
-- Name: TABLE lineup_slots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lineup_slots TO service_role;
GRANT SELECT ON TABLE public.lineup_slots TO authenticated;

--
-- Name: TABLE lineups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lineups TO service_role;
GRANT SELECT ON TABLE public.lineups TO authenticated;

--
-- Name: TABLE live_rank_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.live_rank_snapshots TO service_role;

--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_templates TO service_role;

--
-- Name: TABLE platform_home; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_home TO service_role;

--
-- Name: TABLE platform_maintenance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_maintenance TO service_role;
GRANT SELECT ON TABLE public.platform_maintenance TO authenticated;

--
-- Name: TABLE platform_news; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_news TO service_role;
GRANT SELECT ON TABLE public.platform_news TO authenticated;

--
-- Name: TABLE player_availability; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.player_availability TO service_role;
GRANT SELECT ON TABLE public.player_availability TO authenticated;

--
-- Name: TABLE player_gameweek_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.player_gameweek_stats TO service_role;

--
-- Name: TABLE player_registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.player_registrations TO service_role;
GRANT SELECT ON TABLE public.player_registrations TO anon;
GRANT SELECT ON TABLE public.player_registrations TO authenticated;

--
-- Name: TABLE players; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.players TO service_role;
GRANT SELECT ON TABLE public.players TO anon;
GRANT SELECT ON TABLE public.players TO authenticated;

--
-- Name: TABLE private_league_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_league_members TO service_role;
GRANT SELECT ON TABLE public.private_league_members TO authenticated;

--
-- Name: TABLE private_leagues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_leagues TO service_role;
GRANT SELECT ON TABLE public.private_leagues TO authenticated;

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;

--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO service_role;

--
-- Name: TABLE real_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.real_matches TO service_role;
GRANT SELECT ON TABLE public.real_matches TO anon;
GRANT SELECT ON TABLE public.real_matches TO authenticated;

--
-- Name: TABLE roster_checkpoint_uses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roster_checkpoint_uses TO service_role;
GRANT SELECT ON TABLE public.roster_checkpoint_uses TO authenticated;

--
-- Name: TABLE roster_stints; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roster_stints TO service_role;
GRANT SELECT ON TABLE public.roster_stints TO authenticated;

--
-- Name: TABLE rulesets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rulesets TO service_role;
GRANT SELECT ON TABLE public.rulesets TO anon;
GRANT SELECT ON TABLE public.rulesets TO authenticated;

--
-- Name: TABLE season_clubs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.season_clubs TO service_role;
GRANT SELECT ON TABLE public.season_clubs TO anon;
GRANT SELECT ON TABLE public.season_clubs TO authenticated;

--
-- Name: TABLE seasons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seasons TO service_role;
GRANT SELECT ON TABLE public.seasons TO anon;
GRANT SELECT ON TABLE public.seasons TO authenticated;

--
-- Name: TABLE sync_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sync_logs TO service_role;
GRANT SELECT ON TABLE public.sync_logs TO authenticated;

--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.system_settings TO service_role;
GRANT SELECT ON TABLE public.system_settings TO authenticated;

--
-- Name: TABLE user_notices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_notices TO service_role;
GRANT SELECT,UPDATE ON TABLE public.user_notices TO authenticated;

--
-- Name: TABLE vote_imports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vote_imports TO service_role;

--
-- Name: TABLE vote_reads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vote_reads TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- PostgreSQL database dump complete
--

-- ===========================================================================
-- 3. Bucket dei loghi e delle icone (lettura pubblica, scrittura solo dal server)
-- ===========================================================================
SELECT pg_catalog.set_config('search_path', 'public', false);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('brand-assets', 'brand-assets', true, 2097152, ARRAY['image/png', 'image/svg+xml', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS brand_assets_public_read ON storage.objects;
CREATE POLICY brand_assets_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'brand-assets');

-- ===========================================================================
-- 4. Dati iniziali indispensabili
-- ===========================================================================
SELECT pg_catalog.set_config('search_path', '', false);

--
-- PostgreSQL database dump
--

--
-- Data for Name: competitions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.competitions (id, code, country_code, created_at, start_matchday, end_matchday) VALUES ('11111111-1111-4111-8111-111111111111', 'serie_a', 'IT', '2026-11-05 16:22:17.013898+00', 1, 38);

--
-- Data for Name: clubs; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-111111111111', 'atalanta');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-111111111111', 'bologna');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000003', '11111111-1111-4111-8111-111111111111', 'cagliari');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000004', '11111111-1111-4111-8111-111111111111', 'como');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000005', '11111111-1111-4111-8111-111111111111', 'fiorentina');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000006', '11111111-1111-4111-8111-111111111111', 'frosinone');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000007', '11111111-1111-4111-8111-111111111111', 'genoa');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000008', '11111111-1111-4111-8111-111111111111', 'inter');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000009', '11111111-1111-4111-8111-111111111111', 'juventus');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000010', '11111111-1111-4111-8111-111111111111', 'lazio');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000011', '11111111-1111-4111-8111-111111111111', 'lecce');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000012', '11111111-1111-4111-8111-111111111111', 'milan');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000013', '11111111-1111-4111-8111-111111111111', 'monza');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000014', '11111111-1111-4111-8111-111111111111', 'napoli');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000015', '11111111-1111-4111-8111-111111111111', 'parma');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000016', '11111111-1111-4111-8111-111111111111', 'roma');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000017', '11111111-1111-4111-8111-111111111111', 'sassuolo');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000018', '11111111-1111-4111-8111-111111111111', 'torino');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000019', '11111111-1111-4111-8111-111111111111', 'udinese');
INSERT INTO public.clubs (id, competition_id, code) VALUES ('44444444-4444-4444-8444-000000000020', '11111111-1111-4111-8111-111111111111', 'venezia');

--
-- Data for Name: club_translations; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000001', 'it', 'Atalanta', 'ATA');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000001', 'en', 'Atalanta', 'ATA');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000002', 'it', 'Bologna', 'BOL');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000002', 'en', 'Bologna', 'BOL');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000003', 'it', 'Cagliari', 'CAG');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000003', 'en', 'Cagliari', 'CAG');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000004', 'it', 'Como', 'COM');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000004', 'en', 'Como', 'COM');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000005', 'it', 'Fiorentina', 'FIO');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000005', 'en', 'Fiorentina', 'FIO');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000006', 'it', 'Frosinone', 'FRO');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000006', 'en', 'Frosinone', 'FRO');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000007', 'it', 'Genoa', 'GEN');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000007', 'en', 'Genoa', 'GEN');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000008', 'it', 'Inter', 'INT');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000008', 'en', 'Inter', 'INT');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000009', 'it', 'Juventus', 'JUV');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000009', 'en', 'Juventus', 'JUV');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000010', 'it', 'Lazio', 'LAZ');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000010', 'en', 'Lazio', 'LAZ');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000011', 'it', 'Lecce', 'LEC');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000011', 'en', 'Lecce', 'LEC');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000012', 'it', 'Milan', 'MIL');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000012', 'en', 'Milan', 'MIL');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000013', 'it', 'Monza', 'MON');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000013', 'en', 'Monza', 'MON');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000014', 'it', 'Napoli', 'NAP');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000014', 'en', 'Napoli', 'NAP');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000015', 'it', 'Parma', 'PAR');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000015', 'en', 'Parma', 'PAR');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000016', 'it', 'Roma', 'ROM');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000016', 'en', 'Roma', 'ROM');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000017', 'it', 'Sassuolo', 'SAS');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000017', 'en', 'Sassuolo', 'SAS');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000018', 'it', 'Torino', 'TOR');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000018', 'en', 'Torino', 'TOR');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000019', 'it', 'Udinese', 'UDI');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000019', 'en', 'Udinese', 'UDI');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000020', 'it', 'Venezia', 'VEN');
INSERT INTO public.club_translations (club_id, locale, name, short_name) VALUES ('44444444-4444-4444-8444-000000000020', 'en', 'Venezia', 'VEN');

--
-- Data for Name: competition_translations; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.competition_translations (competition_id, locale, name) VALUES ('11111111-1111-4111-8111-111111111111', 'it', 'Serie A');
INSERT INTO public.competition_translations (competition_id, locale, name) VALUES ('11111111-1111-4111-8111-111111111111', 'en', 'Serie A');

--
-- Data for Name: notification_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.notification_templates (kind, title, body, enabled) VALUES ('deadline', 'Chiudi la formazione', 'Mancano 30 minuti alla giornata {matchday}. Se non la invii, resta l''ultima schierata. Alla prima giornata la compone il sistema.', true);
INSERT INTO public.notification_templates (kind, title, body, enabled) VALUES ('bonus', 'Bonus in campo', '{player}: {event}.', true);
INSERT INTO public.notification_templates (kind, title, body, enabled) VALUES ('overtake', 'Sorpasso live', '{opponent} ti ha superato. Giornata {matchday}.', true);

--
-- Data for Name: platform_home; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.platform_home (id, promo_image, promo_href, promo_label, probabili_href, updated_at) VALUES (1, NULL, NULL, NULL, NULL, '2026-11-16 10:22:34.877859+00');

--
-- Data for Name: platform_maintenance; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.platform_maintenance (id, enabled, message, updated_at) VALUES (1, false, 'Manutenzione in corso. Puoi consultare la lega: formazioni e mercati restano chiusi fino alla fine del calcolo.', '2026-11-09 11:48:30.019734+00');

--
-- Data for Name: rulesets; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.rulesets (id, code, version, definition) VALUES ('22222222-2222-4222-8222-222222222222', 'fantaventi', 1, '{"fair_play": {"cards": ["yellow_card"], "points": 2.5}, "max_super": 1, "squad_size": 20, "bonus_malus": {"goal": 3, "assist": 1, "own_goal": -2, "red_card": -1, "yellow_card": -0.5, "goal_conceded": -1, "penalty_saved": 3, "penalty_missed": -3}, "checkpoints": {"count": 3, "first_gameweek": 2, "max_replacements": 4}, "goalkeepers": {"max": 3, "min": 2}, "lineup_size": 11, "outfield_roles": {"max": 9, "min": 3}, "captain_modifier": [{"points": -0.5, "max_exclusive": 6}, {"eq": 6, "points": 0.5}, {"eq": 6.5, "points": 1}, {"eq": 7, "points": 1.5}, {"points": 2, "min_inclusive": 7.5}], "defense_modifier": {"bands": [{"min": 6.0, "points": 1}, {"min": 6.5, "points": 3}, {"min": 7.0, "points": 6}], "basis": "voto", "best_defenders": 3, "min_rated_defenders": 4}, "empty_slot_points": 2.5, "double_captain_malus": true}');

--
-- Data for Name: seasons; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.seasons (id, competition_id, ruleset_id, code, status, starts_on, ends_on, is_sandbox) VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-27', 'running', '2026-08-22', '2027-05-30', false);

--
-- Data for Name: season_clubs; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000001');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000002');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000003');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000004');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000005');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000006');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000007');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000008');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000009');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000010');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000011');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000012');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000013');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000014');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000015');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000016');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000017');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000018');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000019');
INSERT INTO public.season_clubs (season_id, club_id) VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000020');

--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.system_settings (id, votes_source_url, votes_provider, availability_provider, api_sports_league_id, api_sports_season, sync_window_post_match_min, sync_window_post_match_max, sync_window_evening_start, sync_window_evening_end, sync_window_morning_start, sync_window_morning_end, auto_sync_enabled, updated_at, brand_logo_url, brand_icon_192_url, brand_icon_512_url, brand_accent_color, notify_on_sync_success, halftime_read_enabled) VALUES (1, 'https://www.fantacalcio.it/serie-a/voti', 'fantacalcio', 'fantacalcio', 135, 2026, 125, 150, '23:15', '23:45', '09:15', '09:45', true, '2026-11-26 10:54:05.967+00', '', '', '', '#126631', true, true);

--
-- PostgreSQL database dump complete
--

COMMIT;
