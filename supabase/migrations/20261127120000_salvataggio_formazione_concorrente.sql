-- Salvataggi quasi contemporanei della stessa formazione (preparato il 27/11/2026, NON ancora eseguito sul sito).
-- Da eseguire a mano nell'editor SQL di Supabase, dopo un backup e con la conferma dell'utente.
-- Il codice del ramo fix/salvataggio-formazione-concorrente funziona anche senza questo file:
-- questo file chiude i casi rimasti nel database. Si può eseguire prima o dopo la pubblicazione.
--
-- Problema: per salvare una formazione il database mette due «lucchetti», uno sulla squadra
-- e uno sulla formazione. submit_lineup li prende in quest'ordine (squadra, poi formazione),
-- mentre ogni altro aggiornamento della riga in lineups li prendeva al contrario (prima la
-- formazione, poi la squadra, tramite il trigger lineup_team_lock). Con due operazioni quasi
-- insieme ciascuna aspettava l'altra e il database ne annullava una («deadlock»).
--
-- Cosa cambia:
-- 1. lock_fantasy_team_for_lineup (trigger su lineups) blocca la squadra solo quando nasce
--    una formazione o quando cambia squadra. Un aggiornamento della stessa formazione (per
--    esempio la chiusura alla deadline) non prende più il lucchetto della squadra: quello della
--    riga basta. Gli inserimenti, anche "upsert", restano serializzati come prima.
-- 2. submit_lineup, dopo aver atteso il lucchetto della squadra, rilegge stato e orario della
--    giornata e confronta con l'ora vera (clock_timestamp), non con l'ora d'inizio della richiesta.
-- 3. submit_lineup ripete lo stesso controllo alla fine: se nel frattempo la giornata è stata
--    chiusa, annulla tutto e resta la formazione salvata prima.
-- Non tocca dati, tabelle o permessi. Si può rieseguire senza danni.

begin;

create or replace function public.lock_fantasy_team_for_lineup()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.fantasy_team_id is not distinct from old.fantasy_team_id then
    return new;
  end if;
  perform 1
  from public.fantasy_teams
  where id = new.fantasy_team_id
  for update;
  return new;
end;
$$;

create or replace function public.submit_lineup(p_fantasy_team_id uuid, p_gameweek_id uuid, p_player_ids uuid[], p_captain_id uuid, p_vice_captain_id uuid, p_bench_ids uuid[] DEFAULT '{}'::uuid[]) RETURNS uuid
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
  -- Ordine dei blocchi: sempre prima la squadra, poi la formazione.
  perform 1
  from public.fantasy_teams
  where id = p_fantasy_team_id
  for update;

  -- Stato e orario si rileggono DOPO il blocco: chi ha atteso un altro salvataggio
  -- vede la giornata com'è adesso, non com'era quando la richiesta è partita.
  select g.status, g.deadline_at
    into v_status, v_deadline
  from public.gameweeks g
  where g.id = p_gameweek_id;

  if v_status in ('locked', 'scored', 'final') then
    raise exception 'La giornata % è chiusa (stato: %).', v_number, v_status
      using errcode = '23514';
  end if;

  -- clock_timestamp() è l'ora di adesso; now() sarebbe l'ora d'inizio della richiesta.
  if clock_timestamp() >= v_deadline then
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

  -- Controllo finale, dopo aver ottenuto anche il blocco della formazione: se nel frattempo
  -- la giornata è stata chiusa o l'orario di inizio è passato, si annulla tutto e resta
  -- la formazione salvata in precedenza.
  select g.status, g.deadline_at
    into v_status, v_deadline
  from public.gameweeks g
  where g.id = p_gameweek_id;

  if v_status in ('locked', 'scored', 'final') then
    raise exception 'La giornata % è chiusa (stato: %).', v_number, v_status
      using errcode = '23514';
  end if;

  if clock_timestamp() >= v_deadline then
    raise exception 'La deadline della giornata % è scaduta (%).', v_number, v_deadline
      using errcode = '23514';
  end if;

  return v_lineup_id;
end;
$$;

commit;

-- Verifica (deve restituire due righe con true):
-- select 'trigger' as cosa, pg_get_functiondef('public.lock_fantasy_team_for_lineup()'::regprocedure) like '%tg_op = ''UPDATE''%' as ok
-- union all
-- select 'submit_lineup', pg_get_functiondef('public.submit_lineup(uuid, uuid, uuid[], uuid, uuid, uuid[])'::regprocedure) like '%clock_timestamp()%';
