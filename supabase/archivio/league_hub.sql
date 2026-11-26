-- Fantaventi — hub di lega: range giornate e schieramento fino alla deadline.
-- Eseguire nell'editor SQL di Supabase dopo schema.sql, calendar_setup.sql e lineup_and_scoring.sql.
--
-- Il calendario resta public.gameweeks (deadline_at è la scadenza della giornata).
-- Il range della lega sta su public.private_leagues.start_matchday / end_matchday.
-- La classifica è league_standings: somma dei punti reali, con punteggio d'ingresso
-- solo per chi schiera per la prima volta dopo start_matchday (sezione 5.5 del PRD).

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

alter table public.private_leagues
  drop constraint if exists private_leagues_matchday_range;

alter table public.private_leagues
  add constraint private_leagues_matchday_range
  check (
    start_matchday >= 1
    and end_matchday >= start_matchday
  );

-- Una giornata scheduled si può ancora schierare, finché now() < deadline_at.
-- Si blocca se lo stato è locked, scored o final, oppure se la deadline è passata.
-- La panchina è ordinata: slot_order 1, 2, 3… e is_starter = false.
-- saved_at è l'istante dell'ultimo salvataggio, lo stesso mostrato in home e in admin.
alter table public.lineups
  add column if not exists saved_at timestamptz;

alter table public.lineup_slots
  add column if not exists is_starter boolean not null default true;

alter table public.lineup_slots
  add column if not exists slot_order integer not null default 0;

alter table public.lineup_slots
  drop constraint if exists lineup_slots_bench_flags;

alter table public.lineup_slots
  add constraint lineup_slots_bench_flags
  check (is_starter or (not is_captain and not is_vice_captain));

-- Ogni firma precedente va tolta: PostgREST rifiuta p_bench_ids se resta
-- la versione a cinque argomenti.
do $drop_submit_lineup$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'submit_lineup'
  loop
    execute format('drop function if exists %s', v_signature);
  end loop;
end
$drop_submit_lineup$;

create or replace function public.submit_lineup(
  p_fantasy_team_id uuid,
  p_gameweek_id uuid,
  p_player_ids uuid[],
  p_captain_id uuid,
  p_vice_captain_id uuid,
  p_bench_ids uuid[] default '{}'::uuid[]
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

revoke all on function public.submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[]) from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[]) to service_role;
  end if;
end
$grants$;

notify pgrst, 'reload schema';

-- Classifica di lega. Punti = somma reale per chi parte da start_matchday.
-- Per chi entra a X > start_matchday:
--   ingresso = media di tutti i punteggi di tutte le squadre nelle giornate chiuse precedenti × giornate saltate.
--   punti = ingresso + somma reale dalle giornate disputate da X in poi.
create or replace function public.league_standings(p_league_id uuid)
returns table (
  fantasy_team_id uuid,
  entry_matchday integer,
  skipped_count integer,
  played_count integer,
  real_points numeric,
  average_points numeric,
  entry_points numeric,
  total_points numeric
)
language sql
stable
set search_path = public
as $$
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

revoke all on function public.league_standings(uuid) from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.league_standings(uuid) to service_role;
  end if;
end
$grants$;
