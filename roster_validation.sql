-- Fantaventi — validazione rosa (PRD ROS-01…ROS-06, sezione 8.10)
-- Eseguire nell'editor SQL di Supabase dopo schema.sql.
--
-- validate_fantasy_team_roster(squadra, giornata)
--   rosa = stint con active_from_gameweek <= giornata
--          e active_until_gameweek nullo oppure >= giornata
--   club e ruolo = iscrizione del listone valida in quella giornata
--   soglie lette dal ruleset della stagione
--     (fantaventi v1: 20 calciatori, GK 2–3, DEF/MID/FWD 3–9)
--
-- Nessuna eccezione = rosa valida.
-- select public.validate_fantasy_team_roster('<fantasy_team_id>'::uuid, 1);

create or replace function public.validate_fantasy_team_roster(
  p_fantasy_team_id uuid,
  p_gameweek int
)
returns void
language plpgsql
stable
set search_path = public
as $$
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
