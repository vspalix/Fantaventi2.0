-- Fantaventi — formazione e punteggi
-- Eseguire nell'editor SQL di Supabase dopo schema.sql, roster_validation.sql
-- e calendar_setup.sql.
--
-- I cambi di rosa sono liberi prima della deadline di ogni giornata.
-- submit_lineup non consulta i check-point: controlla la rosa già valida
-- per quella giornata (roster_stints) e salva solo i titolari.
--
-- Se un titolare non ha voto, entra il panchinaro dello stesso ruolo con il
-- voto più alto (a parità, player_id più piccolo). Il capitano senza voto
-- cede il bonus al vice, non al sostituto.
--
-- Totale = punti dei calciatori a voto
--        + modificatore capitano
--        + fair play
--        + modificatore difesa
--        + riserva d'ufficio per gli slot lasciati vuoti sotto gli 11.

-- ---------------------------------------------------------------------------
-- Soglie del ruleset
-- ---------------------------------------------------------------------------

create or replace function public.captain_modifier_for_vote(
  p_definition jsonb,
  p_voto numeric
)
returns numeric
language sql
stable
set search_path = public
as $$
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

create or replace function public.defense_modifier_for_average(
  p_definition jsonb,
  p_average numeric
)
returns numeric
language sql
stable
set search_path = public
as $$
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

-- ---------------------------------------------------------------------------
-- Formazione
-- p_player_ids sono i titolari, da 1 a 11, tutti presenti in rosa.
-- ---------------------------------------------------------------------------

alter table public.lineup_slots
  add column if not exists is_starter boolean not null default true;

alter table public.lineup_slots
  add column if not exists slot_order integer not null default 0;

drop function if exists public.submit_lineup(uuid, uuid, uuid[], uuid, uuid);
drop function if exists public.submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[]);

create or replace function public.submit_lineup(
  p_fantasy_team_id uuid,
  p_gameweek_id uuid,
  p_player_ids uuid[],
  p_captain_id uuid,
  p_vice_captain_id uuid,
  p_bench_ids uuid[] default '{}'
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
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

  if v_status in ('locked', 'scored', 'final') then
    raise exception 'La giornata % è chiusa (stato: %).', v_number, v_status
      using errcode = '23514';
  end if;

  if now() >= v_deadline then
    raise exception 'La deadline della giornata % è scaduta (%).', v_number, v_deadline
      using errcode = '23514';
  end if;

  -- Rosa libera da check-point: si valida solo la composizione della giornata.
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

  insert into public.lineup_slots (lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order)
  select
    v_lineup_id,
    picked.player_id,
    picked.player_id = p_captain_id,
    picked.player_id is not distinct from p_vice_captain_id,
    true,
    picked.ordinality::int
  from unnest(p_player_ids) with ordinality as picked(player_id, ordinality);

  insert into public.lineup_slots (lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order)
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

-- ---------------------------------------------------------------------------
-- Punteggi di giornata
-- ---------------------------------------------------------------------------

create or replace function public.calculate_gameweek_scores(
  p_gameweek_id uuid
)
returns setof public.team_gameweek_scores
language plpgsql
set search_path = public
as $$
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

revoke all on function public.captain_modifier_for_vote(jsonb, numeric) from public;
revoke all on function public.defense_modifier_for_average(jsonb, numeric) from public;
revoke all on function public.submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[]) from public;
revoke all on function public.calculate_gameweek_scores(uuid) from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.captain_modifier_for_vote(jsonb, numeric) to service_role;
    grant execute on function public.defense_modifier_for_average(jsonb, numeric) to service_role;
    grant execute on function public.submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[]) to service_role;
    grant execute on function public.calculate_gameweek_scores(uuid) to service_role;
  end if;
end
$grants$;
