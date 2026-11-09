-- Fantaventi — architettura di produzione
-- Eseguire nell'editor SQL di Supabase dopo schema.sql.
-- Lo script è ripetibile: non cancella listoni, voti o punteggi già caricati.
--
-- Aggiunge le partite reali, il live score, lo storico cessioni e il blocco
-- delle giornate final. Non attiva le policy RLS: le API scrivono con la
-- service role e l'app continua a leggere da lì. Accendere la RLS prima delle
-- policy chiuderebbe il prototipo.

-- ---------------------------------------------------------------------------
-- Partite reali
-- ---------------------------------------------------------------------------

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

alter table public.real_matches add column if not exists home_goals integer;
alter table public.real_matches add column if not exists away_goals integer;

create index if not exists real_matches_gameweek_idx
  on public.real_matches (gameweek_id);

-- ---------------------------------------------------------------------------
-- Giornata: inizio della finestra d'appello
-- ---------------------------------------------------------------------------

alter table public.gameweeks
  add column if not exists scored_at timestamptz;

-- ---------------------------------------------------------------------------
-- Punteggi: totale ufficiale e totale live
-- ---------------------------------------------------------------------------

alter table public.team_gameweek_scores
  add column if not exists provisional_total numeric(6,2),
  add column if not exists rated_players_count integer not null default 0,
  add column if not exists on_pitch_count integer not null default 0,
  add column if not exists is_live boolean not null default false;

-- ---------------------------------------------------------------------------
-- Stesso file voti: un solo import per giornata
-- I payload mock restano ripetibili, perché la simulazione di test è deterministica.
-- ---------------------------------------------------------------------------

create unique index if not exists vote_imports_gameweek_payload_uidx
  on public.vote_imports (gameweek_id, payload_hash)
  where source <> 'mock';

-- ---------------------------------------------------------------------------
-- Storico trasferimenti sul listone
-- ---------------------------------------------------------------------------

create or replace function public.player_registrations_keep_history()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.season_clubs sc
    where sc.season_id = new.season_id
      and sc.club_id = new.club_id
  ) then
    raise exception 'Il club non appartiene alla stagione del listone.'
      using errcode = '23514';
  end if;

  -- effective_to precedente a effective_from: riga chiusa prima di entrare, non copre giornate.
  if new.effective_to_gameweek is not null
     and new.effective_to_gameweek < new.effective_from_gameweek then
    return new;
  end if;

  if exists (
    select 1
    from public.player_registrations pr
    where pr.season_id = new.season_id
      and pr.player_id = new.player_id
      and pr.id <> new.id
      and pr.effective_from_gameweek <= coalesce(new.effective_to_gameweek, 100000)
      and coalesce(pr.effective_to_gameweek, 100000) >= new.effective_from_gameweek
      and (
        pr.effective_to_gameweek is null
        or pr.effective_to_gameweek >= pr.effective_from_gameweek
      )
  ) then
    raise exception 'Registrazioni sovrapposte per lo stesso calciatore nella stagione.'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists player_registrations_keep_history on public.player_registrations;
create trigger player_registrations_keep_history
  before insert or update on public.player_registrations
  for each row
  execute function public.player_registrations_keep_history();

-- ---------------------------------------------------------------------------
-- Giornata final: voti, formazioni e punteggi non si riscrivono
-- ---------------------------------------------------------------------------

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

drop trigger if exists gameweeks_final_immutable on public.gameweeks;
create trigger gameweeks_final_immutable
  before update on public.gameweeks
  for each row
  execute function public.gameweeks_final_immutable();

create or replace function public.reject_if_gameweek_final()
returns trigger
language plpgsql
as $$
declare
  v_status public.gameweek_status;
  v_gameweek uuid;
begin
  v_gameweek := coalesce(new.gameweek_id, old.gameweek_id);
  select status into v_status
  from public.gameweeks
  where id = v_gameweek;

  if v_status = 'final' then
    raise exception 'Giornata final: voti e punteggi sono bloccati.'
      using errcode = '55000';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists player_gameweek_stats_final_guard on public.player_gameweek_stats;
create trigger player_gameweek_stats_final_guard
  before insert or update or delete on public.player_gameweek_stats
  for each row
  execute function public.reject_if_gameweek_final();

drop trigger if exists team_gameweek_scores_final_guard on public.team_gameweek_scores;
create trigger team_gameweek_scores_final_guard
  before insert or update or delete on public.team_gameweek_scores
  for each row
  execute function public.reject_if_gameweek_final();

drop trigger if exists vote_imports_final_guard on public.vote_imports;
create trigger vote_imports_final_guard
  before insert or update or delete on public.vote_imports
  for each row
  execute function public.reject_if_gameweek_final();

drop trigger if exists lineups_final_guard on public.lineups;
create trigger lineups_final_guard
  before insert or update or delete on public.lineups
  for each row
  execute function public.reject_if_gameweek_final();

create or replace function public.reject_if_lineup_slot_final()
returns trigger
language plpgsql
as $$
declare
  v_status public.gameweek_status;
  v_lineup uuid;
begin
  v_lineup := coalesce(new.lineup_id, old.lineup_id);
  select g.status into v_status
  from public.lineups l
  join public.gameweeks g on g.id = l.gameweek_id
  where l.id = v_lineup;

  if v_status = 'final' then
    raise exception 'Giornata final: la formazione è bloccata.'
      using errcode = '55000';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists lineup_slots_final_guard on public.lineup_slots;
create trigger lineup_slots_final_guard
  before insert or update or delete on public.lineup_slots
  for each row
  execute function public.reject_if_lineup_slot_final();
